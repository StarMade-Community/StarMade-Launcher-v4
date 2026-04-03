import { spawn, type SpawnOptions } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

export interface RemoteFileSession {
  serverId: string;
  protocol: 'ftp' | 'sftp';
  host: string;
  port: number;
  username: string;
  password?: string;
  sshKeyPath?: string;
  rootPath: string;
}

export interface RemoteFileEntry {
  name: string;
  relativePath: string;
  isDirectory: boolean;
  sizeBytes: number;
  isEditableText: boolean;
  nonEditableReason?: string;
}

const BINARY_EXTENSIONS = new Set([
  '.7z', '.a', '.avi', '.bin', '.bmp', '.class', '.dat', '.db', '.dll', '.dylib', '.ear', '.exe', '.gif',
  '.gz', '.ico', '.iso', '.jar', '.jpeg', '.jpg', '.lib', '.lock', '.lz', '.mp3', '.mp4', '.o', '.ogg', '.otf',
  '.pdf', '.png', '.rar', '.so', '.sqlite', '.tar', '.ttf', '.war', '.wav', '.webm', '.webp', '.woff', '.woff2', '.zip',
]);

function isEditableByExtension(name: string): boolean {
  const ext = path.extname(name).toLowerCase();
  return ext.length === 0 || !BINARY_EXTENSIONS.has(ext);
}

function sanitizeRelPath(relPath: string): string {
  const normalized = relPath.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\//, '');
  const parts = normalized.split('/').filter(Boolean);
  const safe: string[] = [];
  for (const part of parts) {
    if (part === '..') continue;
    if (part === '.') continue;
    safe.push(part);
  }
  return safe.join('/');
}

function resolvePath(session: RemoteFileSession, relPath: string): string {
  const root = session.rootPath.replace(/\/+$/, '');
  const safe = sanitizeRelPath(relPath);
  if (!safe) return root;
  return `${root}/${safe}`;
}

function buildSshBaseArgs(session: RemoteFileSession): string[] {
  const args: string[] = [
    '-o', 'BatchMode=yes',
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', 'ConnectTimeout=15',
    '-p', String(session.port),
  ];
  if (session.sshKeyPath?.trim()) {
    const keyPath = session.sshKeyPath.trim().replace(/^~(?=$|\/)/, os.homedir());
    args.push('-o', 'IdentitiesOnly=yes', '-i', keyPath);
  }
  args.push(`${session.username}@${session.host}`);
  return args;
}

function buildSshSpawnConfig(
  session: RemoteFileSession,
  command: string,
  stdinData?: Buffer,
): { cmd: string; args: string[]; opts: SpawnOptions } {
  const opts: SpawnOptions = { stdio: [stdinData ? 'pipe' : 'ignore', 'pipe', 'pipe'] };

  if (session.password) {
    const sshArgs: string[] = [
      '-o', 'StrictHostKeyChecking=accept-new',
      '-o', 'ConnectTimeout=15',
      '-o', 'PasswordAuthentication=yes',
      '-o', 'PubkeyAuthentication=no',
      '-p', String(session.port),
      `${session.username}@${session.host}`,
      command,
    ];
    return { cmd: 'sshpass', args: ['-p', session.password, 'ssh', ...sshArgs], opts };
  }

  return { cmd: 'ssh', args: [...buildSshBaseArgs(session), command], opts };
}

function runSshCommand(
  session: RemoteFileSession,
  command: string,
  timeoutMs = 30_000,
  stdinData?: Buffer,
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve) => {
    const { cmd, args, opts } = buildSshSpawnConfig(session, command, stdinData);
    const proc = spawn(cmd, args, opts);

    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode });
    };

    const timer = setTimeout(() => {
      try { proc.kill('SIGTERM'); } catch { /* ignore */ }
      finish(null);
    }, timeoutMs);

    proc.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
    proc.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
    proc.on('error', () => { finish(null); });
    proc.on('close', (code) => { finish(code); });

    if (stdinData && proc.stdin) {
      proc.stdin.write(stdinData);
      proc.stdin.end();
    }
  });
}

function parseFtpListLine(line: string): { name: string; isDirectory: boolean; sizeBytes: number } | null {
  const match = line.match(/^([\-d])[\w\-]{9}\s+\d+\s+\S+\s+\S+\s+(\d+)\s+\w+\s+[\d: ]+\s(.+)$/);
  if (!match) return null;
  return {
    isDirectory: match[1] === 'd',
    sizeBytes: Number.parseInt(match[2], 10) || 0,
    name: match[3].trim(),
  };
}

function buildFtpUrl(session: RemoteFileSession, relPath: string, isDir = false): string {
  const root = session.rootPath.replace(/\/+$/, '');
  const safe = sanitizeRelPath(relPath);
  const combined = safe ? `${root}/${safe}` : root;
  const encoded = combined.split('/').map((p) => encodeURIComponent(p)).join('/');
  return `ftp://${session.host}:${session.port}${encoded}${isDir ? '/' : ''}`;
}

async function runCurlCommand(
  args: string[],
  timeoutMs = 30_000,
  stdinFilePath?: string,
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve) => {
    const opts: SpawnOptions = { stdio: ['ignore', 'pipe', 'pipe'] };
    const proc = spawn('curl', args, opts);

    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode });
    };

    const timer = setTimeout(() => {
      try { proc.kill('SIGTERM'); } catch { /* ignore */ }
      finish(null);
    }, timeoutMs);

    proc.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
    proc.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
    proc.on('error', () => { finish(null); });
    proc.on('close', (code) => { finish(code); });
  });
}

export class RemoteFileBackend {
  private readonly sessions = new Map<string, RemoteFileSession>();

  setSession(session: RemoteFileSession): void {
    this.sessions.set(session.serverId, { ...session });
  }

  clearSession(serverId: string): void {
    this.sessions.delete(serverId);
  }

  hasSession(serverId: string): boolean {
    return this.sessions.has(serverId);
  }

  async listDirectory(serverId: string, remotePath: string): Promise<RemoteFileEntry[]> {
    const session = this.sessions.get(serverId);
    if (!session) throw new Error('No remote file session for this server.');

    if (session.protocol === 'sftp') {
      return this.sftpListDirectory(session, remotePath);
    }
    return this.ftpListDirectory(session, remotePath);
  }

  async readFile(
    serverId: string,
    remotePath: string,
    maxBytes?: number,
  ): Promise<{ content: string; truncated: boolean; error?: string }> {
    const session = this.sessions.get(serverId);
    if (!session) return { content: '', truncated: false, error: 'No remote file session for this server.' };

    if (session.protocol === 'sftp') {
      return this.sftpReadFile(session, remotePath, maxBytes);
    }
    return this.ftpReadFile(session, remotePath, maxBytes);
  }

  async writeFile(
    serverId: string,
    remotePath: string,
    content: string,
  ): Promise<{ success: boolean; error?: string }> {
    const session = this.sessions.get(serverId);
    if (!session) return { success: false, error: 'No remote file session for this server.' };

    if (session.protocol === 'sftp') {
      return this.sftpWriteFile(session, remotePath, content);
    }
    return this.ftpWriteFile(session, remotePath, content);
  }

  async renameFile(
    serverId: string,
    oldRelPath: string,
    newRelPath: string,
  ): Promise<{ success: boolean; error?: string }> {
    const session = this.sessions.get(serverId);
    if (!session) return { success: false, error: 'No remote file session for this server.' };

    if (session.protocol === 'sftp') {
      const oldAbs = resolvePath(session, oldRelPath);
      const newAbs = resolvePath(session, newRelPath);
      const result = await runSshCommand(session, `mv ${shellQuote(oldAbs)} ${shellQuote(newAbs)}`);
      if (result.exitCode !== 0) return { success: false, error: result.stderr.trim() || 'Rename failed.' };
      return { success: true };
    }

    const oldAbs = resolvePath(session, oldRelPath);
    const newAbs = resolvePath(session, newRelPath);
    const baseUrl = `ftp://${session.host}:${session.port}/`;
    const userArg = `${session.username}:${session.password ?? ''}`;
    const r = await runCurlCommand([baseUrl, '--user', userArg, '-Q', `RNFR ${oldAbs}`, '-Q', `RNTO ${newAbs}`, '-s']);
    if (r.exitCode !== 0) return { success: false, error: r.stderr.trim() || 'Rename failed.' };
    return { success: true };
  }

  async copyFile(
    serverId: string,
    srcRelPath: string,
    dstRelPath: string,
  ): Promise<{ success: boolean; error?: string }> {
    const session = this.sessions.get(serverId);
    if (!session) return { success: false, error: 'No remote file session for this server.' };

    if (session.protocol === 'sftp') {
      const srcAbs = resolvePath(session, srcRelPath);
      const dstAbs = resolvePath(session, dstRelPath);
      const result = await runSshCommand(session, `cp -r ${shellQuote(srcAbs)} ${shellQuote(dstAbs)}`);
      if (result.exitCode !== 0) return { success: false, error: result.stderr.trim() || 'Copy failed.' };
      return { success: true };
    }

    // FTP: read then write
    const readResult = await this.ftpReadFile(session, srcRelPath);
    if (readResult.error) return { success: false, error: readResult.error };
    return this.ftpWriteFile(session, dstRelPath, readResult.content);
  }

  async moveFile(
    serverId: string,
    srcRelPath: string,
    dstRelPath: string,
  ): Promise<{ success: boolean; error?: string }> {
    return this.renameFile(serverId, srcRelPath, dstRelPath);
  }

  async deleteFile(
    serverId: string,
    remotePath: string,
  ): Promise<{ success: boolean; error?: string }> {
    const session = this.sessions.get(serverId);
    if (!session) return { success: false, error: 'No remote file session for this server.' };

    if (session.protocol === 'sftp') {
      const absPath = resolvePath(session, remotePath);
      const result = await runSshCommand(session, `rm -rf ${shellQuote(absPath)}`);
      if (result.exitCode !== 0) return { success: false, error: result.stderr.trim() || 'Delete failed.' };
      return { success: true };
    }

    const absPath = resolvePath(session, remotePath);
    const baseUrl = `ftp://${session.host}:${session.port}/`;
    const userArg = `${session.username}:${session.password ?? ''}`;
    const r = await runCurlCommand([baseUrl, '--user', userArg, '-Q', `DELE ${absPath}`, '-s']);
    if (r.exitCode !== 0) return { success: false, error: r.stderr.trim() || 'Delete failed.' };
    return { success: true };
  }

  // ─── SFTP helpers ───────────────────────────────────────────────────────────

  private async sftpListDirectory(session: RemoteFileSession, relPath: string): Promise<RemoteFileEntry[]> {
    const absPath = resolvePath(session, relPath);
    const cmd = `find ${shellQuote(absPath)} -maxdepth 1 -mindepth 1 -printf '%y\\t%s\\t%f\\n' 2>/dev/null`;
    const result = await runSshCommand(session, cmd);

    if (result.exitCode !== 0 && result.stdout.trim() === '') {
      return [];
    }

    const entries: RemoteFileEntry[] = [];
    for (const line of result.stdout.split('\n')) {
      const trimmed = line.trimEnd();
      if (!trimmed) continue;
      const parts = trimmed.split('\t');
      if (parts.length < 3) continue;
      const typeChar = parts[0];
      const sizeBytes = Number.parseInt(parts[1], 10) || 0;
      const name = parts.slice(2).join('\t');
      if (!name || name === '.' || name === '..') continue;

      const isDirectory = typeChar === 'd';
      const relativePath = relPath ? `${sanitizeRelPath(relPath)}/${name}` : name;
      const editable = isDirectory || isEditableByExtension(name);

      entries.push({
        name,
        relativePath,
        isDirectory,
        sizeBytes: isDirectory ? 0 : sizeBytes,
        isEditableText: editable,
        nonEditableReason: editable ? undefined : `Cannot open ${relativePath}: binary files are not supported in the editor.`,
      });
    }

    entries.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return entries;
  }

  private async sftpReadFile(
    session: RemoteFileSession,
    relPath: string,
    maxBytes?: number,
  ): Promise<{ content: string; truncated: boolean; error?: string }> {
    const absPath = resolvePath(session, relPath);

    if (maxBytes && maxBytes > 0) {
      const sizeResult = await runSshCommand(session, `wc -c < ${shellQuote(absPath)} 2>/dev/null`);
      const fileSize = Number.parseInt(sizeResult.stdout.trim(), 10) || 0;
      const truncated = fileSize > maxBytes;
      const readCmd = `tail -c ${maxBytes} ${shellQuote(absPath)} 2>/dev/null`;
      const result = await runSshCommand(session, readCmd);
      if (result.exitCode !== 0) return { content: '', truncated: false, error: result.stderr.trim() || 'Failed to read file.' };
      return { content: result.stdout, truncated };
    }

    const result = await runSshCommand(session, `cat ${shellQuote(absPath)} 2>/dev/null`);
    if (result.exitCode !== 0) return { content: '', truncated: false, error: result.stderr.trim() || 'Failed to read file.' };
    return { content: result.stdout, truncated: false };
  }

  private async sftpWriteFile(
    session: RemoteFileSession,
    relPath: string,
    content: string,
  ): Promise<{ success: boolean; error?: string }> {
    const absPath = resolvePath(session, relPath);
    const encoded = Buffer.from(content, 'utf8').toString('base64');
    const stdinData = Buffer.from(encoded, 'utf8');
    const cmd = `base64 -d > ${shellQuote(absPath)}`;
    const result = await runSshCommand(session, cmd, 30_000, stdinData);
    if (result.exitCode !== 0) return { success: false, error: result.stderr.trim() || 'Failed to write file.' };
    return { success: true };
  }

  // ─── FTP helpers ────────────────────────────────────────────────────────────

  private async ftpListDirectory(session: RemoteFileSession, relPath: string): Promise<RemoteFileEntry[]> {
    const url = buildFtpUrl(session, relPath, true);
    const userArg = `${session.username}:${session.password ?? ''}`;
    const result = await runCurlCommand([url, '--user', userArg, '-s', '--list-only']);

    if (result.exitCode !== 0 && result.stdout.trim() === '') return [];

    let lines = result.stdout.split('\n').map((l) => l.trimEnd()).filter(Boolean);

    // If the output looks like bare names (--list-only format), use it directly
    const looksLikeBareNames = lines.every((l) => !l.startsWith('-') && !l.startsWith('d') && !l.includes('  '));

    const entries: RemoteFileEntry[] = [];

    if (looksLikeBareNames) {
      // Try LIST format by dropping --list-only
      const listResult = await runCurlCommand([url, '--user', userArg, '-s']);
      const listLines = listResult.stdout.split('\n').map((l) => l.trimEnd()).filter(Boolean);
      if (listLines.length > 0 && (listLines[0].startsWith('-') || listLines[0].startsWith('d'))) {
        lines = listLines;
      }
    }

    for (const line of lines) {
      if (line.startsWith('-') || line.startsWith('d')) {
        const parsed = parseFtpListLine(line);
        if (!parsed || !parsed.name || parsed.name === '.' || parsed.name === '..') continue;
        const relativePath = relPath ? `${sanitizeRelPath(relPath)}/${parsed.name}` : parsed.name;
        const editable = parsed.isDirectory || isEditableByExtension(parsed.name);
        entries.push({
          name: parsed.name,
          relativePath,
          isDirectory: parsed.isDirectory,
          sizeBytes: parsed.isDirectory ? 0 : parsed.sizeBytes,
          isEditableText: editable,
          nonEditableReason: editable ? undefined : `Cannot open ${relativePath}: binary files are not supported in the editor.`,
        });
      } else {
        // Bare name
        const name = line.trim();
        if (!name || name === '.' || name === '..') continue;
        const relativePath = relPath ? `${sanitizeRelPath(relPath)}/${name}` : name;
        const editable = isEditableByExtension(name);
        entries.push({
          name,
          relativePath,
          isDirectory: false,
          sizeBytes: 0,
          isEditableText: editable,
          nonEditableReason: editable ? undefined : `Cannot open ${relativePath}: binary files are not supported in the editor.`,
        });
      }
    }

    entries.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return entries;
  }

  private async ftpReadFile(
    session: RemoteFileSession,
    relPath: string,
    maxBytes?: number,
  ): Promise<{ content: string; truncated: boolean; error?: string }> {
    const url = buildFtpUrl(session, relPath, false);
    const userArg = `${session.username}:${session.password ?? ''}`;
    const result = await runCurlCommand([url, '--user', userArg, '-s'], 60_000);

    if (result.exitCode !== 0) return { content: '', truncated: false, error: result.stderr.trim() || 'Failed to read file.' };

    let content = result.stdout;
    let truncated = false;

    if (maxBytes && maxBytes > 0 && Buffer.byteLength(content, 'utf8') > maxBytes) {
      truncated = true;
      const buf = Buffer.from(content, 'utf8').slice(-maxBytes);
      content = buf.toString('utf8');
    }

    return { content, truncated };
  }

  private async ftpWriteFile(
    session: RemoteFileSession,
    relPath: string,
    content: string,
  ): Promise<{ success: boolean; error?: string }> {
    const tmpPath = path.join(os.tmpdir(), `sm-launcher-ftp-${Date.now()}.tmp`);
    try {
      fs.writeFileSync(tmpPath, content, 'utf8');
      const url = buildFtpUrl(session, relPath, false);
      const userArg = `${session.username}:${session.password ?? ''}`;
      const result = await runCurlCommand([url, '--user', userArg, '-T', tmpPath, '-s'], 30_000);
      if (result.exitCode !== 0) return { success: false, error: result.stderr.trim() || 'Failed to write file.' };
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    } finally {
      try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    }
  }
}

function shellQuote(str: string): string {
  return `'${str.replace(/'/g, "'\\''")}'`;
}