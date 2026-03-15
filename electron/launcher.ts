/**
 * Game and server process launching (Phase 5).
 *
 * Handles spawning StarMade as a child process with proper Java arguments,
 * memory settings, and working directory.
 */

import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import { app, shell } from 'electron';
import { getRequiredJavaVersion, getJvmArgsForJava, resolveJavaPath } from './java.js';
import { BrowserWindow } from 'electron';
import { storeGet, storeSet } from './store.js';

// ─── Process tracking ─────────────────────────────────────────────────────────

interface RunningProcess {
  process: ChildProcess;
  installationId: string;
  isServer: boolean;
  startTime: number;
  logPath: string;
  logStream: fs.WriteStream;
  logFileWatcher?: fs.FSWatcher;
  lastLogPosition: number;
  playTimeSettled?: boolean;
}

export interface ServerLogFileInfo {
  fileName: string;
  relativePath: string;
  sizeBytes: number;
  modifiedMs: number;
  categoryId: string;
  categoryLabel: string;
}

export interface ServerLogCategoryInfo {
  id: string;
  label: string;
  files: ServerLogFileInfo[];
}

export interface ServerLogCatalog {
  categories: ServerLogCategoryInfo[];
  defaultRelativePath: string | null;
}

const runningProcesses = new Map<string, RunningProcess>();
const PLAY_TIME_STORE_KEY = 'playTimeByInstallationMs';

function sanitizePlayTimeRecord(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  const record: Record<string, number> = {};
  for (const [key, rawMs] of Object.entries(value as Record<string, unknown>)) {
    if (typeof rawMs !== 'number' || !Number.isFinite(rawMs) || rawMs <= 0) continue;
    record[key] = Math.floor(rawMs);
  }
  return record;
}

let persistedPlayTimeByInstallationMs: Record<string, number> = sanitizePlayTimeRecord(storeGet(PLAY_TIME_STORE_KEY));

function persistPlayTime(): void {
  storeSet(PLAY_TIME_STORE_KEY, persistedPlayTimeByInstallationMs);
}

function addPlayTimeForSession(installationId: string, durationMs: number): void {
  if (!installationId || !Number.isFinite(durationMs) || durationMs <= 0) return;

  const existing = persistedPlayTimeByInstallationMs[installationId] ?? 0;
  persistedPlayTimeByInstallationMs = {
    ...persistedPlayTimeByInstallationMs,
    [installationId]: existing + Math.floor(durationMs),
  };
  persistPlayTime();
}

function settlePlayTimeForRunningProcess(running: RunningProcess): void {
  if (running.playTimeSettled) return;
  running.playTimeSettled = true;
  if (running.isServer) return;
  addPlayTimeForSession(running.installationId, Date.now() - running.startTime);
}

function quitLauncherIfIdle(): void {
  if (process.platform === 'darwin') return;
  if (runningProcesses.size > 0) return;
  if (BrowserWindow.getAllWindows().length > 0) return;

  app.quit();
}

export function hasRunningGames(): boolean {
  return runningProcesses.size > 0;
}

export function getPlayTimeTotals(installationIds?: string[]): { byInstallationId: Record<string, number>; totalMs: number } {
  const resultByInstallationId: Record<string, number> = {};

  // Snapshot persisted totals first.
  if (Array.isArray(installationIds) && installationIds.length > 0) {
    for (const id of installationIds) {
      if (!id) continue;
      resultByInstallationId[id] = persistedPlayTimeByInstallationMs[id] ?? 0;
    }
  } else {
    Object.assign(resultByInstallationId, persistedPlayTimeByInstallationMs);
  }

  // Add currently-running session time so UI can update live.
  for (const running of runningProcesses.values()) {
    if (running.isServer) continue;
    if (Array.isArray(installationIds) && installationIds.length > 0 && !installationIds.includes(running.installationId)) {
      continue;
    }

    const accumulated = resultByInstallationId[running.installationId] ?? 0;
    resultByInstallationId[running.installationId] = accumulated + Math.max(0, Date.now() - running.startTime);
  }

  const totalMs = Object.values(resultByInstallationId).reduce((sum, value) => sum + value, 0);
  return { byInstallationId: resultByInstallationId, totalMs };
}

/**
 * Send a log event to all renderer windows.
 */
function sendLogEvent(installationId: string, level: 'INFO' | 'WARNING' | 'ERROR' | 'FATAL' | 'DEBUG' | 'stdout' | 'stderr', message: string): void {
  BrowserWindow.getAllWindows().forEach(window => {
    if (!window.isDestroyed()) {
      window.webContents.send('game:log', { installationId, level, message });
    }
  });
}

/**
 * Parse a [CHANNELROUTER] stderr line and emit a chat message event if matched.
 *
 * The server writes lines like:
 *   [CHANNELROUTER] RECEIVED MESSAGE ON <state>: [CHAT][sender=Alice][receiverType=CHANNEL][receiver=all][message=Hello]
 */
function tryEmitChatMessage(installationId: string, line: string): void {
  // Must start with [CHANNELROUTER] RECEIVED MESSAGE ON
  if (!line.includes('[CHANNELROUTER]') || !line.includes('[CHAT]')) return;

  const senderMatch = line.match(/\[sender=([^\]]*)\]/);
  const receiverTypeMatch = line.match(/\[receiverType=([^\]]*)\]/);
  // Use negative lookahead to avoid matching [receiverType=...] instead of [receiver=...]
  const receiverMatch = line.match(/\[receiver=(?!Type)([^\]]*)\]/);
  const messageMatch = line.match(/\[message=([\s\S]*)\]$/);

  if (!senderMatch || !receiverTypeMatch || !receiverMatch || !messageMatch) return;

  const sender = senderMatch[1];
  const receiverType = receiverTypeMatch[1];
  const receiver = receiverMatch[1];
  const text = messageMatch[1];
  const timestamp = new Date().toISOString();

  const payload = { installationId, sender, receiverType, receiver, text, timestamp };

  BrowserWindow.getAllWindows().forEach(win => {
    if (!win.isDestroyed()) {
      win.webContents.send('game:chat-message', payload);
    }
  });
}

/**
 * Parse a StarMade log line to extract level and message.
 * Example format: "[2024-03-11 14:23:45] [INFO] Loading game data..."
 */
export function parseStarMadeLogLine(line: string): { level: 'INFO' | 'WARNING' | 'ERROR' | 'FATAL' | 'DEBUG'; message: string } | null {
  // Match: [timestamp] [LEVEL] message
  const match = line.match(/^\[([^\]]+)\]\s+\[([^\]]+)\]\s+(.+)$/);
  if (!match) return null;
  
  const level = match[2].toUpperCase();
  const message = match[3];
  
  // Validate level
  if (['INFO', 'WARNING', 'ERROR', 'FATAL', 'DEBUG'].includes(level)) {
    return { level: level as any, message };
  }
  
  return null;
}

/**
 * Tail the StarMade log file and emit new lines to the renderer.
 */
function tailStarMadeLog(installationId: string, installationPath: string): fs.FSWatcher | undefined {
  const logFilePath = path.join(installationPath, 'logs', 'logstarmade.0.log');
  
  // Check if log file exists
  if (!fs.existsSync(logFilePath)) {
    console.log(`[Launcher] Log file not found yet: ${logFilePath}`);
    return undefined;
  }
  
  let lastPosition = 0;
  
  // Read initial content
  try {
    const stat = fs.statSync(logFilePath);
    lastPosition = stat.size;
  } catch (err) {
    console.error(`[Launcher] Failed to stat log file:`, err);
  }
  
  // Watch for changes
  const watcher = fs.watch(logFilePath, (eventType) => {
    if (eventType === 'change') {
      try {
        const stat = fs.statSync(logFilePath);
        const currentSize = stat.size;
        
        if (currentSize > lastPosition) {
          // Read new content
          const stream = fs.createReadStream(logFilePath, {
            start: lastPosition,
            end: currentSize,
            encoding: 'utf8',
          });
          
          let buffer = '';
          stream.on('data', (chunk) => {
            buffer += chunk;
            const lines = buffer.split('\n');
            
            // Keep the last incomplete line in the buffer
            buffer = lines.pop() || '';
            
            // Process complete lines
            lines.forEach(line => {
              if (line.trim()) {
                const parsed = parseStarMadeLogLine(line);
                if (parsed) {
                  sendLogEvent(installationId, parsed.level, parsed.message);
                } else {
                  // Unparsed line, send as INFO
                  sendLogEvent(installationId, 'INFO', line);
                }
              }
            });
          });
          
          stream.on('end', () => {
            lastPosition = currentSize;
          });
          
          stream.on('error', (err) => {
            console.error(`[Launcher] Error reading log file:`, err);
          });
        }
      } catch (err) {
        console.error(`[Launcher] Error tailing log file:`, err);
      }
    }
  });
  
  console.log(`[Launcher] Now tailing log file: ${logFilePath}`);
  
  return watcher;
}

/**
 * Heuristically decide whether a line written to stderr represents a genuine
 * Java exception / error or just routine JVM diagnostic output.
 *
 * StarMade (and the JVM itself) writes a lot of normal informational content
 * to stderr (OpenGL driver messages, Lwjgl probes, GC stats, etc.).  We only
 * want to surface lines as ERROR when they look like:
 *   - A Java exception class  ("NullPointerException: …", "Exception in thread …")
 *   - A "Caused by:" chain entry
 *   - A stack-trace frame     ("  at com.example.Foo.bar(Foo.java:42)")
 *   - An explicit [ERROR]/[FATAL] prefix in the text
 */
export function isStderrError(line: string): boolean {
  // "SomeException:" or "SomeException " — catches NullPointerException, etc.
  if (/\w+Exception[:\s]/.test(line)) return true;
  // "Exception in thread "main" …"
  if (/Exception in thread/.test(line)) return true;
  // Caused-by chain
  if (/^\s*Caused by:/.test(line)) return true;
  // Stack-trace frame: "  at fully.qualified.ClassName.method(File.java:42)"
  if (/^\s+at [\w$.<>]+\(/.test(line)) return true;
  // "SomeError:" — OutOfMemoryError, StackOverflowError, etc.
  if (/\w+Error:/.test(line)) return true;
  // Explicit level markers that may appear in piped sub-process output
  if (/\[ERROR]|\[FATAL]|^ERROR:|^FATAL:/i.test(line)) return true;

  return false;
}

// ─── Launch game ──────────────────────────────────────────────────────────────

export interface LaunchOptions {
  installationId: string;
  installationPath: string;
  starMadeVersion: string;
  minMemory?: number;
  maxMemory?: number;
  jvmArgs?: string;
  customJavaPath?: string;
  isServer?: boolean;
  serverPort?: number;
  launcherDir: string;
  /** Access token from the StarMade registry. Passed as `-auth <token>` when present. */
  authToken?: string;
  /**
   * Server address for the `-uplink` argument (direct-connect to a world/server).
   * Use `'localhost'` for singleplayer worlds or a remote IP for multiplayer.
   * Omit to launch the game normally without auto-connecting.
   */
  uplink?: string;
  /** Port for the `-uplink` server. Defaults to 4242 when `uplink` is set. */
  uplinkPort?: number;
  /** Enabled mod IDs. Passed as a comma-separated list after the `-uplink` port. */
  modIds?: string[];
}

export interface LaunchResult {
  success: boolean;
  pid?: number;
  error?: string;
}

/**
 * Launch StarMade or a StarMade server as a child process.
 */
export async function launchGame(options: LaunchOptions): Promise<LaunchResult> {
  const {
    installationId,
    installationPath,
    starMadeVersion,
    minMemory = 1024,
    maxMemory = 2048,
    jvmArgs = '',
    customJavaPath,
    isServer = false,
    serverPort,
    launcherDir,
    authToken,
    uplink,
    uplinkPort,
    modIds,
  } = options;

  // Check if already running
  if (runningProcesses.has(installationId)) {
    return {
      success: false,
      error: 'This installation is already running',
    };
  }

  try {
    // Determine required Java version
    const requiredJavaVersion = getRequiredJavaVersion(starMadeVersion);
    console.log(`[Launcher] StarMade ${starMadeVersion} requires Java ${requiredJavaVersion}`);

    // Resolve Java executable.
    // Only use customJavaPath if the file actually exists on disk.  A common
    // failure mode for newly-created installations is that customJavaPath is
    // pre-populated with the *expected* bundled JRE path (e.g.
    // ~/.config/starmade-launcher/jre8/bin/java) before Java has been
    // downloaded, which causes a spawn ENOENT error.  When the custom path
    // does not exist we fall back to the standard auto-resolution logic so
    // that either the bundled JRE (once downloaded) or a system-installed Java
    // of the correct version is found instead.
    let javaPath: string | null = null;

    if (customJavaPath) {
      if (fs.existsSync(customJavaPath)) {
        javaPath = customJavaPath;
      } else {
        console.warn(`[Launcher] Custom Java path not found: ${customJavaPath} — falling back to auto-resolve`);
      }
    }

    if (!javaPath) {
      javaPath = await resolveJavaPath(requiredJavaVersion, launcherDir);
    }

    if (!javaPath) {
      return {
        success: false,
        error: `Java ${requiredJavaVersion} not found. Please install Java ${requiredJavaVersion} in Settings.`,
      };
    }

    console.log(`[Launcher] Using Java: ${javaPath}`);

     // Create logs directory
    const logsDir = path.join(installationPath, 'logs');
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    // Create log file with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const logFileName = `starmade-${timestamp}.log`;
    const logPath = path.join(logsDir, logFileName);
    const logStream = fs.createWriteStream(logPath, { flags: 'a' });

    sendLogEvent(installationId, 'INFO', `Starting StarMade ${starMadeVersion}`);
    sendLogEvent(installationId, 'INFO', `Java: ${javaPath}`);
    sendLogEvent(installationId, 'INFO', `Log file: ${logPath}`);

    // Build JVM arguments
    const jvmArgList = [
      ...getJvmArgsForJava(requiredJavaVersion),
      `-Xms${minMemory}M`,
      `-Xmx${maxMemory}M`,
    ];

    // Add custom JVM args if provided
    if (jvmArgs.trim()) {
      jvmArgList.push(...jvmArgs.trim().split(/\s+/));
    }

    // Build full command
    const args = [
      ...jvmArgList,
      '-jar',
      'StarMade.jar',
      '-force' //StarMade requires this for some stupid reason
    ];

    // Add server-specific arguments
    if (isServer) {
      args.push('-server');
      if (serverPort) {
        args.push('-port', String(serverPort));
      }
    }

    // Pass the authentication token to the game so players don't need to
    // log in again through the in-game menu. Modern Starter parsing accepts
    // "-auth <token>" directly, so keep token as a separate argv entry.
    if (authToken) {
      args.push('-auth', authToken);
      sendLogEvent(installationId, 'INFO', 'Auth token injected.');
    }

    // Direct-connect to a world or server via -uplink.
    // Format: -uplink <address> <port> [<comma-separated-mod-ids>]
    if (uplink) {
      args.push('-uplink', uplink, String(uplinkPort ?? 4242));
      if (modIds && modIds.length > 0) {
        args.push(modIds.join(','));
      }
    }

    // Build a redacted copy of args for logging so the auth token is never
    // written to any log in plaintext.
    const safeArgs = authToken
      ? args.map((a) => {
          if (a === authToken) return '[REDACTED]';
          if (a.startsWith('-auth=')) return '-auth=[REDACTED]';
          if (a.startsWith('-auth ')) return '-auth [REDACTED]';
          return a;
        })
      : args;

    console.log(`[Launcher] Launching: ${javaPath} ${safeArgs.join(' ')}`);
    console.log(`[Launcher] Working directory: ${installationPath}`);

    sendLogEvent(installationId, 'INFO', `Command: ${safeArgs.join(' ')}`);

    // Spawn the process.
    // For server processes we open stdin as a pipe so we can send console
    // commands (e.g. admin broadcast messages) while the server is running.
    const child = spawn(javaPath, args, {
      cwd: installationPath,
      stdio: [isServer ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      detached: false,
    });

    // Track the process
    runningProcesses.set(installationId, {
      process: child,
      installationId,
      isServer,
      startTime: Date.now(),
      logPath,
      logStream,
      lastLogPosition: 0,
    });

    // Wait a moment for the game to create the log file, then start tailing it
    setTimeout(() => {
      const running = runningProcesses.get(installationId);
      if (running) {
        const watcher = tailStarMadeLog(installationId, installationPath);
        if (watcher) {
          running.logFileWatcher = watcher;
        }
      }
    }, 2000); // Wait 2 seconds for game to start and create log file

    // Log stdout
    child.stdout?.on('data', (data) => {
      const lines = data.toString().split('\n');
      lines.forEach((line: string) => {
        if (line.trim()) {
          console.log(`[Game ${installationId}] ${line}`);
          logStream.write(`[STDOUT] ${line}\n`);
          sendLogEvent(installationId, 'stdout', line);
        }
      });
    });

    // Log stderr
    child.stderr?.on('data', (data) => {
      const lines = data.toString().split('\n');
      lines.forEach((line: string) => {
        if (line.trim()) {
          console.error(`[Game ${installationId}] ${line}`);
          logStream.write(`[STDERR] ${line}\n`);
          // Parse live chat messages from the ChannelRouter output
          tryEmitChatMessage(installationId, line);
          // Only elevate to ERROR when the line looks like a real Java
          // exception or error; everything else stays as the neutral 'stderr'
          // level so it doesn't pollute the errors filter in the log viewer.
          const level = isStderrError(line) ? 'ERROR' : 'stderr';
          sendLogEvent(installationId, level, line);
        }
      });
    });

    // Handle process exit
    child.on('exit', (code, signal) => {
      console.log(`[Launcher] Process ${installationId} exited with code ${code}, signal ${signal}`);
      const msg = `Process exited with code ${code}${signal ? `, signal ${signal}` : ''}`;
      logStream.write(`[INFO] ${msg}\n`);
      sendLogEvent(installationId, 'INFO', msg);
      
      const running = runningProcesses.get(installationId);
      if (running) {
        settlePlayTimeForRunningProcess(running);
        running.logStream.end();
        running.logFileWatcher?.close();
      }
      runningProcesses.delete(installationId);
      quitLauncherIfIdle();
    });

    // Handle process errors
    child.on('error', (err) => {
      console.error(`[Launcher] Process ${installationId} error:`, err);
      const msg = `Process error: ${err.message}`;
      logStream.write(`[ERROR] ${msg}\n`);
      sendLogEvent(installationId, 'ERROR', msg);
      
      const running = runningProcesses.get(installationId);
      if (running) {
        settlePlayTimeForRunningProcess(running);
        running.logStream.end();
        running.logFileWatcher?.close();
      }
      runningProcesses.delete(installationId);
      quitLauncherIfIdle();
    });

    return {
      success: true,
      pid: child.pid,
    };

  } catch (error) {
    console.error(`[Launcher] Failed to launch ${installationId}:`, error);
    return {
      success: false,
      error: String(error),
    };
  }
}

// ─── Process management ───────────────────────────────────────────────────────

/**
 * Stop a running game or server process.
 */
export function stopGame(installationId: string): boolean {
  const running = runningProcesses.get(installationId);
  
  if (!running) {
    return false;
  }

  try {
    settlePlayTimeForRunningProcess(running);
    running.process.kill('SIGTERM');
    runningProcesses.delete(installationId);
    quitLauncherIfIdle();
    console.log(`[Launcher] Stopped process ${installationId}`);
    return true;
  } catch (error) {
    console.error(`[Launcher] Failed to stop ${installationId}:`, error);
    return false;
  }
}

/**
 * Check if a game or server is currently running.
 */
export function getGameStatus(installationId: string): { running: boolean; pid?: number; uptime?: number } {
  const running = runningProcesses.get(installationId);
  
  if (!running) {
    return { running: false };
  }

  return {
    running: true,
    pid: running.process.pid,
    uptime: Date.now() - running.startTime,
  };
}

/**
 * Get all running installations/servers.
 */
export function getAllRunningGames(): Array<{ installationId: string; pid?: number; isServer: boolean; uptime: number }> {
  const result: Array<{ installationId: string; pid?: number; isServer: boolean; uptime: number }> = [];
  
  for (const [id, proc] of runningProcesses.entries()) {
    result.push({
      installationId: id,
      pid: proc.process.pid,
      isServer: proc.isServer,
      uptime: Date.now() - proc.startTime,
    });
  }
  
  return result;
}

/**
 * Get the log file path for a running game/server.
 */
export function getLogPath(installationId: string): string | null {
  const running = runningProcesses.get(installationId);
  return running ? running.logPath : null;
}

/**
 * Open the logs directory for an installation in the system file manager.
 */
export function openLogLocation(installationPath: string): void {
  const logsDir = path.join(installationPath, 'logs');
  
  if (fs.existsSync(logsDir)) {
    shell.openPath(logsDir);
  } else {
    shell.openPath(installationPath);
  }
}

/**
 * Delete all files/directories inside the installation's logs folder.
 */
export function clearServerLogFiles(installationPath: string): { success: boolean; deletedCount: number; error?: string } {
  const logsDir = path.resolve(path.join(installationPath, 'logs'));

  try {
    if (!fs.existsSync(logsDir)) {
      return { success: true, deletedCount: 0 };
    }

    const stats = fs.statSync(logsDir);
    if (!stats.isDirectory()) {
      return { success: false, deletedCount: 0, error: 'Logs path is not a directory.' };
    }

    let deletedCount = 0;
    for (const entry of fs.readdirSync(logsDir, { withFileTypes: true })) {
      const entryPath = path.join(logsDir, entry.name);
      fs.rmSync(entryPath, { recursive: true, force: true });
      deletedCount += 1;
    }

    return { success: true, deletedCount };
  } catch (error) {
    return {
      success: false,
      deletedCount: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Get GraphicsInfo.txt content if it exists in the installation's logs folder.
 */
export function getGraphicsInfo(installationPath: string): string | null {
  const graphicsInfoPath = path.join(installationPath, 'logs', 'GraphicsInfo.txt');
  
  try {
    if (fs.existsSync(graphicsInfoPath)) {
      return fs.readFileSync(graphicsInfoPath, 'utf8');
    }
  } catch (error) {
    console.error('[Launcher] Failed to read GraphicsInfo.txt:', error);
  }
  
  return null;
}

function getLogCategory(fileName: string): { id: string; label: string } {
  const lower = fileName.toLowerCase();

  if (/^logstarmade\.\d+\.log$/i.test(fileName)) {
    return {
      id: 'starmade-rotated',
      label: 'StarMade Rotated Logs (logstarmade.n.log)',
    };
  }

  if (/^starmade-.*\.log$/i.test(fileName)) {
    return {
      id: 'launcher-session',
      label: 'Launcher Session Logs (starmade-*.log)',
    };
  }

  if (/^serverlog\.\d+\.log$/i.test(fileName)) {
    return {
      id: 'server-rotated',
      label: 'Server Rotated Logs (serverlog.n.log)',
    };
  }

  if (/^hs_err_pid\d+\.log$/i.test(fileName)) {
    return {
      id: 'jvm-crash',
      label: 'JVM Crash Dumps (hs_err_pid*.log)',
    };
  }

  if (lower.endsWith('.log')) {
    const normalizedPattern = lower.replace(/\d+/g, 'n');
    return {
      id: `pattern:${normalizedPattern}`,
      label: `${normalizedPattern}`,
    };
  }

  return {
    id: 'other',
    label: 'Other Log Files',
  };
}

export function listServerLogFiles(installationPath: string): ServerLogCatalog {
  const logsDir = path.join(installationPath, 'logs');
  if (!fs.existsSync(logsDir)) {
    return { categories: [], defaultRelativePath: null };
  }

  const files: ServerLogFileInfo[] = [];

  for (const entry of fs.readdirSync(logsDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (entry.name.toLowerCase() === 'graphicsinfo.txt') continue;
    if (entry.name.toLowerCase().endsWith('.lck')) continue;

    const filePath = path.join(logsDir, entry.name);
    let stat: fs.Stats;

    try {
      stat = fs.statSync(filePath);
    } catch {
      continue;
    }

    const category = getLogCategory(entry.name);

    files.push({
      fileName: entry.name,
      relativePath: entry.name,
      sizeBytes: stat.size,
      modifiedMs: stat.mtimeMs,
      categoryId: category.id,
      categoryLabel: category.label,
    });
  }

  const categoryMap = new Map<string, ServerLogCategoryInfo>();
  for (const file of files) {
    const existing = categoryMap.get(file.categoryId);
    if (existing) {
      existing.files.push(file);
    } else {
      categoryMap.set(file.categoryId, {
        id: file.categoryId,
        label: file.categoryLabel,
        files: [file],
      });
    }
  }

  for (const category of categoryMap.values()) {
    if (category.id === 'starmade-rotated') {
      category.files.sort((a, b) => {
        const getIndex = (name: string) => {
          const match = name.match(/^logstarmade\.(\d+)\.log$/i);
          return match ? Number.parseInt(match[1], 10) : Number.MAX_SAFE_INTEGER;
        };
        return getIndex(a.fileName) - getIndex(b.fileName);
      });
    } else if (category.id === 'server-rotated') {
      category.files.sort((a, b) => {
        const getIndex = (name: string) => {
          const match = name.match(/^serverlog\.(\d+)\.log$/i);
          return match ? Number.parseInt(match[1], 10) : Number.MAX_SAFE_INTEGER;
        };
        return getIndex(a.fileName) - getIndex(b.fileName);
      });
    } else {
      category.files.sort((a, b) => b.modifiedMs - a.modifiedMs || a.fileName.localeCompare(b.fileName));
    }
  }

  const categoryPriority: Record<string, number> = {
    'starmade-rotated': 0,
    'server-rotated': 1,
    'launcher-session': 2,
    'jvm-crash': 3,
    other: 999,
  };

  const categories = Array.from(categoryMap.values()).sort((a, b) => {
    const aPriority = a.id in categoryPriority ? categoryPriority[a.id] : 100;
    const bPriority = b.id in categoryPriority ? categoryPriority[b.id] : 100;
    if (aPriority !== bPriority) return aPriority - bPriority;
    return a.label.localeCompare(b.label);
  });

  const newestStarMade = files
    .filter((file) => /^logstarmade\.\d+\.log$/i.test(file.fileName))
    .sort((a, b) => {
      const aMatch = a.fileName.match(/^logstarmade\.(\d+)\.log$/i);
      const bMatch = b.fileName.match(/^logstarmade\.(\d+)\.log$/i);
      const aIndex = aMatch ? Number.parseInt(aMatch[1], 10) : Number.MAX_SAFE_INTEGER;
      const bIndex = bMatch ? Number.parseInt(bMatch[1], 10) : Number.MAX_SAFE_INTEGER;
      return aIndex - bIndex;
    });

  const defaultRelativePath = newestStarMade[0]?.relativePath
    ?? categories[0]?.files[0]?.relativePath
    ?? null;

  return { categories, defaultRelativePath };
}

export function readServerLogFile(
  installationPath: string,
  relativePath: string,
  maxBytes = 2 * 1024 * 1024,
): { content: string; truncated: boolean } {
  const logsDir = path.resolve(path.join(installationPath, 'logs'));
  const filePath = path.resolve(path.join(logsDir, relativePath));

  if (!filePath.startsWith(`${logsDir}${path.sep}`) && filePath !== logsDir) {
    throw new Error('Invalid log file path.');
  }

  const stat = fs.statSync(filePath);
  if (!stat.isFile()) {
    throw new Error('Log path is not a file.');
  }

  const size = stat.size;
  const bytesToRead = Math.max(1, Math.min(Math.floor(maxBytes), size));
  const start = Math.max(0, size - bytesToRead);

  const fd = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(size === 0 ? 0 : bytesToRead);
    if (buffer.length > 0) {
      fs.readSync(fd, buffer, 0, buffer.length, start);
    }

    let content = buffer.toString('utf8');
    const truncated = start > 0;

    // Drop the partial first line when reading from the middle of a file.
    if (truncated) {
      const firstLineBreak = content.indexOf('\n');
      if (firstLineBreak >= 0) {
        content = content.slice(firstLineBreak + 1);
      }
    }

    return { content, truncated };
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Send a line of text to a running server's stdin (console input).
 * Used to submit admin commands such as /server_message_broadcast.
 */
export function sendServerStdin(installationId: string, line: string): { success: boolean; error?: string } {
  const running = runningProcesses.get(installationId);
  if (!running) {
    return { success: false, error: 'Server is not running.' };
  }
  if (!running.isServer) {
    return { success: false, error: 'Target process is not a server.' };
  }
  if (!running.process.stdin) {
    return { success: false, error: 'Server stdin pipe is not available.' };
  }
  try {
    running.process.stdin.write(`${line}\n`);
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export interface ChatFileInfo {
  fileName: string;
  channelId: string;
  channelLabel: string;
  channelType: 'general' | 'faction' | 'direct' | 'custom';
  sizeBytes: number;
  modifiedMs: number;
}

/**
 * List chat log files from an installation's chatlogs directory.
 */
export function listChatFiles(installationPath: string): ChatFileInfo[] {
  const chatDir = path.join(installationPath, 'chatlogs');
  if (!fs.existsSync(chatDir)) return [];

  const result: ChatFileInfo[] = [];

  try {
    for (const entry of fs.readdirSync(chatDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith('.txt')) continue;

      const filePath = path.join(chatDir, entry.name);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(filePath);
      } catch {
        continue;
      }

      const channelId = entry.name.replace(/\.txt$/i, '');
      let channelLabel: string;
      let channelType: ChatFileInfo['channelType'];

      if (channelId === 'all') {
        channelLabel = 'General';
        channelType = 'general';
      } else if (/^Faction\d+$/i.test(channelId)) {
        const fid = channelId.replace(/^Faction/i, '');
        channelLabel = `Faction ${fid}`;
        channelType = 'faction';
      } else if (channelId.startsWith('##')) {
        // DirectChatChannel names: ##<player1><player2> (combined, sorted by hashCode)
        // We show the raw combined name; actual player names are in the file content
        channelLabel = `DM: ${channelId.slice(2)}`;
        channelType = 'direct';
      } else {
        channelLabel = channelId;
        channelType = 'custom';
      }

      result.push({
        fileName: entry.name,
        channelId,
        channelLabel,
        channelType,
        sizeBytes: stat.size,
        modifiedMs: stat.mtimeMs,
      });
    }
  } catch (error) {
    console.error('[Launcher] Failed to list chat files:', error);
  }

  // Sort: general first, then faction, then direct, then custom; alphabetically within type
  const typeOrder: Record<ChatFileInfo['channelType'], number> = { general: 0, faction: 1, custom: 2, direct: 3 };
  result.sort((a, b) => {
    const typeDiff = typeOrder[a.channelType] - typeOrder[b.channelType];
    if (typeDiff !== 0) return typeDiff;
    return a.channelLabel.localeCompare(b.channelLabel);
  });

  return result;
}

/**
 * Read the tail of a chat log file from the chatlogs directory.
 */
export function readChatFile(
  installationPath: string,
  fileName: string,
  maxBytes = 512 * 1024,
): { content: string; truncated: boolean } {
  const chatDir = path.resolve(path.join(installationPath, 'chatlogs'));
  const filePath = path.resolve(path.join(chatDir, fileName));

  // Path traversal guard
  if (!filePath.startsWith(`${chatDir}${path.sep}`) && filePath !== chatDir) {
    throw new Error('Invalid chat file path.');
  }

  const stat = fs.statSync(filePath);
  if (!stat.isFile()) throw new Error('Chat path is not a file.');

  const size = stat.size;
  const bytesToRead = Math.max(1, Math.min(Math.floor(maxBytes), size));
  const start = Math.max(0, size - bytesToRead);

  const fd = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(size === 0 ? 0 : bytesToRead);
    if (buffer.length > 0) {
      fs.readSync(fd, buffer, 0, buffer.length, start);
    }
    let content = buffer.toString('utf8');
    const truncated = start > 0;
    if (truncated) {
      const firstBreak = content.indexOf('\n');
      if (firstBreak >= 0) content = content.slice(firstBreak + 1);
    }
    return { content, truncated };
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Stop all running processes (called on app quit).
 *
 * All console output here is wrapped in try-catch because stdout/stderr may
 * already be closed when this is invoked from the 'before-quit' handler
 * (e.g. after app.quit() is called by the self-updater), and a failed write
 * would otherwise surface as an EPIPE uncaught exception / error dialog.
 */
export function stopAllGames(): void {
  try { console.log(`[Launcher] Stopping all running processes (${runningProcesses.size})`); } catch { /* ignore EPIPE */ }
  
  for (const [id, running] of runningProcesses.entries()) {
    try {
      settlePlayTimeForRunningProcess(running);
      running.process.kill('SIGTERM');
      running.logStream.end();
      running.logFileWatcher?.close();
      try { console.log(`[Launcher] Stopped ${id}`); } catch { /* ignore EPIPE */ }
    } catch (error) {
      try { console.error(`[Launcher] Failed to stop ${id}:`, error); } catch { /* ignore EPIPE */ }
    }
  }
  
  runningProcesses.clear();
}

