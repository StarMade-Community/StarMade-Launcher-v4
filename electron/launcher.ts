/**
 * Game and server process launching (Phase 5).
 *
 * Handles spawning StarMade as a child process with proper Java arguments,
 * memory settings, and working directory.
 */

import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import { shell } from 'electron';
import { getRequiredJavaVersion, getJvmArgsForJava, resolveJavaPath } from './java.js';
import { BrowserWindow } from 'electron';

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
}

const runningProcesses = new Map<string, RunningProcess>();

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

    // Resolve Java executable
    let javaPath: string | null = customJavaPath || null;
    
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
    // log in again through the in-game menu (mirrors v2 launcher behaviour).
    // Each flag and its value are separate spawn arguments so the OS/JVM
    // receives them correctly (a single combined string would be treated as
    // one opaque argument by the process).
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
      ? args.map((a) => (a === authToken ? '[REDACTED]' : a))
      : args;

    console.log(`[Launcher] Launching: ${javaPath} ${safeArgs.join(' ')}`);
    console.log(`[Launcher] Working directory: ${installationPath}`);

    sendLogEvent(installationId, 'INFO', `Command: ${safeArgs.join(' ')}`);

    // Spawn the process
    const child = spawn(javaPath, args, {
      cwd: installationPath,
      stdio: ['ignore', 'pipe', 'pipe'],
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
        running.logStream.end();
        running.logFileWatcher?.close();
      }
      runningProcesses.delete(installationId);
    });

    // Handle process errors
    child.on('error', (err) => {
      console.error(`[Launcher] Process ${installationId} error:`, err);
      const msg = `Process error: ${err.message}`;
      logStream.write(`[ERROR] ${msg}\n`);
      sendLogEvent(installationId, 'ERROR', msg);
      
      const running = runningProcesses.get(installationId);
      if (running) {
        running.logStream.end();
        running.logFileWatcher?.close();
      }
      runningProcesses.delete(installationId);
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
    running.process.kill('SIGTERM');
    runningProcesses.delete(installationId);
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

/**
 * Stop all running processes (called on app quit).
 */
export function stopAllGames(): void {
  console.log(`[Launcher] Stopping all running processes (${runningProcesses.size})`);
  
  for (const [id, running] of runningProcesses.entries()) {
    try {
      running.process.kill('SIGTERM');
      running.logStream.end();
      running.logFileWatcher?.close();
      console.log(`[Launcher] Stopped ${id}`);
    } catch (error) {
      console.error(`[Launcher] Failed to stop ${id}:`, error);
    }
  }
  
  runningProcesses.clear();
}

