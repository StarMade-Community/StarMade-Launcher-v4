// ─── Azure VM remote backend (SSH) ────────────────────────────────────────────
//
// Implements IRemoteBackend using the system ssh binary (no native Node
// modules required).  Supports both SSH key and password authentication.
//
// Connection model:
//   connect()          – validate SSH reachability with a test command, then
//                        start a live log-streaming subprocess.
//   sendAdminCommand() – spawn a fresh SSH process per command (simple, robust).
//   disconnect()       – kill the log stream and clear session state.
//
// Auth methods (mutually exclusive, key takes priority):
//   SSH key  – pass sshKeyPath; key must not require a passphrase.
//   Password – pass sshPassword; requires sshpass(1) to be on PATH.

import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import os from 'node:os';
import type {
  IRemoteBackend,
  RemoteConnectOptions,
  RemoteConnectResult,
  RemoteCommandResult,
  RemoteConnectionStatus,
  RemoteRuntimeEvent,
} from './remote-backend-types.js';

interface AzureVmSession {
  serverId: string;
  host: string;
  /** Game port (informational – not used for SSH). */
  gamePort: number;
  sshPort: number;
  username: string;
  sshKeyPath?: string;
  /** Password kept only in memory; never persisted or logged. */
  sshPassword?: string;
  /** screen/tmux session name to target when injecting admin commands. */
  screenSessionName?: string;
  /** Absolute path to the StarMade server root on the remote host (used to locate the log file). */
  serverRootPath?: string;
  state: 'connecting' | 'ready' | 'error';
  connectedAt: string;
  error?: string;
  logStreamProc?: ChildProcess;
}

// ─── SSH argument builder ─────────────────────────────────────────────────────

function buildSshArgs(
  session: Pick<AzureVmSession, 'host' | 'sshPort' | 'username' | 'sshKeyPath'>,
): string[] {
  const args: string[] = [
    '-o', 'BatchMode=yes',
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', 'ConnectTimeout=10',
    '-o', 'ServerAliveInterval=30',
    // Pin known_hosts to the home-directory path so Electron's working directory
    // does not affect which file SSH reads/writes (avoids host-key lookup misses).
    '-o', `UserKnownHostsFile=${process.env.HOME ?? '~'}/.ssh/known_hosts`,
    '-p', String(session.sshPort),
  ];
  if (session.sshKeyPath?.trim()) {
    const keyPath = session.sshKeyPath.trim().replace(/^~(?=$|\/)/, os.homedir());
    args.push('-o', 'IdentitiesOnly=yes', '-i', keyPath);
  }
  args.push(`${session.username}@${session.host}`);
  return args;
}

/**
 * Build the spawn command and arguments, using sshpass when a password is
 * provided and BatchMode must be disabled so ssh can accept the password.
 */
function buildSpawnConfig(
  session: AzureVmSession,
  command: string,
): { cmd: string; args: string[]; opts: SpawnOptions } {
  const opts: SpawnOptions = { stdio: ['ignore', 'pipe', 'pipe'] };

  if (session.sshPassword) {
    // sshpass feeds the password to ssh's stdin-equivalent prompt.
    // BatchMode=yes would reject password auth, so omit it for password sessions.
    const sshArgs: string[] = [
      '-o', 'StrictHostKeyChecking=accept-new',
      '-o', 'ConnectTimeout=10',
      '-o', 'ServerAliveInterval=30',
      '-o', 'PasswordAuthentication=yes',
      '-o', 'PubkeyAuthentication=no',
      '-o', `UserKnownHostsFile=${process.env.HOME ?? '~'}/.ssh/known_hosts`,
      '-p', String(session.sshPort),
      `${session.username}@${session.host}`,
      command,
    ];
    return {
      cmd: 'sshpass',
      args: ['-p', session.sshPassword, 'ssh', ...sshArgs],
      opts,
    };
  }

  return {
    cmd: 'ssh',
    args: [...buildSshArgs(session), command],
    opts,
  };
}

// ─── Backend implementation ───────────────────────────────────────────────────

export class AzureVmBackend implements IRemoteBackend {
  private readonly sessions = new Map<string, AzureVmSession>();
  private readonly onStatusChanged: (status: RemoteConnectionStatus) => void;
  private readonly onRuntimeEvent: (event: RemoteRuntimeEvent) => void;

  constructor(options: {
    onStatusChanged: (status: RemoteConnectionStatus) => void;
    onRuntimeEvent: (event: RemoteRuntimeEvent) => void;
  }) {
    this.onStatusChanged = options.onStatusChanged;
    this.onRuntimeEvent = options.onRuntimeEvent;
  }

  async connect(options: RemoteConnectOptions): Promise<RemoteConnectResult> {
    const {
      serverId,
      host,
      port = 4242,
      username = 'azureuser',
      sshPort = 22,
      sshKeyPath,
      sshPassword,
      screenSessionName,
      serverRootPath,
    } = options;

    // Replace any existing session cleanly
    this.disconnect(serverId);

    const session: AzureVmSession = {
      serverId,
      host,
      gamePort: port,
      sshPort,
      username,
      sshKeyPath: sshKeyPath?.trim() || undefined,
      sshPassword: sshPassword || undefined,
      screenSessionName: screenSessionName?.trim() || undefined,
      serverRootPath: serverRootPath?.trim() || undefined,
      state: 'connecting',
      connectedAt: new Date().toISOString(),
    };
    this.sessions.set(serverId, session);
    this.onStatusChanged(this.buildStatus(session));

    // Verify SSH connectivity with a quick no-op.  Retry up to 3 times with
    // increasing back-off — the first attempt commonly fails because:
    //   • the host key is being written to known_hosts (some SSH versions
    //     exit non-zero on first contact even with StrictHostKeyChecking=accept-new)
    //   • Azure NSG / firewall needs a moment to pass a new source IP
    //   • the SSH daemon itself needs a brief warm-up period
    const SSH_TEST_RETRIES = 3;
    const SSH_TEST_DELAYS_MS = [2_000, 4_000]; // delays between attempts 1→2 and 2→3
    let testResult = await this.runOneShotSsh(session, 'echo SM_SSH_OK', 15_000);

    for (let attempt = 1; attempt < SSH_TEST_RETRIES && !testResult.ok; attempt++) {
      const delayMs = SSH_TEST_DELAYS_MS[attempt - 1] ?? 4_000;
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      if (!this.sessions.has(serverId)) {
        return { success: false, error: 'Connection cancelled.' };
      }
      testResult = await this.runOneShotSsh(session, 'echo SM_SSH_OK', 15_000);
    }

    if (!testResult.ok) {
      session.state = 'error';
      session.error = testResult.error ?? 'SSH connectivity test failed.';
      this.onStatusChanged(this.buildStatus(session));
      return { success: false, error: session.error, status: this.buildStatus(session) };
    }

    session.state = 'ready';
    this.onStatusChanged(this.buildStatus(session));

    // Begin streaming server logs in the background
    this.startLogStream(session);

    return { success: true, status: this.buildStatus(session) };
  }

  disconnect(serverId: string): RemoteConnectResult {
    const session = this.sessions.get(serverId);
    if (!session) return { success: true };

    try { session.logStreamProc?.kill('SIGTERM'); } catch { /* ignore */ }
    this.sessions.delete(serverId);

    const status: RemoteConnectionStatus = {
      serverId,
      backend: 'azure-vm',
      connected: false,
      state: 'idle',
      isReady: false,
    };
    this.onStatusChanged(status);
    return { success: true, status };
  }

  async sendAdminCommand(payload: { serverId: string; command: string }): Promise<RemoteCommandResult> {
    const session = this.sessions.get(payload.serverId);
    if (!session || session.state !== 'ready') {
      return { success: false, error: 'Azure VM SSH session is not ready.', reasonCode: 'not_ready' };
    }

    // StarMade server console commands (e.g. /server_message_broadcast) cannot be
    // executed directly as shell commands over SSH — they must be injected into the
    // running server process via screen or tmux.  Base64-encode the command so it
    // survives quoting inside the remote shell.
    const b64 = Buffer.from(payload.command, 'utf8').toString('base64');

    // Build the list of session names to try: configured name first, then common defaults.
    const configuredName = session.screenSessionName;
    const sessionNamesToTry = configuredName
      ? [configuredName]
      : ['StarMade', 'starmade', 'sm'];

    const screenAttempts = sessionNamesToTry.map(
      (n) => `screen -S ${n} -X stuff "$CMD"$'\\n' 2>/dev/null && exit 0`,
    );
    const tmuxAttempts = sessionNamesToTry.map(
      (n) => `tmux send-keys -t ${n} "$CMD" Enter 2>/dev/null && exit 0`,
    );
    const nameList = sessionNamesToTry.join(', ');

    const deliveryScript = [
      `CMD=$(printf '%s' '${b64}' | base64 -d)`,
      ...screenAttempts,
      ...tmuxAttempts,
      `printf '%s\\n' "Cannot deliver command: no screen/tmux session named ${nameList} found. Set the Screen/tmux Session Name in the connect settings." >&2`,
      `exit 1`,
    ].join('; ');

    const result = await this.runOneShotSsh(session, deliveryScript, 30_000);
    if (!result.ok) {
      return {
        success: false,
        error: result.error,
        reasonCode: 'ssh_command_failed',
        status: this.buildStatus(session),
      };
    }
    return { success: true, status: this.buildStatus(session) };
  }

  getStatusFor(serverId: string): RemoteConnectionStatus {
    const session = this.sessions.get(serverId);
    if (!session) return { serverId, backend: 'azure-vm', connected: false, state: 'idle' };
    return this.buildStatus(session);
  }

  getStatuses(): RemoteConnectionStatus[] {
    return Array.from(this.sessions.values()).map((s) => this.buildStatus(s));
  }

  // ─── Private helpers ─────────────────────────────────────────────────────────

  private buildStatus(session: AzureVmSession): RemoteConnectionStatus {
    const isReady = session.state === 'ready';
    return {
      serverId: session.serverId,
      backend: 'azure-vm',
      connected: session.state !== 'error',
      state: session.state === 'connecting' ? 'connecting' : isReady ? 'ready' : 'error',
      isReady,
      host: session.host,
      port: session.sshPort,
      username: session.username,
      connectedAt: session.connectedAt,
      error: session.error,
      reasonCode: isReady ? 'ready' : session.state === 'error' ? 'ssh_connect_failed' : undefined,
    };
  }

  /**
   * Run a single command on the remote host and resolve once it exits.
   * stdout + stderr are emitted as runtime events on success.
   */
  private runOneShotSsh(
    session: AzureVmSession,
    command: string,
    timeoutMs: number,
  ): Promise<{ ok: boolean; error?: string }> {
    return new Promise((resolve) => {
      const { cmd, args, opts } = buildSpawnConfig(session, command);
      const proc = spawn(cmd, args, opts);

      let stdout = '';
      let stderr = '';
      let settled = false;

      const finish = (ok: boolean, error?: string): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (ok) {
          for (const line of (stdout + stderr).split('\n')) {
            if (line.trim()) {
              this.onRuntimeEvent({
                version: 1,
                serverId: session.serverId,
                line: line.trimEnd(),
                source: 'ssh-stdout',
              });
            }
          }
        }
        resolve({ ok, error });
      };

      const timer = setTimeout(() => finish(false, 'SSH command timed out.'), timeoutMs);

      proc.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
      proc.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
      proc.on('error', (err) => {
        const msg = cmd === 'sshpass' && err.message.includes('ENOENT')
          ? 'sshpass is not installed. Install it (e.g. brew install hudochenkov/sshpass/sshpass) or use an SSH key instead.'
          : `SSH process error: ${err.message}`;
        finish(false, msg);
      });
      proc.on('close', (code) => {
        if (code === 0) {
          finish(true);
        } else {
          finish(false, stderr.trim() || `SSH exited with code ${code ?? 'null'}.`);
        }
      });
    });
  }

  /**
   * Start a persistent SSH process streaming server logs as runtime events.
   * Tries systemd journal first, then falls back to tailing the StarMade log.
   * Session is not marked as error if the stream ends — admins can still run
   * commands; an informational event is emitted instead.
   */
  private startLogStream(session: AzureVmSession): void {
    const { serverId } = session;

    const sq = (s: string): string => `'${s.replace(/'/g, "'\\''")}'`;

    let logCommand: string;

    if (session.screenSessionName) {
      // tmux mode: pipe the session's stdout to a temp file (captures SQL, admin commands,
      // and all other stdout-only output), and concurrently tail the log file for log entries.
      // The trap ensures pipe-pane is stopped and the temp file removed when the SSH session ends.
      const safeSession = sq(session.screenSessionName);
      const parts: string[] = [
        `T=$(mktemp /tmp/.sml.XXXXXX 2>/dev/null)`,
        `tmux pipe-pane -t ${safeSession} "cat >> \\"$T\\"" 2>/dev/null`,
        `trap "tmux pipe-pane -t ${safeSession} 2>/dev/null; rm -f \\"$T\\"" EXIT INT TERM HUP`,
      ];
      if (session.serverRootPath) {
        const safeLog = sq(`${session.serverRootPath}/logs/serverlog.0.log`);
        parts.push(`( tail -F ${safeLog} 2>/dev/null & tail -F "$T" 2>/dev/null & wait )`);
      } else {
        parts.push(`( sudo journalctl -fu starmade --no-pager 2>/dev/null & tail -F "$T" 2>/dev/null & wait )`);
      }
      logCommand = parts.join('; ');
    } else {
      // No tmux session name: fall back to log file tailing or journalctl.
      const logCandidates: string[] = [];
      if (session.serverRootPath) {
        logCandidates.push(`tail -F ${sq(`${session.serverRootPath}/logs/serverlog.0.log`)} 2>/dev/null`);
      }
      logCandidates.push('tail -F ~/server/logs/serverlog.0.log 2>/dev/null');
      logCandidates.push('sudo journalctl -fu starmade --no-pager 2>/dev/null');
      logCandidates.push('echo "[StarMade Launcher] No log stream configured — provide the server root path and screen/tmux session name in the connect settings."');
      logCommand = logCandidates.join(' || ');
    }

    const { cmd, args, opts } = buildSpawnConfig(session, logCommand);
    const proc = spawn(cmd, args, opts);
    session.logStreamProc = proc;

    const emitLine = (line: string, source: 'ssh-stdout' | 'ssh-stderr'): void => {
      if (line.trim()) {
        this.onRuntimeEvent({ version: 1, serverId, line: line.trimEnd(), source });
      }
    };

    proc.stdout?.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString('utf8').split('\n')) emitLine(line, 'ssh-stdout');
    });
    proc.stderr?.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString('utf8').split('\n')) emitLine(line, 'ssh-stderr');
    });
    proc.on('close', () => {
      emitLine('[StarMade Launcher] SSH log stream ended.', 'ssh-stderr');
    });
  }
}
