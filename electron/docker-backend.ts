// ─── Docker remote backend ────────────────────────────────────────────────────
//
// Implements IRemoteBackend using the local `docker` CLI pointed at a remote
// daemon via `-H` (e.g. ssh://user@host or tcp://host:2375). Targets a single
// container running the StarMade server.
//
// Connection model:
//   connect()          – verify the container exists/runs (`docker inspect`),
//                        then stream its logs (`docker logs -f`).
//   sendAdminCommand() – `docker exec` into the container and inject the command
//                        into the server's screen/tmux session.
//   disconnect()       – kill the log stream and clear session state.
//   getStats()         – `docker stats --no-stream` for the Performance tab.
//
// Requires the `docker` CLI to be installed locally. For ssh:// hosts, SSH key
// auth must be available to the local ssh agent.

import { spawn, type ChildProcess } from 'node:child_process';
import type {
  IRemoteBackend,
  RemoteConnectOptions,
  RemoteConnectResult,
  RemoteCommandResult,
  RemoteConnectionStatus,
  RemoteRuntimeEvent,
  ServerMetricsSample,
} from './remote-backend-types.js';
import { dockerStatsRowToSample, makeUnavailableSample } from './server-metrics.js';

interface DockerSession {
  serverId: string;
  /** Docker daemon host for `-H` (empty string targets the local socket). */
  dockerHost: string;
  /** Container name or id. */
  container: string;
  /** Game host/port (informational only). */
  host: string;
  gamePort: number;
  /** screen/tmux session name inside the container for admin command injection. */
  screenSessionName?: string;
  state: 'connecting' | 'ready' | 'error';
  connectedAt: string;
  error?: string;
  logStreamProc?: ChildProcess;
}

/** Build the leading `docker -H host` arguments (host omitted when blank). */
function dockerBaseArgs(session: Pick<DockerSession, 'dockerHost'>): string[] {
  const host = session.dockerHost.trim();
  return host ? ['-H', host] : [];
}

export class DockerBackend implements IRemoteBackend {
  private readonly sessions = new Map<string, DockerSession>();
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
      dockerHost = '',
      dockerContainer = '',
      screenSessionName,
    } = options;

    const container = dockerContainer.trim();
    if (!container) {
      return { success: false, error: 'A Docker container name is required.' };
    }

    // Replace any existing session cleanly.
    this.disconnect(serverId);

    const session: DockerSession = {
      serverId,
      dockerHost: dockerHost.trim(),
      container,
      host,
      gamePort: port,
      screenSessionName: screenSessionName?.trim() || undefined,
      state: 'connecting',
      connectedAt: new Date().toISOString(),
    };
    this.sessions.set(serverId, session);
    this.onStatusChanged(this.buildStatus(session));

    // Verify the docker CLI is available and the container is running.
    const inspect = await this.runDocker(
      session,
      ['inspect', '-f', '{{.State.Running}}', container],
      12_000,
    );

    if (!this.sessions.has(serverId)) {
      return { success: false, error: 'Connection cancelled.' };
    }

    if (!inspect.ok) {
      const dockerMissing = /ENOENT|not found|not recognized/i.test(inspect.error ?? '');
      const containerMissing = /no such (object|container)/i.test(inspect.error ?? '');
      session.state = 'error';
      session.error = dockerMissing
        ? 'The `docker` CLI was not found on this machine. Install Docker to use this backend.'
        : containerMissing
          ? `Container "${container}" was not found on the Docker host.`
          : inspect.error || 'Failed to reach the Docker daemon.';
      this.onStatusChanged(this.buildStatus(session));
      return {
        success: false,
        error: session.error,
        status: this.buildStatus(session),
      };
    }

    if (inspect.stdout.trim() !== 'true') {
      session.state = 'error';
      session.error = `Container "${container}" exists but is not running.`;
      this.onStatusChanged(this.buildStatus(session));
      return { success: false, error: session.error, status: this.buildStatus(session) };
    }

    session.state = 'ready';
    this.onStatusChanged(this.buildStatus(session));
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
      backend: 'docker',
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
      return { success: false, error: 'Docker session is not ready.', reasonCode: 'not_ready' };
    }

    // StarMade console commands must be injected into the running server's
    // stdin via screen/tmux inside the container — base64-encode so the command
    // survives shell quoting.
    const b64 = Buffer.from(payload.command, 'utf8').toString('base64');
    const sessionNamesToTry = session.screenSessionName
      ? [session.screenSessionName]
      : ['StarMade', 'starmade', 'sm'];

    const screenAttempts = sessionNamesToTry.map(
      (n) => `screen -S ${n} -X stuff "$CMD"$'\\n' 2>/dev/null && exit 0`,
    );
    const tmuxAttempts = sessionNamesToTry.map(
      (n) => `tmux send-keys -t ${n} "$CMD" Enter 2>/dev/null && exit 0`,
    );
    const nameList = sessionNamesToTry.join(', ');

    // Final fallback: many StarMade containers run the server directly (no
    // screen/tmux), with the JVM reading from the container's stdin. Inject the
    // command into the server process's stdin via /proc/<pid>/fd/0. We locate
    // the StarMade JVM (newest matching process), then fall back to PID 1.
    //
    // The pattern uses a character class ([S]tarMade) so pgrep does not match
    // this delivery script's own command line (which contains the literal
    // string "StarMade"). We only write when fd 0 is a pipe — i.e. the
    // container was started with stdin open (docker run -i). Writing to a
    // /dev/null stdin (no -i) would silently succeed without reaching the server.
    const stdinFallback = [
      `SMPID=$(pgrep -nf '[S]tarMade' 2>/dev/null || pgrep -nx java 2>/dev/null || echo 1)`,
      `if [ -p /proc/$SMPID/fd/0 ]; then printf '%s\\n' "$CMD" > /proc/$SMPID/fd/0 2>/dev/null && exit 0; fi`,
      // A char-device stdin (e.g. /dev/pts/0) means the server is attached to a
      // TTY. Writing to a TTY slave is terminal output, not input, so the
      // command can't be injected — point the user at the tty:false fix.
      `if [ -c /proc/$SMPID/fd/0 ]; then HINT=" The server (pid $SMPID) has its console attached to a TTY (stdin is $(readlink /proc/$SMPID/fd/0 2>/dev/null)), so commands cannot be injected via stdin. Set tty:false but keep stdin_open:true in your container/compose config and recreate the container, or run the server in a screen/tmux session and set its name here."; fi`,
    ];

    const deliveryScript = [
      `CMD=$(printf '%s' '${b64}' | base64 -d)`,
      `HINT=""`,
      ...screenAttempts,
      ...tmuxAttempts,
      ...stdinFallback,
      `printf '%s\\n' "Cannot deliver command: tried screen/tmux sessions (${nameList}) and the StarMade process stdin (/proc/<pid>/fd/0).$HINT" >&2`,
      `exit 1`,
    ].join('; ');

    const result = await this.runDocker(
      session,
      ['exec', session.container, 'sh', '-c', deliveryScript],
      30_000,
    );

    if (!result.ok) {
      return {
        success: false,
        error: result.error || 'docker exec failed.',
        reasonCode: 'docker_command_failed',
        status: this.buildStatus(session),
      };
    }
    return { success: true, status: this.buildStatus(session) };
  }

  getStatusFor(serverId: string): RemoteConnectionStatus {
    const session = this.sessions.get(serverId);
    if (!session) return { serverId, backend: 'docker', connected: false, state: 'idle' };
    return this.buildStatus(session);
  }

  getStatuses(): RemoteConnectionStatus[] {
    return Array.from(this.sessions.values()).map((s) => this.buildStatus(s));
  }

  /** Sample container resource usage for the Performance tab. */
  async getStats(serverId: string): Promise<ServerMetricsSample> {
    const session = this.sessions.get(serverId);
    if (!session || session.state !== 'ready') {
      return makeUnavailableSample('Docker session is not connected.');
    }

    const result = await this.runDocker(
      session,
      ['stats', '--no-stream', '--format', '{{json .}}', session.container],
      12_000,
    );
    if (!result.ok) {
      return makeUnavailableSample(result.error || 'docker stats failed.');
    }

    const line = result.stdout.split('\n').map((l) => l.trim()).find(Boolean);
    if (!line) {
      return makeUnavailableSample('docker stats returned no data.');
    }

    try {
      const row = JSON.parse(line) as Parameters<typeof dockerStatsRowToSample>[0];
      return dockerStatsRowToSample(row);
    } catch {
      return makeUnavailableSample('Could not parse docker stats output.');
    }
  }

  // ─── Private helpers ─────────────────────────────────────────────────────────

  private buildStatus(session: DockerSession): RemoteConnectionStatus {
    const isReady = session.state === 'ready';
    return {
      serverId: session.serverId,
      backend: 'docker',
      connected: session.state !== 'error',
      state: session.state === 'connecting' ? 'connecting' : isReady ? 'ready' : 'error',
      isReady,
      host: session.host,
      port: session.gamePort,
      connectedAt: session.connectedAt,
      error: session.error,
      reasonCode: isReady ? 'ready' : session.state === 'error' ? 'docker_connect_failed' : undefined,
    };
  }

  /** Run a one-shot docker command and resolve when it exits. */
  private runDocker(
    session: DockerSession,
    args: string[],
    timeoutMs: number,
  ): Promise<{ ok: boolean; stdout: string; error?: string }> {
    return new Promise((resolve) => {
      const fullArgs = [...dockerBaseArgs(session), ...args];
      let proc: ChildProcess;
      try {
        proc = spawn('docker', fullArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (error) {
        resolve({ ok: false, stdout: '', error: String(error) });
        return;
      }

      let stdout = '';
      let stderr = '';
      let settled = false;

      const finish = (ok: boolean, error?: string): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ ok, stdout, error });
      };

      const timer = setTimeout(() => {
        try { proc.kill('SIGKILL'); } catch { /* ignore */ }
        finish(false, 'docker command timed out.');
      }, timeoutMs);

      proc.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
      proc.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
      proc.on('error', (err) => finish(false, err.message));
      proc.on('close', (code) => {
        if (code === 0) finish(true);
        else finish(false, stderr.trim() || `docker exited with code ${code ?? 'null'}.`);
      });
    });
  }

  /** Stream the container's logs as runtime events. */
  private startLogStream(session: DockerSession): void {
    const { serverId } = session;
    const fullArgs = [...dockerBaseArgs(session), 'logs', '-f', '--tail', '200', session.container];

    let proc: ChildProcess;
    try {
      proc = spawn('docker', fullArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      this.onRuntimeEvent({
        version: 1,
        serverId,
        line: `[StarMade Launcher] Failed to start docker log stream: ${String(error)}`,
        source: 'ssh-stderr',
      });
      return;
    }
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
      for (const line of chunk.toString('utf8').split('\n')) emitLine(line, 'ssh-stdout');
    });
    proc.on('close', () => {
      emitLine('[StarMade Launcher] Docker log stream ended.', 'ssh-stderr');
    });
  }
}
