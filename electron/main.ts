import {
  app,
  BrowserWindow,
  screen,
  ipcMain,
  Menu,
  shell,
  dialog,
  clipboard,
  nativeImage,
} from 'electron';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import fs from 'fs';
import os from 'os';
import net from 'net';
import { Worker } from 'worker_threads';
import { config as loadDotEnv } from 'dotenv';
import { IPC } from './ipc-channels.js';
import { storeGet, storeSet, storeDelete, storeClearAll } from './store.js';
import { fetchAllVersions, invalidateVersionCache } from './versions.js';
import { startDownload, cancelDownload } from './downloader.js';
import type { DownloadProgress } from './downloader.js';
import { downloadJava, detectSystemJava, resolveJavaPath, getDefaultJavaPaths, findJavaExecutableInDir } from './java.js';
import { launchGame, stopGame, getGameStatus, getAllRunningGames, hasRunningGames, stopAllGames, getLogPath, openLogLocation, clearServerLogFiles, getGraphicsInfo, listServerLogFiles, readServerLogFile, sendServerStdin, listChatFiles, readChatFile, getPlayTimeTotals } from './launcher.js';
import type { UpdateInfo } from './updater.js';
import { checkForUpdates, downloadUpdate, installUpdate, openReleasesPage } from './updater.js';
import { createBackup, listBackups, restoreBackup } from './backup.js';
import {
  loginWithPassword,
  refreshAccessToken,
  registerAccount,
  logoutAccount,
  getAuthStatus,
  getAccessTokenForLaunch,
} from './auth.js';
import { isRunningOnWayland } from './wayland-detect.js';
import { isRunningAsAppImage } from './appimage-detect.js';
import { registerAppImageDesktopIntegration } from './desktop-integration.js';
import { parseVersionTxt } from './legacy.js';
import { getManagedPathCandidates } from './install-paths.js';
import { registerStarmoteIpcHandlers } from './starmote-ipc.js';
import { isStarmoteRolloutEnabled } from './starmote-feature-flag.js';
import {
  listModsForInstallation,
  listSmdMods,
  installOrUpdateSmdModForInstallation,
  checkSmdUpdatesForInstalled,
  removeModForInstallation,
  setModEnabledForInstallation,
  createModpackManifest,
  importModpackFromFile,
  writeModpackManifest,
} from './mods.js';

// ─── ES Module compatibility ─────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadLocalEnvIfPresent(): void {
  const fileNames = ['.env.local', '.env'];
  const roots = [
    process.cwd(),
    app.getAppPath(),
    path.dirname(process.execPath),
  ];

  const tried = new Set<string>();
  for (const root of roots) {
    for (const fileName of fileNames) {
      const candidate = path.resolve(root, fileName);
      if (tried.has(candidate)) continue;
      tried.add(candidate);

      if (!fs.existsSync(candidate)) continue;
      loadDotEnv({ path: candidate, override: false });
      return;
    }
  }
}

loadLocalEnvIfPresent();

// ─── Constants ──────────────────────────────────────────────────────────────

const isDev = !app.isPackaged;
const RENDERER_URL = 'http://localhost:3000';
const PRELOAD_PATH = path.join(__dirname, 'preload.js');

// ─── EPIPE guard ─────────────────────────────────────────────────────────────
// When the launcher is packaged as an AppImage (or any scenario where stdout /
// stderr is not connected to a terminal), Node.js throws an EPIPE error when
// console.log / console.error tries to write to a closed pipe (e.g. during
// app.quit() from the installer flow).  That propagates as an uncaught
// exception and shows the "A JavaScript error occurred in the main process"
// dialog.
//
// Two layers of defence:
//  1. Stream-level: ignore EPIPE errors on stdout/stderr directly.
//  2. Process-level: catch any EPIPE that escapes the stream handlers
//     (e.g. during Electron's quit sequence when streams are torn down
//     before the event-loop drains the error events).
process.stdout.on('error', (err: NodeJS.ErrnoException) => { if (err.code !== 'EPIPE') throw err; });
process.stderr.on('error', (err: NodeJS.ErrnoException) => { if (err.code !== 'EPIPE') throw err; });
process.on('uncaughtException', (err: NodeJS.ErrnoException) => {
  // Silently swallow broken-pipe errors that bubble up during quit/update.
  if (err.code === 'EPIPE') return;
  // For every other uncaught exception let Electron show its error dialog
  // by re-throwing (Electron's default uncaughtException handler then picks
  // it up — don't call dialog.showErrorBox here to avoid double-dialogs).
  throw err;
});

// ─── Linux sandbox fix ───────────────────────────────────────────────────────
// Chromium's SUID sandbox check runs at the C++ browser-process level, before
// V8 starts and before *any* JavaScript executes.  That means calling
// app.commandLine.appendSwitch('no-sandbox') here is fundamentally too late to
// prevent the crash when chrome-sandbox is present but not SUID-root.
//
// AppImage case (primary fix lives in afterPack.cjs)
// ---------------------------------------------------
// The squashfs image is mounted read-only by an unprivileged user, so the
// chrome-sandbox binary inside the mount can never have the required SUID-root
// permissions (mode 4755).  The afterPack.cjs build hook handles this by
// replacing the Electron binary with a thin shell wrapper that prepends
// --no-sandbox *before* exec-ing the real binary, so the flag is on the
// original argv when Chromium initialises.
//
// Root-user case (handled here as a best-effort fallback)
// --------------------------------------------------------
// If the app is launched with `sudo -E ./StarMade-Launcher.AppImage` the
// afterPack wrapper already adds --no-sandbox.  The check below is kept as a
// defence-in-depth measure for any direct (non-AppImage) root invocation.
if (process.platform === 'linux') {
  const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  if (isRoot) {
    app.commandLine.appendSwitch('no-sandbox');
  }
}

// ─── Linux Wayland fix ───────────────────────────────────────────────────────
// On Wayland-only systems (e.g. KDE Plasma on Kubuntu without XWayland),
// Electron's default X11 backend cannot connect to a display and aborts at
// startup.  We detect a Wayland session via the WAYLAND_DISPLAY /
// XDG_SESSION_TYPE env vars and switch Electron to the Ozone/Wayland backend.
// See electron/wayland-detect.ts for full detection details.
if (process.platform === 'linux' && isRunningOnWayland(process.env)) {
  app.commandLine.appendSwitch('ozone-platform', 'wayland');
}

/**
 * Returns a user-writable directory for launcher data (downloaded JREs, etc.).
 *
 * When packaged we use app.getPath('userData') instead of the directory next
 * to the executable.  On Linux the executable lives inside a read-only
 * AppImage squashfs mount, so any write attempt there produces EROFS.
 * userData (e.g. ~/.config/<appName>) is always writable.
 */
function getLauncherDir(): string {
  return app.isPackaged ? app.getPath('userData') : app.getAppPath();
}

// ─── Window ──────────────────────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null;
const serverPanelWindows = new Set<BrowserWindow>();
const SERVER_PANEL_POPOUT_BOUNDS_KEY = 'serverPanelPopoutBoundsV1';

const getWindowIconPath = (): string => (
  app.isPackaged
    ? path.join(process.resourcesPath, 'icon.png')
    : path.join(__dirname, '../build/icon.png')
);

function loadRendererRoute(
  window: BrowserWindow,
  query?: { page?: string; serverId?: string; serverName?: string; panelMode?: string },
): Promise<void> {
  const queryEntries = Object.entries(query ?? {}).filter((entry): entry is [string, string] => (
    typeof entry[1] === 'string' && entry[1].trim().length > 0
  ));
  const queryObject = Object.fromEntries(queryEntries);

  if (isDev) {
    const params = new URLSearchParams(queryObject).toString();
    const targetUrl = params.length > 0 ? `${RENDERER_URL}?${params}` : RENDERER_URL;
    return window.loadURL(targetUrl);
  }

  return window.loadFile(path.join(__dirname, '../dist/index.html'), { query: queryObject });
}

function createWindow(): void {
  const { height: workAreaHeight } = screen.getPrimaryDisplay().workAreaSize;
  const useShortScreenSizing = workAreaHeight < 720;
  const initialHeight = useShortScreenSizing ? workAreaHeight : 900;
  const minHeight = useShortScreenSizing ? Math.min(600, workAreaHeight) : 600;

  // Resolve the icon path: in packaged builds the icon is copied to
  // resources/icon.png via extraResources so it lives outside the asar and
  // can be used as a real file path.  In dev we reference it directly from
  // the build/ folder.
  const iconPath = getWindowIconPath();

  mainWindow = new BrowserWindow({
    width: 1280,
    height: initialHeight,
    minWidth: 960,
    minHeight,
    resizable: true,
    thickFrame: true,
    frame: false,
    roundedCorners: true,
    titleBarStyle: 'hidden',
    transparent: true,
    backgroundColor: '#0D0D1B',
    icon: iconPath,
    show: false,
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Load the app
  void loadRendererRoute(mainWindow);
  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  // Show the window once it is ready to prevent a white flash
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // Notify the renderer whenever the maximized state changes
  mainWindow.on('maximize', () => {
    mainWindow?.webContents.send(IPC.WINDOW_MAXIMIZED_CHANGED, true);
  });
  mainWindow.on('unmaximize', () => {
    mainWindow?.webContents.send(IPC.WINDOW_MAXIMIZED_CHANGED, false);
  });

  // Open external links in the default browser instead of a new Electron window
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:') || url.startsWith('http:')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createServerPanelWindow(serverId?: string, serverName?: string): BrowserWindow {
  const storedBoundsRaw = storeGet(SERVER_PANEL_POPOUT_BOUNDS_KEY);
  const storedBounds = (
    storedBoundsRaw
    && typeof storedBoundsRaw === 'object'
    && !Array.isArray(storedBoundsRaw)
    && typeof (storedBoundsRaw as { width?: unknown }).width === 'number'
    && typeof (storedBoundsRaw as { height?: unknown }).height === 'number'
    && typeof (storedBoundsRaw as { x?: unknown }).x === 'number'
    && typeof (storedBoundsRaw as { y?: unknown }).y === 'number'
  )
    ? storedBoundsRaw as { width: number; height: number; x: number; y: number }
    : null;

  const iconPath = getWindowIconPath();
  const serverPanelWindow = new BrowserWindow({
    width: storedBounds?.width ?? 1440,
    height: storedBounds?.height ?? 980,
    x: storedBounds?.x,
    y: storedBounds?.y,
    minWidth: 1100,
    minHeight: 720,
    resizable: true,
    thickFrame: true,
    frame: false,
    roundedCorners: true,
    titleBarStyle: 'hidden',
    transparent: true,
    backgroundColor: '#0D0D1B',
    icon: iconPath,
    show: false,
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  serverPanelWindows.add(serverPanelWindow);
  void loadRendererRoute(serverPanelWindow, { page: 'ServerPanel', serverId, serverName, panelMode: 'popout' });

  serverPanelWindow.once('ready-to-show', () => {
    serverPanelWindow.show();
  });

  serverPanelWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:') || url.startsWith('http:')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  const persistPopoutBounds = () => {
    if (serverPanelWindow.isDestroyed() || serverPanelWindow.isMaximized() || serverPanelWindow.isMinimized()) return;
    const bounds = serverPanelWindow.getBounds();
    storeSet(SERVER_PANEL_POPOUT_BOUNDS_KEY, {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
    });
  };

  serverPanelWindow.on('resize', persistPopoutBounds);
  serverPanelWindow.on('move', persistPopoutBounds);

  serverPanelWindow.on('closed', () => {
    serverPanelWindows.delete(serverPanelWindow);
  });

  return serverPanelWindow;
}

// ─── IPC handlers ────────────────────────────────────────────────────────────

ipcMain.on(IPC.WINDOW_MINIMIZE, (event) => {
  const targetWindow = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
  targetWindow?.minimize();
});

ipcMain.on(IPC.WINDOW_HIDE, (event) => {
  const targetWindow = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
  targetWindow?.hide();
});

ipcMain.on(IPC.WINDOW_MAXIMIZE, (event) => {
  const targetWindow = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
  if (!targetWindow) return;
  if (targetWindow.isMaximized()) {
    targetWindow.unmaximize();
  } else {
    targetWindow.maximize();
  }
});

ipcMain.on(IPC.WINDOW_CLOSE, (event) => {
  const targetWindow = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
  targetWindow?.close();
});

ipcMain.handle(IPC.WINDOW_OPEN_SERVER_PANEL, async (_event, payload?: { serverId?: string; serverName?: string }) => {
  try {
    createServerPanelWindow(payload?.serverId, payload?.serverName);
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

// ─── StarMote IPC handlers ───────────────────────────────────────────────────

const starmoteAdminCommandPassword = process.env.STARMOTE_SUPER_ADMIN_PASSWORD
  ?? process.env.STARMOTE_SERVER_PASSWORD
  ?? '';

if (isStarmoteRolloutEnabled()) {
  registerStarmoteIpcHandlers({
    ipcMain,
    getAllWindows: () => BrowserWindow.getAllWindows(),
    createSocket: () => new net.Socket(),
    adminCommandPassword: starmoteAdminCommandPassword,
    // Always force-refresh the OAuth token before sending it to the game server.
    // This prevents stale/expired tokens from causing code -10 registry rejections.
    resolveAuthTokenForAccount: (accountId) => getAccessTokenForLaunch(accountId, { forceRefresh: true }),
  });
} else {
  console.info('[starmote] rollout disabled via STARMOTE_ENABLED=0');
}

// ─── Store IPC handlers ───────────────────────────────────────────────────────

ipcMain.handle(IPC.STORE_GET, (_event, key: string) => storeGet(key));
ipcMain.handle(IPC.STORE_SET, (_event, key: string, value: unknown) => { storeSet(key, value); });
ipcMain.handle(IPC.STORE_DELETE, (_event, key: string) => { storeDelete(key); });
ipcMain.handle(IPC.STORE_CLEAR_ALL, () => {
  try {
    storeClearAll();
    // Relaunch so all in-memory module state (accounts, installations, etc.)
    // is fully reset from the now-empty store.
    app.relaunch();
    app.quit();
    return { success: true };
  } catch (err) {
    console.error('[store] clear-all failed:', err);
    return { success: false, error: String(err) };
  }
});

// ─── Version manifest IPC handlers ───────────────────────────────────────────

ipcMain.handle(IPC.VERSIONS_FETCH, async (_event, { invalidate = false } = {}) => {
  if (invalidate) invalidateVersionCache();
  return fetchAllVersions();
});

// ─── Download IPC handlers ────────────────────────────────────────────────────

ipcMain.handle(
  IPC.DOWNLOAD_START,
  (event, installationId: string, buildPath: string, targetDir: string) => {
    const { sender } = event;

    const send = <T>(channel: string, payload: T) => {
      if (!sender.isDestroyed()) sender.send(channel, payload);
    };

    // Fire-and-forget: progress/complete/error arrive via separate push events.
    startDownload(
      installationId,
      buildPath,
      targetDir,
      (progress: DownloadProgress) => send(IPC.DOWNLOAD_PROGRESS, progress),
      ()                           => send(IPC.DOWNLOAD_COMPLETE,  { installationId }),
      (error: string)              => send(IPC.DOWNLOAD_ERROR,     { installationId, error }),
    ).catch((err: unknown) => {
      send(IPC.DOWNLOAD_ERROR, { installationId, error: String(err) });
    });

    return { started: true };
  },
);

ipcMain.handle(IPC.DOWNLOAD_CANCEL, (_event, installationId: string) => {
  cancelDownload(installationId);
});

// ─── Java IPC handlers ────────────────────────────────────────────────────────

ipcMain.handle(IPC.JAVA_LIST, async () => {
  const bundled: Array<{ version: string; path: string; source: string }> = [];
  const launcherDir = getLauncherDir();

  // Adoptium/Temurin archives nest the JRE under a versioned subdirectory
  // (e.g. jre8/jdk8u362-b09-jre/bin/java), so we search recursively.
  const jre8Dir = path.join(launcherDir, 'jre8');
  if (fs.existsSync(jre8Dir)) {
    const jre8Path = findJavaExecutableInDir(jre8Dir);
    if (jre8Path) {
      bundled.push({ version: '8', path: jre8Path, source: 'bundled' });
    }
  }

  const jre25Dir = path.join(launcherDir, 'jre25');
  if (fs.existsSync(jre25Dir)) {
    const jre25Path = findJavaExecutableInDir(jre25Dir);
    if (jre25Path) {
      bundled.push({ version: '25', path: jre25Path, source: 'bundled' });
    }
  }
  
  // Detect system Java
  const system = await detectSystemJava();
  
  return { bundled, system: system.map(j => ({ ...j, source: 'system' })) };
});

ipcMain.handle(IPC.JAVA_DOWNLOAD, async (_event, version: 8 | 25) => {
  try {
    const launcherDir = getLauncherDir();
    const javaPath = await downloadJava(version, launcherDir);
    return { success: true, path: javaPath };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle(IPC.JAVA_DETECT, async () => {
  const system = await detectSystemJava();
  return system.map(j => ({ ...j, source: 'system' }));
});

ipcMain.handle(IPC.JAVA_GET_DEFAULT_PATHS, () => {
  const launcherDir = getLauncherDir();
  return getDefaultJavaPaths(launcherDir);
});

ipcMain.handle(IPC.JAVA_FIND_EXECUTABLE, (_event, folderPath: string): string => {
  const isWin = process.platform === 'win32';
  const candidates = isWin
    ? [path.join(folderPath, 'bin', 'java.exe'), path.join(folderPath, 'java.exe')]
    : [path.join(folderPath, 'bin', 'java'),     path.join(folderPath, 'java')];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  // Best-guess path even if not found yet (user may install later)
  return isWin
    ? path.join(folderPath, 'bin', 'java.exe')
    : path.join(folderPath, 'bin', 'java');
});

// ─── Game launch IPC handlers ─────────────────────────────────────────────────

ipcMain.handle(IPC.GAME_LAUNCH, async (_event, options: {
  installationId: string;
  installationPath: string;
  starMadeVersion: string;
  minMemory?: number;
  maxMemory?: number;
  jvmArgs?: string;
  customJavaPath?: string;
  isServer?: boolean;
  serverPort?: number;
  /** The active account id — used to retrieve the stored auth token. */
  activeAccountId?: string;
  /** Server address for `-uplink` (direct connect to a world/server). */
  uplink?: string;
  /** Port for the `-uplink` server. */
  uplinkPort?: number;
  /** Mod IDs to pass after the `-uplink` port. */
  modIds?: string[];
}) => {
  const launcherDir = getLauncherDir();

  // Resolve the auth token for the active account (returns null for guests/offline)
  let authToken: string | null = null;
  if (options.activeAccountId) {
    try {
      authToken = await getAccessTokenForLaunch(options.activeAccountId);
      if (!authToken && !options.activeAccountId.startsWith('offline-') && !options.activeAccountId.startsWith('guest-')) {
        // Token retrieval failed for a registry account.  getAccessTokenForLaunch
        // already logged the reason; surface it here too so it's visible in the
        // main-process log alongside the launch event.
        console.warn(`[main] No auth token for account ${options.activeAccountId} — launching without -auth flag.  The server may reject the connection if authentication is required.`);
      }
    } catch (err) {
      console.warn('[main] Failed to retrieve auth token for launch:', err);
    }
  }

  return launchGame({ ...options, launcherDir, authToken: authToken ?? undefined });
});

ipcMain.handle(IPC.GAME_STOP, (_event, installationId: string) => {
  return { success: stopGame(installationId) };
});

ipcMain.handle(IPC.GAME_STATUS, (_event, installationId: string) => {
  return getGameStatus(installationId);
});

ipcMain.handle(IPC.GAME_LIST_RUNNING, () => {
  return getAllRunningGames();
});

ipcMain.handle(IPC.GAME_GET_PLAY_TIME_TOTALS, (_event, installationIds?: string[]) => {
  return getPlayTimeTotals(Array.isArray(installationIds) ? installationIds : undefined);
});

ipcMain.handle(IPC.GAME_GET_LOG_PATH, (_event, installationId: string) => {
  return getLogPath(installationId);
});

ipcMain.handle(IPC.GAME_LIST_LOG_FILES, (_event, installationPath: string) => {
  if (!installationPath) {
    return { categories: [], defaultRelativePath: null };
  }

  try {
    return listServerLogFiles(installationPath);
  } catch (error) {
    console.warn('[logs] Failed to list log files:', { installationPath, error });
    return { categories: [], defaultRelativePath: null };
  }
});

ipcMain.handle(IPC.GAME_READ_LOG_FILE, (_event, installationPath: string, relativePath: string, maxBytes?: number) => {
  if (!installationPath || !relativePath) {
    return { content: '', truncated: false, error: 'Missing installation path or log file path.' };
  }

  try {
    const payload = readServerLogFile(installationPath, relativePath, maxBytes);
    return { ...payload, error: undefined as string | undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[logs] Failed to read log file:', { installationPath, relativePath, error: message });
    return { content: '', truncated: false, error: message };
  }
});

ipcMain.handle(IPC.GAME_OPEN_LOG_LOCATION, (_event, installationPath: string) => {
  openLogLocation(installationPath);
  return { success: true };
});

ipcMain.handle(IPC.GAME_CLEAR_LOG_FILES, (_event, installationPath: string) => {
  if (!installationPath) {
    return { success: false, deletedCount: 0, error: 'Missing installation path.' };
  }

  const result = clearServerLogFiles(installationPath);
  if (!result.success) {
    console.warn('[logs] Failed to clear logs folder:', { installationPath, error: result.error });
  }
  return result;
});

ipcMain.handle(IPC.GAME_GET_GRAPHICS_INFO, (_event, installationPath: string) => {
  return getGraphicsInfo(installationPath);
});

// ─── Server chat IPC handlers ─────────────────────────────────────────────────

ipcMain.handle(IPC.GAME_SERVER_STDIN, (_event, installationId: string, line: string) => {
  if (!installationId || typeof line !== 'string') {
    return { success: false, error: 'Missing installationId or line.' };
  }
  return sendServerStdin(installationId, line);
});

ipcMain.handle(IPC.GAME_LIST_CHAT_FILES, (_event, installationPath: string) => {
  if (!installationPath) return [];
  try {
    return listChatFiles(installationPath);
  } catch (error) {
    console.warn('[chat] Failed to list chat files:', error);
    return [];
  }
});

ipcMain.handle(IPC.GAME_READ_CHAT_FILE, (_event, installationPath: string, fileName: string, maxBytes?: number) => {
  if (!installationPath || !fileName) {
    return { content: '', truncated: false, error: 'Missing installationPath or fileName.' };
  }
  try {
    return { ...readChatFile(installationPath, fileName, maxBytes), error: undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[chat] Failed to read chat file:', { installationPath, fileName, error: message });
    return { content: '', truncated: false, error: message };
  }
});

function readServerCfgKey(installationPath: string, key: string): string | null {
  const cfgPath = path.join(installationPath, 'server.cfg');
  if (!fs.existsSync(cfgPath)) return null;

  const content = fs.readFileSync(cfgPath, 'utf8');
  const lines = content.split(/\r?\n/);
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const lineRegex = new RegExp(`^\\s*${escapedKey}\\s*=\\s*(.*?)\\s*(?:\\/\\/.*)?$`);

  for (const line of lines) {
    const match = line.match(lineRegex);
    if (match) {
      return match[1].trim();
    }
  }

  return null;
}

function listServerCfgEntries(installationPath: string): Array<{ key: string; value: string; comment: string | null }> {
  const cfgPath = path.join(installationPath, 'server.cfg');
  if (!fs.existsSync(cfgPath)) return [];

  const content = fs.readFileSync(cfgPath, 'utf8');
  const lines = content.split(/\r?\n/);
  const entries: Array<{ key: string; value: string; comment: string | null }> = [];
  const seen = new Set<string>();

  for (const line of lines) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*(?:\/\/\s*(.*))?$/);
    if (!match) continue;

    const key = match[1].trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);

    entries.push({
      key,
      value: (match[2] ?? '').trim(),
      comment: match[3]?.trim() || null,
    });
  }

  return entries;
}

function writeServerCfgKey(installationPath: string, key: string, value: string): { success: boolean; error?: string } {
  const cfgPath = path.join(installationPath, 'server.cfg');
  if (!fs.existsSync(cfgPath)) {
    return { success: false, error: `server.cfg not found at ${cfgPath}` };
  }

  const content = fs.readFileSync(cfgPath, 'utf8');
  const lines = content.split(/\r?\n/);
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const lineRegex = new RegExp(`^(\\s*${escapedKey}\\s*=\\s*)(.*?)(\\s*(?:\\/\\/.*)?)$`);

  let updated = false;
  const nextLines = lines.map((line) => {
    if (updated) return line;
    const match = line.match(lineRegex);
    if (!match) return line;

    updated = true;
    const prefix = match[1] ?? `${key} = `;
    const suffix = match[3] ?? '';
    return `${prefix}${value}${suffix}`;
  });

  if (!updated) {
    nextLines.push(`${key} = ${value}`);
  }

  fs.writeFileSync(cfgPath, nextLines.join('\n'), 'utf8');
  return { success: true };
}

function resolveExistingConfigPath(installationPath: string, relativeCandidates: string[]): string | null {
  for (const relativePath of relativeCandidates) {
    const candidate = path.join(installationPath, relativePath);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function readGameConfigXml(installationPath: string): string | null {
  const configPath = resolveExistingConfigPath(installationPath, ['GameConfig.xml', 'StarMade/GameConfig.xml']);
  if (!configPath) return null;
  return fs.readFileSync(configPath, 'utf8');
}

function writeGameConfigXml(installationPath: string, xmlContent: string): { success: boolean; error?: string } {
  const configPath = resolveExistingConfigPath(installationPath, ['GameConfig.xml', 'StarMade/GameConfig.xml']);
  if (!configPath) {
    return {
      success: false,
      error: `GameConfig.xml not found at ${path.join(installationPath, 'GameConfig.xml')} or ${path.join(installationPath, 'StarMade', 'GameConfig.xml')}`,
    };
  }

  fs.writeFileSync(configPath, xmlContent, 'utf8');
  return { success: true };
}

function resolveInstallationTargetPath(installationPath: string, relativePath: string): string {
  const root = path.resolve(installationPath);
  const target = path.resolve(path.join(root, relativePath));
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error('Invalid file path.');
  }
  return target;
}

const KNOWN_BINARY_EXTENSIONS = new Set([
  '.7z', '.a', '.avi', '.bin', '.bmp', '.class', '.dat', '.db', '.dll', '.dylib', '.ear', '.exe', '.gif',
  '.gz', '.ico', '.iso', '.jar', '.jpeg', '.jpg', '.lib', '.lock', '.lz', '.mp3', '.mp4', '.o', '.ogg', '.otf',
  '.pdf', '.png', '.rar', '.so', '.sqlite', '.tar', '.ttf', '.war', '.wav', '.webm', '.webp', '.woff', '.woff2', '.zip',
]);

function isKnownBinaryFileByExtension(filePath: string): boolean {
  const extension = path.extname(filePath).toLowerCase();
  return extension.length > 0 && KNOWN_BINARY_EXTENSIONS.has(extension);
}

function isLikelyBinaryContent(content: Buffer): boolean {
  if (content.length === 0) return false;

  let suspiciousByteCount = 0;
  const sampleSize = Math.min(content.length, 8192);
  for (let index = 0; index < sampleSize; index += 1) {
    const value = content[index];
    if (value === 0) return true;
    if (value < 7 || (value > 14 && value < 32)) suspiciousByteCount += 1;
  }

  return (suspiciousByteCount / sampleSize) > 0.3;
}

function isEditableTextFile(targetPath: string): boolean {
  if (isKnownBinaryFileByExtension(targetPath)) return false;
  const content = fs.readFileSync(targetPath);
  return !isLikelyBinaryContent(content);
}

function getNonEditableFileReason(relativePath: string): string {
  return `Cannot open ${relativePath}: binary files are not supported in the editor.`;
}

function listInstallationEntries(
  installationPath: string,
  relativeDir = '',
): Array<{ name: string; relativePath: string; isDirectory: boolean; sizeBytes: number; modifiedMs: number; isEditableText: boolean; nonEditableReason?: string }> {
  const dirPath = resolveInstallationTargetPath(installationPath, relativeDir || '.');
  const stats = fs.statSync(dirPath);
  if (!stats.isDirectory()) {
    throw new Error('Target path is not a directory.');
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true }).map((entry) => {
    const absoluteEntryPath = path.join(dirPath, entry.name);
    const entryStat = fs.statSync(absoluteEntryPath);
    const relativePath = path.relative(path.resolve(installationPath), absoluteEntryPath).split(path.sep).join('/');

    return {
      name: entry.name,
      relativePath,
      isDirectory: entry.isDirectory(),
      sizeBytes: entry.isDirectory() ? 0 : entryStat.size,
      modifiedMs: entryStat.mtimeMs,
      isEditableText: entry.isDirectory() || !isKnownBinaryFileByExtension(entry.name),
      nonEditableReason: entry.isDirectory() || !isKnownBinaryFileByExtension(entry.name)
        ? undefined
        : getNonEditableFileReason(relativePath),
    };
  });

  entries.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return entries;
}

function readInstallationTextFile(installationPath: string, relativePath: string): string {
  const targetPath = resolveInstallationTargetPath(installationPath, relativePath);
  const stats = fs.statSync(targetPath);
  if (!stats.isFile()) {
    throw new Error('Target path is not a file.');
  }

  if (!isEditableTextFile(targetPath)) {
    throw new Error(getNonEditableFileReason(relativePath));
  }

  return fs.readFileSync(targetPath, 'utf8');
}

function writeInstallationTextFile(installationPath: string, relativePath: string, content: string): { success: boolean; error?: string } {
  const targetPath = resolveInstallationTargetPath(installationPath, relativePath);
  const stats = fs.statSync(targetPath);
  if (!stats.isFile()) {
    return { success: false, error: 'Target path is not a file.' };
  }

  if (!isEditableTextFile(targetPath)) {
    return { success: false, error: getNonEditableFileReason(relativePath) };
  }

  fs.writeFileSync(targetPath, content, 'utf8');
  return { success: true };
}

function normalizeRelativePath(installationPath: string, absolutePath: string): string {
  return path.relative(path.resolve(installationPath), absolutePath).split(path.sep).join('/');
}

function assertValidLeafName(nextName: string): string {
  const trimmed = nextName.trim();
  if (!trimmed) {
    throw new Error('Name cannot be empty.');
  }
  if (trimmed === '.' || trimmed === '..') {
    throw new Error('Invalid file or directory name.');
  }
  if (trimmed.includes('/') || trimmed.includes('\\')) {
    throw new Error('Name cannot include path separators.');
  }
  return trimmed;
}

function toUniqueDestinationPath(initialPath: string): string {
  if (!fs.existsSync(initialPath)) return initialPath;

  const dirPath = path.dirname(initialPath);
  const ext = path.extname(initialPath);
  const stem = path.basename(initialPath, ext);

  let index = 1;
  while (true) {
    const candidate = path.join(dirPath, `${stem} (${index})${ext}`);
    if (!fs.existsSync(candidate)) {
      return candidate;
    }
    index += 1;
  }
}

function copyPathRecursive(sourcePath: string, destinationPath: string): void {
  const sourceStats = fs.statSync(sourcePath);
  if (sourceStats.isDirectory()) {
    fs.cpSync(sourcePath, destinationPath, { recursive: true, errorOnExist: true, force: false });
    return;
  }

  fs.copyFileSync(sourcePath, destinationPath, fs.constants.COPYFILE_EXCL);
}

function renameInstallationEntry(
  installationPath: string,
  relativePath: string,
  nextName: string,
): { success: boolean; oldRelativePath: string; newRelativePath: string } {
  const trimmedRelativePath = relativePath.trim();
  if (!trimmedRelativePath) {
    throw new Error('relativePath is required.');
  }

  const absoluteSourcePath = resolveInstallationTargetPath(installationPath, trimmedRelativePath);
  if (!fs.existsSync(absoluteSourcePath)) {
    throw new Error(`Path not found: ${trimmedRelativePath}`);
  }

  const validName = assertValidLeafName(nextName);
  const parentPath = path.dirname(absoluteSourcePath);
  const absoluteDestinationPath = path.join(parentPath, validName);
  const destinationRelativePath = normalizeRelativePath(installationPath, absoluteDestinationPath);
  const safeDestinationPath = resolveInstallationTargetPath(installationPath, destinationRelativePath);

  if (safeDestinationPath === absoluteSourcePath) {
    return { success: true, oldRelativePath: trimmedRelativePath, newRelativePath: trimmedRelativePath };
  }

  if (fs.existsSync(safeDestinationPath)) {
    throw new Error(`A file or directory named "${validName}" already exists.`);
  }

  fs.renameSync(absoluteSourcePath, safeDestinationPath);
  return {
    success: true,
    oldRelativePath: normalizeRelativePath(installationPath, absoluteSourcePath),
    newRelativePath: destinationRelativePath,
  };
}

function copyInstallationEntry(
  installationPath: string,
  sourceRelativePath: string,
  destinationDir: string,
): { success: boolean; sourceRelativePath: string; destinationRelativePath: string } {
  const sourcePath = resolveInstallationTargetPath(installationPath, sourceRelativePath);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Path not found: ${sourceRelativePath}`);
  }

  const destinationDirPath = resolveInstallationTargetPath(installationPath, destinationDir || '.');
  if (!fs.existsSync(destinationDirPath) || !fs.statSync(destinationDirPath).isDirectory()) {
    throw new Error('Destination path is not a directory.');
  }

  const sourceStats = fs.statSync(sourcePath);
  if (sourceStats.isDirectory() && (destinationDirPath === sourcePath || destinationDirPath.startsWith(`${sourcePath}${path.sep}`))) {
    throw new Error('Cannot copy a directory into itself.');
  }

  let absoluteDestinationPath = path.join(destinationDirPath, path.basename(sourcePath));
  if (absoluteDestinationPath === sourcePath || fs.existsSync(absoluteDestinationPath)) {
    absoluteDestinationPath = toUniqueDestinationPath(absoluteDestinationPath);
  }

  copyPathRecursive(sourcePath, absoluteDestinationPath);

  return {
    success: true,
    sourceRelativePath: normalizeRelativePath(installationPath, sourcePath),
    destinationRelativePath: normalizeRelativePath(installationPath, absoluteDestinationPath),
  };
}

function moveInstallationEntry(
  installationPath: string,
  sourceRelativePath: string,
  destinationDir: string,
): { success: boolean; sourceRelativePath: string; destinationRelativePath: string } {
  const sourcePath = resolveInstallationTargetPath(installationPath, sourceRelativePath);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Path not found: ${sourceRelativePath}`);
  }

  const destinationDirPath = resolveInstallationTargetPath(installationPath, destinationDir || '.');
  if (!fs.existsSync(destinationDirPath) || !fs.statSync(destinationDirPath).isDirectory()) {
    throw new Error('Destination path is not a directory.');
  }

  const sourceStats = fs.statSync(sourcePath);
  if (sourceStats.isDirectory() && (destinationDirPath === sourcePath || destinationDirPath.startsWith(`${sourcePath}${path.sep}`))) {
    throw new Error('Cannot move a directory into itself.');
  }

  let absoluteDestinationPath = path.join(destinationDirPath, path.basename(sourcePath));
  if (absoluteDestinationPath === sourcePath) {
    return {
      success: true,
      sourceRelativePath: normalizeRelativePath(installationPath, sourcePath),
      destinationRelativePath: normalizeRelativePath(installationPath, sourcePath),
    };
  }
  if (fs.existsSync(absoluteDestinationPath)) {
    absoluteDestinationPath = toUniqueDestinationPath(absoluteDestinationPath);
  }

  try {
    fs.renameSync(sourcePath, absoluteDestinationPath);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code !== 'EXDEV') throw error;

    copyPathRecursive(sourcePath, absoluteDestinationPath);
    fs.rmSync(sourcePath, { recursive: true, force: false });
  }

  return {
    success: true,
    sourceRelativePath: normalizeRelativePath(installationPath, sourcePath),
    destinationRelativePath: normalizeRelativePath(installationPath, absoluteDestinationPath),
  };
}

function deleteInstallationEntry(
  installationPath: string,
  relativePath: string,
): { success: boolean; deletedRelativePath: string } {
  const trimmedRelativePath = relativePath.trim();
  if (!trimmedRelativePath) {
    throw new Error('relativePath is required.');
  }

  const targetPath = resolveInstallationTargetPath(installationPath, trimmedRelativePath);
  if (!fs.existsSync(targetPath)) {
    throw new Error(`Path not found: ${trimmedRelativePath}`);
  }

  fs.rmSync(targetPath, { recursive: true, force: false });
  return {
    success: true,
    deletedRelativePath: normalizeRelativePath(installationPath, targetPath),
  };
}

ipcMain.handle(IPC.GAME_SERVER_CFG_GET, (_event, installationPath: string, key: string) => {
  if (!installationPath || !key) return null;
  try {
    return readServerCfgKey(installationPath, key);
  } catch (error) {
    console.warn('[server-cfg] Failed to read key:', { installationPath, key, error });
    return null;
  }
});

ipcMain.handle(IPC.GAME_SERVER_CFG_LIST, (_event, installationPath: string) => {
  if (!installationPath) return [];
  try {
    return listServerCfgEntries(installationPath);
  } catch (error) {
    console.warn('[server-cfg] Failed to list keys:', { installationPath, error });
    return [];
  }
});

ipcMain.handle(IPC.GAME_SERVER_CFG_SET, (_event, installationPath: string, key: string, value: string) => {
  if (!installationPath || !key) {
    return { success: false, error: 'installationPath and key are required.' };
  }
  try {
    return writeServerCfgKey(installationPath, key, value);
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle(IPC.GAME_CONFIG_XML_GET, (_event, installationPath: string) => {
  if (!installationPath) return null;
  try {
    return readGameConfigXml(installationPath);
  } catch (error) {
    console.warn('[game-config] Failed to read GameConfig.xml:', { installationPath, error });
    return null;
  }
});

ipcMain.handle(IPC.GAME_CONFIG_XML_SET, (_event, installationPath: string, xmlContent: string) => {
  if (!installationPath) {
    return { success: false, error: 'installationPath is required.' };
  }
  if (typeof xmlContent !== 'string') {
    return { success: false, error: 'xmlContent must be a string.' };
  }

  try {
    return writeGameConfigXml(installationPath, xmlContent);
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle(IPC.GAME_FILES_LIST, (_event, installationPath: string, relativeDir?: string) => {
  if (!installationPath) return [];
  try {
    return listInstallationEntries(installationPath, relativeDir ?? '');
  } catch (error) {
    console.warn('[files] Failed to list entries:', { installationPath, relativeDir, error });
    return [];
  }
});

ipcMain.handle(IPC.GAME_FILE_READ, (_event, installationPath: string, relativePath: string) => {
  if (!installationPath || !relativePath) return { content: '', error: 'installationPath and relativePath are required.' };
  try {
    const content = readInstallationTextFile(installationPath, relativePath);
    return { content, error: undefined as string | undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { content: '', error: message };
  }
});

ipcMain.handle(IPC.GAME_FILE_WRITE, (_event, installationPath: string, relativePath: string, content: string) => {
  if (!installationPath || !relativePath) {
    return { success: false, error: 'installationPath and relativePath are required.' };
  }
  if (typeof content !== 'string') {
    return { success: false, error: 'content must be a string.' };
  }

  try {
    return writeInstallationTextFile(installationPath, relativePath, content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
});

ipcMain.handle(IPC.GAME_FILE_RENAME, (_event, installationPath: string, relativePath: string, nextName: string) => {
  if (!installationPath || !relativePath || !nextName) {
    return { success: false, error: 'installationPath, relativePath, and nextName are required.' };
  }

  try {
    return renameInstallationEntry(installationPath, relativePath, nextName);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
});

ipcMain.handle(IPC.GAME_FILE_COPY, (_event, installationPath: string, sourceRelativePath: string, destinationDir: string) => {
  if (!installationPath || !sourceRelativePath) {
    return { success: false, error: 'installationPath and sourceRelativePath are required.' };
  }

  try {
    return copyInstallationEntry(installationPath, sourceRelativePath, destinationDir ?? '');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
});

ipcMain.handle(IPC.GAME_FILE_MOVE, (_event, installationPath: string, sourceRelativePath: string, destinationDir: string) => {
  if (!installationPath || !sourceRelativePath) {
    return { success: false, error: 'installationPath and sourceRelativePath are required.' };
  }

  try {
    return moveInstallationEntry(installationPath, sourceRelativePath, destinationDir ?? '');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
});

ipcMain.handle(IPC.GAME_FILE_DELETE, (_event, installationPath: string, relativePath: string) => {
  if (!installationPath || !relativePath) {
    return { success: false, error: 'installationPath and relativePath are required.' };
  }

  try {
    return deleteInstallationEntry(installationPath, relativePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
});

// ─── Session file reader ─────────────────────────────────────────────────────

/** Narrow a value to a plain (non-null, non-array) object. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Read the `launcher-session.json` file that the game writes into the
 * installation directory after each play session.  Validates that the
 * result is a plain object before returning it; returns `null` when the
 * file is absent, cannot be parsed, or contains an unexpected type.
 */
ipcMain.handle(IPC.GAME_READ_SESSION, (_event, installationPath: string) => {
  const sessionFilePath = path.join(installationPath, 'launcher-session.json');
  try {
    if (!fs.existsSync(sessionFilePath)) return null;
    const content = fs.readFileSync(sessionFilePath, 'utf8');
    const parsed = JSON.parse(content) as unknown;
    if (!isPlainObject(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
});

// ─── Application menu ────────────────────────────────────────────────────────

function buildMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'StarMade Launcher',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { role: 'close' },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ─── Dialog handlers ─────────────────────────────────────────────────────────

ipcMain.handle(IPC.DIALOG_OPEN_FOLDER, async (_event, defaultPath?: string) => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: defaultPath || app.getPath('home'),
  });
  
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  
  return result.filePaths[0];
});

ipcMain.handle(IPC.DIALOG_OPEN_FILE, async (_event, defaultPath?: string, type?: 'image' | 'java' | 'modpack') => {
  const imageFilters = [
    { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico'] },
    { name: 'All Files', extensions: ['*'] },
  ];
  const exeFilters = [
    { name: 'Java Executable', extensions: process.platform === 'win32' ? ['exe'] : ['*'] },
    { name: 'All Files', extensions: ['*'] },
  ];
  const modpackFilters = [
    { name: 'StarMade Modpack', extensions: ['json'] },
    { name: 'JSON', extensions: ['json'] },
    { name: 'All Files', extensions: ['*'] },
  ];

  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    defaultPath: defaultPath || app.getPath('home'),
    filters: type === 'image' ? imageFilters : type === 'modpack' ? modpackFilters : exeFilters,
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return result.filePaths[0];
});

// ─── App handlers ────────────────────────────────────────────────────────────

function readServerPanelSchema(): unknown {
  const readJsonObject = (candidatePath: string): Record<string, unknown> | null => {
    try {
      if (!fs.existsSync(candidatePath)) return null;
      const raw = fs.readFileSync(candidatePath, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch (error) {
      console.warn('[schema] Failed to read schema file:', { candidatePath, error });
    }
    return null;
  };

  const userConfigDir = path.join(app.getPath('userData'), 'config');
  const bundledConfigDir = path.join(__dirname, '..', 'presets', 'config');

  const serverSchema = readJsonObject(path.join(userConfigDir, 'server-config-schema.json'))
    ?? readJsonObject(path.join(bundledConfigDir, 'server-config-schema.json'));
  const gameSchema = readJsonObject(path.join(userConfigDir, 'gameconfig-schema.json'))
    ?? readJsonObject(path.join(bundledConfigDir, 'gameconfig-schema.json'));
  const factionSchema = readJsonObject(path.join(userConfigDir, 'factionconfig-schema.json'))
    ?? readJsonObject(path.join(bundledConfigDir, 'factionconfig-schema.json'));

  if (serverSchema || gameSchema || factionSchema) {
    const merged = {
      version: 1,
      ...(serverSchema ?? {}),
      ...(gameSchema ?? {}),
      ...(factionSchema ?? {}),
    };
    return merged;
  }

  // Backward-compatibility fallback for previous combined schema filename.
  return readJsonObject(path.join(userConfigDir, 'server-panel-schema.json'))
    ?? readJsonObject(path.join(bundledConfigDir, 'server-panel-schema.json'))
    ?? null;
}

ipcMain.handle(IPC.APP_GET_USER_DATA, () => app.getPath('userData'));
ipcMain.handle(IPC.APP_GET_SYSTEM_MEMORY, () => Math.floor(os.totalmem() / (1024 * 1024)));
ipcMain.handle(IPC.APP_GET_SERVER_PANEL_SCHEMA, () => readServerPanelSchema());

const LICENSES_DIR_NAMES = ['licenses'];

function resolveBundledLicensesDir(): string | null {
  for (const dirName of LICENSES_DIR_NAMES) {
    const candidate = path.join(__dirname, '..', 'presets', dirName);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate;
    }
  }
  return null;
}

function listBundledLicenseFiles(): Array<{ fileName: string; sizeBytes: number; modifiedMs: number }> {
  const sourceDir = resolveBundledLicensesDir();
  if (!sourceDir) return [];

  return fs.readdirSync(sourceDir)
    .map((fileName) => {
      const absolutePath = path.join(sourceDir, fileName);
      if (!fs.existsSync(absolutePath)) return null;
      const stat = fs.statSync(absolutePath);
      if (!stat.isFile()) return null;
      return {
        fileName,
        sizeBytes: stat.size,
        modifiedMs: stat.mtimeMs,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .sort((a, b) => a.fileName.localeCompare(b.fileName));
}

function resolveBundledLicensePath(fileName: string): string {
  if (typeof fileName !== 'string' || fileName.trim().length === 0) {
    throw new Error('File name is required.');
  }
  if (fileName.includes('/') || fileName.includes('\\')) {
    throw new Error('Invalid file name.');
  }

  const sourceDir = resolveBundledLicensesDir();
  if (!sourceDir) {
    throw new Error('Bundled licenses directory was not found.');
  }

  const absolutePath = path.resolve(path.join(sourceDir, fileName));
  if (!absolutePath.startsWith(path.resolve(sourceDir) + path.sep)) {
    throw new Error('Invalid file path.');
  }

  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
    throw new Error('License file does not exist.');
  }

  return absolutePath;
}

ipcMain.handle(IPC.LICENSES_LIST, () => {
  try {
    return listBundledLicenseFiles();
  } catch (error) {
    console.warn('[licenses] Failed to list bundled licenses:', error);
    return [];
  }
});

ipcMain.handle(IPC.LICENSES_READ, (_event, fileName: string) => {
  try {
    const licensePath = resolveBundledLicensePath(fileName);
    const content = fs.readFileSync(licensePath, 'utf8');
    return { content, error: undefined as string | undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { content: '', error: message };
  }
});

ipcMain.handle(IPC.LICENSES_COPY_TO_USER_DATA, () => {
  try {
    const sourceDir = resolveBundledLicensesDir();
    if (!sourceDir) {
      return { success: false, copiedCount: 0, error: 'Bundled licenses directory was not found.' };
    }

    const destinationDir = path.join(app.getPath('userData'), 'licenses');
    fs.mkdirSync(destinationDir, { recursive: true });

    const files = listBundledLicenseFiles();
    let copiedCount = 0;
    for (const file of files) {
      const sourcePath = path.join(sourceDir, file.fileName);
      const destinationPath = path.join(destinationDir, file.fileName);
      fs.copyFileSync(sourcePath, destinationPath);
      copiedCount += 1;
    }

    return { success: true, copiedCount, destinationDir };
  } catch (error) {
    return { success: false, copiedCount: 0, error: String(error) };
  }
});

// ─── Installation file management handlers ───────────────────────────────────

/**
 * Well-known files and folders found in a valid StarMade installation.
 * Used by `isStarMadeInstallDir` to verify a directory before deleting it.
 */
const STARMADE_MARKERS = new Set([
  'StarMade.jar', // Main game JAR
  'version.txt',  // Version descriptor written by the game/launcher
  'data',         // Game data folder (saves, universe, etc.)
  'logs',         // Game log folder
  'StarMade',     // Nested StarMade subdirectory (some installs)
]);

/**
 * Returns true when `targetPath` is safe to recursively delete.
 *
 * Safety checks:
 * - Must be an absolute path with at least 2 directory levels below the
 *   filesystem root (prevents deleting root, drive root, or a top-level
 *   system directory such as /home or C:\Users).
 * - Must not equal, nor be a parent of, any well-known system directory.
 *   On Windows the protected list is built from environment variables so it
 *   correctly uses the real absolute paths regardless of the drive letter.
 */
function isSafeDeletionPath(targetPath: string): boolean {
  const normalized = path.normalize(targetPath);

  // Must be absolute.
  if (!path.isAbsolute(normalized)) return false;

  // Strip the filesystem root (e.g. '/' or 'C:\') and require at least two
  // meaningful path components beneath it, e.g.:
  //   /home            → 1 component → BLOCKED
  //   /home/alice      → 2 components → BLOCKED (home roots listed below)
  //   /home/alice/game → 3 components → OK (if not in blocked list)
  const { root } = path.parse(normalized);
  const relParts = normalized.slice(root.length).split(path.sep).filter(Boolean);
  if (relParts.length < 2) return false;

  // Build the complete set of paths that must never be deleted.
  const blockedPaths = new Set<string>();

  if (process.platform === 'win32') {
    // Drive root (e.g. C:\) – already captured via path.parse().root above.
    blockedPaths.add(path.normalize(root));

    // Absolute system directories derived from well-known environment variables.
    for (const envPath of [
      process.env.SystemRoot,           // C:\Windows
      process.env.ProgramFiles,         // C:\Program Files
      process.env['ProgramFiles(x86)'], // C:\Program Files (x86)
    ]) {
      if (envPath) blockedPaths.add(path.normalize(envPath));
    }

    // Parent directory of all user home folders (e.g. C:\Users).
    blockedPaths.add(path.dirname(os.homedir()));
  } else {
    // Unix / macOS well-known system directories (all expressed as absolute paths).
    for (const p of [
      '/', '/bin', '/boot', '/dev', '/etc', '/lib', '/lib64',
      '/proc', '/root', '/sbin', '/sys', '/tmp', '/usr', '/var',
      '/home',   // parent of Linux user dirs — must NOT be deleted
      '/Users',  // parent of macOS user dirs — must NOT be deleted
    ]) {
      blockedPaths.add(path.normalize(p));
    }
  }

  const lowerNormalized = normalized.toLowerCase();
  for (const blocked of blockedPaths) {
    const lowerBlocked = blocked.toLowerCase();
    // Block if normalized equals the protected path.
    if (lowerNormalized === lowerBlocked) return false;
    // Block if normalized is a *parent* of a protected path
    // (e.g. prevent someone sneaking in the parent of C:\Windows).
    if (lowerBlocked.startsWith(lowerNormalized + path.sep)) return false;
  }

  return true;
}

/**
 * Returns true when `targetPath` appears to be a launcher-managed StarMade
 * installation directory.
 *
 * An empty directory is considered safe to remove (it may have been created
 * just before a download was cancelled or never started).
 *
 * For non-empty directories we require at least one well-known StarMade
 * marker file/folder to be present.  This prevents accidental deletion of
 * unrelated directories that happen to have the same path as a misconfigured
 * installation record.
 */
function isStarMadeInstallDir(targetPath: string): boolean {
  let entries: string[];
  try {
    entries = fs.readdirSync(targetPath);
  } catch {
    // If we cannot read the directory (e.g. permissions), be conservative.
    return false;
  }

  // Empty directory – safe to delete (created pre-download or after a cancel).
  if (entries.length === 0) return true;

  // At least one well-known StarMade marker must be present.
  return entries.some(e => STARMADE_MARKERS.has(e));
}

ipcMain.handle(IPC.INSTALLATION_DELETE_FILES, async (_event, targetPath: string) => {
  if (typeof targetPath !== 'string' || targetPath.trim() === '') {
    return { success: false, error: 'Invalid path.' };
  }

  const candidatePaths = getManagedPathCandidates(targetPath, getLauncherDir());
  const resolvedTargetPath = candidatePaths.find(candidate => fs.existsSync(candidate)) ?? candidatePaths[0];

  if (!resolvedTargetPath) {
    return { success: false, error: 'Invalid path.' };
  }

  if (!isSafeDeletionPath(resolvedTargetPath)) {
    return { success: false, error: 'Path is not safe to delete.' };
  }

  // Directory already absent – nothing to do.
  if (!fs.existsSync(resolvedTargetPath)) {
    return { success: true };
  }

  /*if (!isStarMadeInstallDir(resolvedTargetPath)) {
    return {
      success: false,
      error: `The directory does not appear to be a StarMade installation: ${resolvedTargetPath}`,
    };
  }*/

  try {
    await fs.promises.rm(resolvedTargetPath, { recursive: true, force: true });
    if (fs.existsSync(resolvedTargetPath)) {
      return { success: false, error: `Directory still exists after deletion: ${resolvedTargetPath}` };
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
});

// ─── Installation backup / restore handlers ──────────────────────────────────

/**
 * Strict allowlist for installation IDs used in backup directory paths.
 * IDs are generated via Date.now().toString() so only digits are ever expected,
 * but we also permit hyphens and underscores for forward compatibility.
 * Path separators and dots are explicitly excluded to prevent directory traversal.
 */
const SAFE_ID_RE = /^[a-zA-Z0-9_-]+$/;

/**
 * Returns the directory used to store backups for a given installation.
 * Backups live under `<userData>/backups/<installationId>/`.
 *
 * Throws if `installationId` fails the safe-ID check.
 */
function getBackupDir(installationId: string): string {
  if (!SAFE_ID_RE.test(installationId)) {
    throw new Error(`Invalid installation ID: "${installationId}"`);
  }
  const backupsRoot = path.join(app.getPath('userData'), 'backups');
  const backupDir = path.join(backupsRoot, installationId);
  // Paranoia check: ensure the resolved path stays inside the backups root.
  const normalizedRoot = path.normalize(backupsRoot) + path.sep;
  if (!path.normalize(backupDir).startsWith(normalizedRoot)) {
    throw new Error('Installation ID resolves outside the backups directory.');
  }
  return backupDir;
}

/**
 * Run `adm-zip` folder compression in a worker thread so the Electron main
 * thread (and therefore the IPC event-loop) stays responsive during large
 * backups.
 */
function createZipInWorker(sourcePath: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // In the packaged app the worker lives at dist-electron/backup-worker.js.
    // In development it is at the same path relative to __dirname.
    const workerPath = path.join(__dirname, 'backup-worker.js');
    const worker = new Worker(workerPath, {
      workerData: { sourcePath, destPath },
    });
    worker.on('message', (msg: { type: string; message?: string }) => {
      if (msg.type === 'done') resolve();
      else reject(new Error(msg.message ?? 'Unknown worker error'));
    });
    worker.on('error', reject);
    worker.on('exit', (code) => {
      if (code !== 0) reject(new Error(`Backup worker exited with code ${code}`));
    });
  });
}

ipcMain.handle(
  IPC.INSTALLATION_BACKUP,
  async (
    _event,
    payload: { installationPath: string; installationId: string; installationName: string },
  ) => {
    const { installationPath, installationId, installationName } = payload ?? {};

    if (typeof installationPath !== 'string' || installationPath.trim() === '') {
      return { success: false, error: 'Invalid installation path.' };
    }
    if (typeof installationId !== 'string' || installationId.trim() === '') {
      return { success: false, error: 'Invalid installation ID.' };
    }

    if (!fs.existsSync(installationPath)) {
      return { success: false, error: 'Installation directory does not exist.' };
    }

    let backupDir: string;
    try {
      backupDir = getBackupDir(installationId);
    } catch (err) {
      return { success: false, error: String(err) };
    }

    try {
      fs.mkdirSync(backupDir, { recursive: true });
    } catch (err) {
      return { success: false, error: `Failed to create backup directory: ${String(err)}` };
    }

    // Build a safe filename from the installation name and a timestamp.
    const safeName = (installationName ?? 'backup').replace(/[^a-zA-Z0-9_\-]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'backup';
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFileName = `${safeName}_${timestamp}.zip`;
    const backupPath = path.join(backupDir, backupFileName);

    try {
      // Run compression in a worker thread to keep the main thread responsive.
      await createZipInWorker(installationPath, backupPath);
      return { success: true, backupPath };
    } catch (err) {
      // Clean up partial zip if it was created.
      try { fs.unlinkSync(backupPath); } catch (cleanupErr) {
        console.warn('[backup] Failed to clean up partial zip:', cleanupErr);
      }
      return { success: false, error: String(err) };
    }
  },
);

ipcMain.handle(
  IPC.INSTALLATION_RESTORE,
  async (_event, payload: { backupPath: string; targetPath: string }) => {
    const { backupPath, targetPath } = payload ?? {};

    if (typeof backupPath !== 'string' || backupPath.trim() === '') {
      return { success: false, error: 'Invalid backup path.' };
    }
    if (typeof targetPath !== 'string' || targetPath.trim() === '') {
      return { success: false, error: 'Invalid target path.' };
    }

    // Validate backupPath is a .zip file inside the launcher-managed backups directory.
    const backupsRoot = path.normalize(path.join(app.getPath('userData'), 'backups'));
    const normalizedBackup = path.normalize(backupPath);
    if (
      !normalizedBackup.startsWith(backupsRoot + path.sep) ||
      !normalizedBackup.endsWith('.zip')
    ) {
      return { success: false, error: 'Backup path is not a valid launcher-managed backup.' };
    }

    if (!fs.existsSync(backupPath)) {
      return { success: false, error: 'Backup file does not exist.' };
    }
    if (!isSafeDeletionPath(targetPath)) {
      return { success: false, error: 'Target path is not safe.' };
    }

    // Require the target to look like a StarMade installation (or be absent/empty)
    // before deleting it, to prevent wiping unrelated directories.
    /*if (fs.existsSync(targetPath) && !isStarMadeInstallDir(targetPath)) {
      return {
        success: false,
        error: `The directory does not appear to be a StarMade installation: ${targetPath}`,
      };
    }*/

    // ── Atomic-style restore ─────────────────────────────────────────────────
    // Extract into a temp directory first.  Only replace the target directory
    // after a successful extraction so the user is never left without files.
    const tempDir = `${targetPath}.restore-tmp-${Date.now()}`;
    try {
      fs.mkdirSync(tempDir, { recursive: true });

      const AdmZip = (await import('adm-zip')).default;
      const zip = new AdmZip(backupPath);
      zip.extractAllTo(tempDir, /* overwrite */ true);

      // Atomically swap: remove old installation, rename temp into place.
      if (fs.existsSync(targetPath)) {
        await fs.promises.rm(targetPath, { recursive: true, force: true });
      }
      fs.renameSync(tempDir, targetPath);

      return { success: true };
    } catch (err) {
      // Clean up temp dir on failure; log but don't surface cleanup errors.
      try {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
      } catch (cleanupErr) {
        console.warn('[restore] Failed to clean up temp directory:', cleanupErr);
      }
      return { success: false, error: String(err) };
    }
  },
);

ipcMain.handle(IPC.INSTALLATION_LIST_BACKUPS, async (_event, installationId: string) => {
  if (typeof installationId !== 'string' || installationId.trim() === '') {
    return [];
  }

  let backupDir: string;
  try {
    backupDir = getBackupDir(installationId);
  } catch {
    return [];
  }

  if (!fs.existsSync(backupDir)) return [];

  try {
    const files = fs.readdirSync(backupDir).filter(f => f.endsWith('.zip'));
    const result = files
      .map(f => {
        const filePath = path.join(backupDir, f);
        try {
          const stat = fs.statSync(filePath);
          return {
            name: f,
            path: filePath,
            createdAt: stat.birthtime.toISOString(),
            sizeBytes: stat.size,
          };
        } catch {
          return null;
        }
      })
      .filter((b): b is NonNullable<typeof b> => b !== null)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return result;
  } catch {
    return [];
  }
});

// ─── Shell handlers ──────────────────────────────────────────────────────────

ipcMain.handle(IPC.SHELL_OPEN_PATH, async (_event, targetPath: string) => {
  const err = await shell.openPath(targetPath);
  return err === '' ? { success: true } : { success: false, error: err };
});

ipcMain.handle(IPC.SHELL_OPEN_EXTERNAL, async (_event, url: string) => {
  // Only allow http/https URLs to prevent arbitrary protocol abuse.
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
    return { success: false, error: 'Only http/https URLs are supported.' };
  }
  await shell.openExternal(url);
  return { success: true };
});

// ─── Backgrounds handler ─────────────────────────────────────────────────────

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
const SCREENSHOT_EXTS = new Set(['.png']);
const LAUNCHER_BACKGROUND_KEY = 'launcherBackgroundUrl';
const MODS_METADATA_KEY = 'modsMetadataV1';

const modMetadataStore = {
  get: () => storeGet(MODS_METADATA_KEY),
  set: (value: unknown) => storeSet(MODS_METADATA_KEY, value),
};

function listImagesInDir(dir: string): string[] {
  try {
    if (!fs.existsSync(dir)) return [];

    const toFileHref = (absolutePath: string): string => pathToFileURL(absolutePath).href;

    return fs.readdirSync(dir)
      .filter(f => IMAGE_EXTS.has(path.extname(f).toLowerCase()))
      .map(f => toFileHref(path.join(dir, f)));
  } catch {
    return [];
  }
}

function normalizeStoredFileUrl(maybeUrl: string): string | null {
  if (typeof maybeUrl !== 'string' || maybeUrl.trim().length === 0) return null;

  // For plain paths accidentally persisted as a URL, normalize to file:// URL.
  if (!maybeUrl.startsWith('file://')) {
    return fs.existsSync(maybeUrl) ? pathToFileURL(maybeUrl).href : null;
  }

  // Legacy values may look like file://C:\path\to\image.png
  if (maybeUrl.includes('\\')) {
    const withoutScheme = maybeUrl.replace(/^file:\/\//i, '').replace(/\\/g, '/');
    const normalizedPath = /^[a-zA-Z]:\//.test(withoutScheme)
      ? withoutScheme
      : withoutScheme.replace(/^\/+/, '/');
    try {
      const decodedPath = decodeURIComponent(normalizedPath);
      return pathToFileURL(decodedPath).href;
    } catch {
      return null;
    }
  }

  try {
    const parsed = new URL(maybeUrl);
    if (parsed.protocol !== 'file:') return null;
    return parsed.href;
  } catch {
    return null;
  }
}

function importImageToDir(sourcePath: string, targetDir: string): { success: boolean; path?: string; error?: string } {
  try {
    if (typeof sourcePath !== 'string' || sourcePath.trim().length === 0) {
      return { success: false, error: 'Invalid source path.' };
    }
    if (!fs.existsSync(sourcePath)) {
      return { success: false, error: 'Selected file does not exist.' };
    }

    const ext = path.extname(sourcePath).toLowerCase();
    if (!IMAGE_EXTS.has(ext)) {
      return { success: false, error: 'Unsupported icon format.' };
    }

    fs.mkdirSync(targetDir, { recursive: true });

    const baseNameRaw = path.basename(sourcePath, ext);
    const baseName = baseNameRaw.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'custom-icon';

    let counter = 0;
    let destFileName = `${baseName}${ext}`;
    let destPath = path.join(targetDir, destFileName);
    while (fs.existsSync(destPath)) {
      counter += 1;
      destFileName = `${baseName}-${counter}${ext}`;
      destPath = path.join(targetDir, destFileName);
    }

    fs.copyFileSync(sourcePath, destPath);
    return { success: true, path: pathToFileURL(destPath).href };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

function copyImageToDir(sourcePath: string, targetDir: string, fallbackBaseName: string): { success: boolean; path?: string; error?: string } {
  try {
    if (typeof sourcePath !== 'string' || sourcePath.trim().length === 0) {
      return { success: false, error: 'Invalid source path.' };
    }
    if (!fs.existsSync(sourcePath)) {
      return { success: false, error: 'Selected file does not exist.' };
    }

    const ext = path.extname(sourcePath).toLowerCase();
    if (!IMAGE_EXTS.has(ext)) {
      return { success: false, error: 'Unsupported image format.' };
    }

    fs.mkdirSync(targetDir, { recursive: true });

    const baseNameRaw = path.basename(sourcePath, ext);
    const baseName = baseNameRaw.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || fallbackBaseName;

    let counter = 0;
    let destFileName = `${baseName}${ext}`;
    let destPath = path.join(targetDir, destFileName);
    while (fs.existsSync(destPath)) {
      counter += 1;
      destFileName = `${baseName}-${counter}${ext}`;
      destPath = path.join(targetDir, destFileName);
    }

    fs.copyFileSync(sourcePath, destPath);
    return { success: true, path: destPath };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

function resolveInstallationRoot(installationPath: string): string | null {
  if (typeof installationPath !== 'string' || installationPath.trim().length === 0) return null;
  const candidates = getManagedPathCandidates(installationPath, getLauncherDir());
  return candidates.find(candidate => fs.existsSync(candidate)) ?? null;
}

function resolveScreenshotFilePath(installationPath: string, screenshotPath: string): string {
  const installationRoot = resolveInstallationRoot(installationPath);
  if (!installationRoot) {
    throw new Error('Installation path does not exist.');
  }

  const screenshotsDir = path.resolve(path.join(installationRoot, 'screenshots'));
  const normalizedScreenshotPath = path.resolve(screenshotPath);
  if (!normalizedScreenshotPath.startsWith(`${screenshotsDir}${path.sep}`)) {
    throw new Error('Screenshot path is outside the installation screenshots directory.');
  }

  if (!fs.existsSync(normalizedScreenshotPath) || !fs.statSync(normalizedScreenshotPath).isFile()) {
    throw new Error('Screenshot file does not exist.');
  }

  if (!SCREENSHOT_EXTS.has(path.extname(normalizedScreenshotPath).toLowerCase())) {
    throw new Error('Only PNG screenshots are supported.');
  }

  return normalizedScreenshotPath;
}

function listPngScreenshots(installationPath: string): {
  screenshotsDir: string;
  screenshots: Array<{ name: string; path: string; fileUrl: string; sizeBytes: number; modifiedMs: number; width: number; height: number }>;
} {
  const installationRoot = resolveInstallationRoot(installationPath);
  const screenshotsDir = installationRoot
    ? path.join(installationRoot, 'screenshots')
    : path.join(path.resolve(installationPath || '.'), 'screenshots');

  if (!installationRoot || !fs.existsSync(screenshotsDir)) {
    return { screenshotsDir, screenshots: [] };
  }

  const screenshots = fs.readdirSync(screenshotsDir)
    .filter(fileName => SCREENSHOT_EXTS.has(path.extname(fileName).toLowerCase()))
    .map(fileName => {
      const absolutePath = path.join(screenshotsDir, fileName);
      const stats = fs.statSync(absolutePath);
      const img = nativeImage.createFromPath(absolutePath);
      const { width, height } = img.getSize();

      return {
        name: fileName,
        path: absolutePath,
        fileUrl: pathToFileURL(absolutePath).href,
        sizeBytes: stats.size,
        modifiedMs: stats.mtimeMs,
        width,
        height,
      };
    })
    .sort((a, b) => b.modifiedMs - a.modifiedMs);

  return { screenshotsDir, screenshots };
}

ipcMain.handle(IPC.BACKGROUNDS_LIST, async () => {
  const userDir    = path.join(app.getPath('userData'), 'backgrounds');
  const bundledDir = path.join(__dirname, '..', 'presets', 'backgrounds');

  try { fs.mkdirSync(userDir, { recursive: true }); } catch { /* ignore */ }

  return [...listImagesInDir(bundledDir), ...listImagesInDir(userDir)];
});

ipcMain.handle(IPC.BACKGROUNDS_GET_PREFERRED, async () => {
  const raw = storeGet(LAUNCHER_BACKGROUND_KEY);
  if (typeof raw !== 'string' || raw.trim().length === 0) return null;

  const normalized = normalizeStoredFileUrl(raw);
  if (!normalized) return null;

  // Auto-heal old malformed values so future launches are stable.
  if (normalized !== raw) {
    storeSet(LAUNCHER_BACKGROUND_KEY, normalized);
  }

  return normalized;
});

ipcMain.handle(IPC.ICONS_LIST, async () => {
  const userDir    = path.join(app.getPath('userData'), 'icons');
  const bundledDir = path.join(__dirname, '..', 'presets', 'icons');

  // Ensure the user icons folder exists so they know where to put images
  try { fs.mkdirSync(userDir, { recursive: true }); } catch { /* ignore */ }

  return [...listImagesInDir(bundledDir), ...listImagesInDir(userDir)];
});

ipcMain.handle(IPC.ICONS_IMPORT, async (_event, sourcePath: string) => {
  const userDir = path.join(app.getPath('userData'), 'icons');
  return importImageToDir(sourcePath, userDir);
});

ipcMain.handle(IPC.SCREENSHOTS_LIST, async (_event, installationPath: string) => {
  try {
    return listPngScreenshots(installationPath);
  } catch (error) {
    console.warn('[screenshots] Failed to list screenshots:', { installationPath, error });
    return { screenshotsDir: path.join(installationPath || '', 'screenshots'), screenshots: [] };
  }
});

ipcMain.handle(IPC.SCREENSHOTS_COPY_TO_CLIPBOARD, async (_event, installationPath: string, screenshotPath: string) => {
  try {
    const resolvedScreenshotPath = resolveScreenshotFilePath(installationPath, screenshotPath);
    const image = nativeImage.createFromPath(resolvedScreenshotPath);
    if (image.isEmpty()) {
      return { success: false, error: 'Could not decode screenshot image.' };
    }
    clipboard.writeImage(image);
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle(IPC.SCREENSHOTS_OPEN_CONTAINING_FOLDER, async (_event, installationPath: string, screenshotPath: string) => {
  try {
    const resolvedScreenshotPath = resolveScreenshotFilePath(installationPath, screenshotPath);
    shell.showItemInFolder(resolvedScreenshotPath);
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle(IPC.SCREENSHOTS_DELETE, async (_event, installationPath: string, screenshotPath: string) => {
  try {
    const resolvedScreenshotPath = resolveScreenshotFilePath(installationPath, screenshotPath);
    fs.unlinkSync(resolvedScreenshotPath);
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle(IPC.SCREENSHOTS_SET_AS_LAUNCHER_BACKGROUND, async (_event, installationPath: string, screenshotPath: string) => {
  try {
    const resolvedScreenshotPath = resolveScreenshotFilePath(installationPath, screenshotPath);
    const userBackgroundDir = path.join(app.getPath('userData'), 'backgrounds');
    const imported = copyImageToDir(resolvedScreenshotPath, userBackgroundDir, 'screenshot-background');
    if (!imported.success || !imported.path) {
      return { success: false, error: imported.error ?? 'Failed to copy screenshot to launcher backgrounds.' };
    }

    const url = pathToFileURL(imported.path).href;
    storeSet(LAUNCHER_BACKGROUND_KEY, url);
    return { success: true, url };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle(
  IPC.SCREENSHOTS_SET_AS_LOADING_SCREEN,
  async (_event, sourceInstallationPath: string, screenshotPath: string, targetInstallationPath?: string) => {
  try {
    const resolvedScreenshotPath = resolveScreenshotFilePath(sourceInstallationPath, screenshotPath);
    const destinationInstallationPath = targetInstallationPath ?? sourceInstallationPath;
    const installationRoot = resolveInstallationRoot(destinationInstallationPath);
    if (!installationRoot) {
      return { success: false, error: 'Installation path does not exist.' };
    }

    const loadingScreensDir = path.join(installationRoot, 'data', 'image-resource', 'loading-screens');
    const copied = copyImageToDir(resolvedScreenshotPath, loadingScreensDir, 'loading-screen');
    if (!copied.success || !copied.path) {
      return { success: false, error: copied.error ?? 'Failed to copy screenshot to loading-screens folder.' };
    }

    return { success: true, destinationPath: copied.path };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

// ─── Mods handlers ───────────────────────────────────────────────────────────

ipcMain.handle(IPC.MODS_LIST, async (_event, installationPath: string) => {
  try {
    return listModsForInstallation(installationPath, getLauncherDir(), modMetadataStore);
  } catch (error) {
    return {
      modsDir: path.join(installationPath || '', 'mods'),
      mods: [],
      error: String(error),
    };
  }
});

ipcMain.handle(IPC.MODS_SMD_LIST, async (_event, searchQuery?: string) => {
  try {
    const mods = await listSmdMods(searchQuery);
    return { success: true, mods };
  } catch (error) {
    return { success: false, mods: [], error: String(error) };
  }
});

ipcMain.handle(
  IPC.MODS_SMD_INSTALL_OR_UPDATE,
  async (_event, installationPath: string, resourceId: number, enabled = true) => {
    try {
      const mod = await installOrUpdateSmdModForInstallation({
        installationPath,
        launcherDir: getLauncherDir(),
        resourceId,
        enabled,
        metadataStore: modMetadataStore,
      });
      return { success: true, mod };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  },
);

ipcMain.handle(
  IPC.MODS_SMD_CHECK_UPDATES,
  async (_event, installed: Array<{ resourceId: number; smdVersion: string }>) => {
    try {
      const updates = await checkSmdUpdatesForInstalled(Array.isArray(installed) ? installed : []);
      return { success: true, updates };
    } catch (error) {
      return { success: false, updates: [], error: String(error) };
    }
  },
);

ipcMain.handle(IPC.MODS_REMOVE, async (_event, installationPath: string, relativePath: string) => {
  try {
    removeModForInstallation({
      installationPath,
      launcherDir: getLauncherDir(),
      relativePath,
      metadataStore: modMetadataStore,
    });
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle(IPC.MODS_SET_ENABLED, async (_event, installationPath: string, relativePath: string, enabled: boolean) => {
  try {
    const result = setModEnabledForInstallation({
      installationPath,
      launcherDir: getLauncherDir(),
      relativePath,
      enabled,
    });
    return { success: true, relativePath: result.relativePath };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle(
  IPC.MODS_EXPORT_MODPACK,
  async (
    _event,
    installationPath: string,
    outputPath: string,
    options?: {
      name?: string;
      sourceInstallation?: { id?: string; name?: string; version?: string };
    },
  ) => {
    try {
      const name = typeof options?.name === 'string' ? options.name : 'StarMade Modpack';
      const result = createModpackManifest({
        installationPath,
        launcherDir: getLauncherDir(),
        manifestName: name,
        sourceInstallation: options?.sourceInstallation,
        metadataStore: modMetadataStore,
      });
      writeModpackManifest(outputPath, result.manifest);
      return {
        success: true,
        outputPath,
        exportedCount: result.exportedCount,
        skippedCount: result.skippedCount,
      };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  },
);

ipcMain.handle(IPC.MODS_IMPORT_MODPACK, async (_event, installationPath: string, manifestPath: string) => {
  try {
    const result = await importModpackFromFile({
      installationPath,
      launcherDir: getLauncherDir(),
      manifestPath,
      metadataStore: modMetadataStore,
    });
    return {
      success: true,
      downloadedCount: result.downloadedCount,
      skippedCount: result.skippedCount,
      failedCount: result.failedCount,
      failures: result.failures,
    };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

// ─── Preset assets initialisation ───────────────────────────────────────────

/**
 * On the very first launch, copy the bundled preset backgrounds and icons into
 * the user-writable data directory so that users have a set of defaults to
 * start with.  Subsequent launches skip this step (tracked via the store key
 * `presetsInitialized`).
 */
function copyPresetsToUserData(): void {
  const presetsDir = path.join(__dirname, '..', 'presets');
  const userDataDir = app.getPath('userData');

  const copyCategory = (src: string, dest: string, fileFilter: (fileName: string) => boolean): boolean => {
    if (!fs.existsSync(src)) return true;

    try {
      fs.mkdirSync(dest, { recursive: true });
      const files = fs.readdirSync(src).filter(fileFilter);
      for (const file of files) {
        const srcFile  = path.join(src, file);
        const destFile = path.join(dest, file);
        // Never overwrite a file the user may have already customised
        if (!fs.existsSync(destFile)) {
          fs.copyFileSync(srcFile, destFile);
        }
      }
      return true;
    } catch (err) {
      console.error(`[presets] Failed to copy presets from ${src} to ${dest}:`, err);
      return false;
    }
  };

  // Keep schema files updated for both fresh and existing users.
  copyCategory(
    path.join(presetsDir, 'config'),
    path.join(userDataDir, 'config'),
    (fileName) => fileName.toLowerCase().endsWith('.json'),
  );

  if (storeGet('presetsInitialized') === true) return;

  const categories: Array<{ src: string; dest: string; fileFilter: (fileName: string) => boolean }> = [
    {
      src: path.join(presetsDir, 'backgrounds'),
      dest: path.join(userDataDir, 'backgrounds'),
      fileFilter: (fileName) => IMAGE_EXTS.has(path.extname(fileName).toLowerCase()),
    },
    {
      src: path.join(presetsDir, 'icons'),
      dest: path.join(userDataDir, 'icons'),
      fileFilter: (fileName) => IMAGE_EXTS.has(path.extname(fileName).toLowerCase()),
    },
  ];

  let hadError = false;

  for (const { src, dest, fileFilter } of categories) {
    if (!copyCategory(src, dest, fileFilter)) {
      hadError = true;
    }
  }

  // Only mark as done when all copies succeeded so a transient error retries on next launch
  if (!hadError) {
    storeSet('presetsInitialized', true);
  }
}

// ─── Legacy installation detection ───────────────────────────────────────────

/**
 * Asynchronously walk `dir` looking for folders that contain `StarMade.jar`.
 * Stops recursing once `depth` exceeds `maxDepth` to avoid scanning the
 * whole file system. Skips common non-game directories to keep scan time bounded.
 */
const SKIP_DIRS = new Set(['node_modules', '.git', '.svn', '__pycache__']);

function getLegacyAutoDetectRoots(): Array<{ root: string; maxDepth: number }> {
  const roots = new Map<string, number>();
  const addRoot = (rootPath: string | undefined, maxDepth: number) => {
    if (!rootPath) return;
    const normalized = path.resolve(rootPath);
    if (!fs.existsSync(normalized)) return;
    const previousDepth = roots.get(normalized);
    roots.set(normalized, previousDepth === undefined ? maxDepth : Math.max(previousDepth, maxDepth));
  };

  const homeDir = os.homedir();

  // Keep app-local roots for source/dev installs.
  addRoot(process.cwd(), 3);
  addRoot(app.getAppPath(), 3);

  // Add common user-facing locations where old launchers are usually unpacked.
  addRoot(homeDir, 3);
  addRoot(path.join(homeDir, 'Games'), 3);
  addRoot(path.join(homeDir, 'Game Files'), 3);
  addRoot(path.join(homeDir, 'Desktop'), 3);

  return Array.from(roots.entries()).map(([root, maxDepth]) => ({ root, maxDepth }));
}

async function findLegacyInstalls(dir: string, maxDepth = 4, depth = 0): Promise<string[]> {
  if (depth > maxDepth) return [];
  try {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    const results: string[] = [];
    let hasJar = false;

    for (const entry of entries) {
      if (entry.isFile() && entry.name === 'StarMade.jar') {
        hasJar = true;
      } else if (entry.isDirectory() && !SKIP_DIRS.has(entry.name)) {
        const subResults = await findLegacyInstalls(path.join(dir, entry.name), maxDepth, depth + 1);
        results.push(...subResults);
      }
    }

    if (hasJar) results.unshift(dir);
    return results;
  } catch {
    return [];
  }
}

ipcMain.handle(IPC.LEGACY_SCAN, async () => {
  const searchRoots = getLegacyAutoDetectRoots();

  const found = new Set<string>();
  await Promise.all(
    searchRoots.map(({ root, maxDepth }) =>
      findLegacyInstalls(root, maxDepth).then(paths => paths.forEach(p => found.add(p)))
    )
  );
  return Array.from(found);
});

ipcMain.handle(IPC.LEGACY_SCAN_FOLDER, async (_event, folderPath: string) => {
  return findLegacyInstalls(folderPath);
});

ipcMain.handle(IPC.LEGACY_READ_VERSION, async (_event, installPath: string) => {
  try {
    const versionFilePath = path.join(installPath, 'version.txt');
    const content = await fs.promises.readFile(versionFilePath, 'utf-8');
    return parseVersionTxt(content);
  } catch {
    return null;
  }
});

// ─── Auth IPC handlers ────────────────────────────────────────────────────────

ipcMain.handle(IPC.AUTH_LOGIN, async (_event, { username, password }: { username: string; password: string }) => {
  return loginWithPassword(username, password);
});

ipcMain.handle(IPC.AUTH_LOGOUT, (_event, { accountId }: { accountId: string }) => {
  logoutAccount(accountId);
  return { success: true };
});

ipcMain.handle(IPC.AUTH_REFRESH, async (_event, { accountId }: { accountId: string }) => {
  return refreshAccessToken(accountId);
});

ipcMain.handle(
  IPC.AUTH_REGISTER,
  async (
    _event,
    {
      username,
      email,
      password,
      subscribeToNewsletter,
    }: { username: string; email: string; password: string; subscribeToNewsletter: boolean },
  ) => {
    return registerAccount(username, email, password, subscribeToNewsletter);
  },
);

ipcMain.handle(IPC.AUTH_GET_STATUS, (_event, { accountId }: { accountId: string }) => {
  return getAuthStatus(accountId);
});

// ─── Auto-updater ────────────────────────────────────────────────────────────

ipcMain.handle(IPC.UPDATER_GET_VERSION, () => app.getVersion());

ipcMain.handle(
  IPC.UPDATER_CHECK,
  async (
    _event,
    options?: { includePreReleases?: boolean },
  ): Promise<UpdateInfo> => {
    return checkForUpdates(options);
  },
);

ipcMain.handle(
  IPC.UPDATER_DOWNLOAD,
  async (
    event,
    { assetUrl, assetName }: { assetUrl: string; assetName: string },
  ): Promise<{ success: boolean; installerPath?: string; error?: string }> => {
    const { sender } = event;
    try {
      const installerPath = await downloadUpdate(
        assetUrl,
        assetName,
        (progress) => {
          if (!sender.isDestroyed()) {
            sender.send(IPC.UPDATER_DOWNLOAD_PROGRESS, progress);
          }
        },
      );
      return { success: true, installerPath };
    } catch (err) {
      console.error('[Updater] Download failed:', err);
      return { success: false, error: String(err) };
    }
  },
);

ipcMain.handle(
  IPC.UPDATER_INSTALL,
  async (
    _event,
    { installerPath }: { installerPath: string },
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      await installUpdate(installerPath);
      return { success: true };
    } catch (err) {
      console.error('[Updater] Install failed:', err);
      return { success: false, error: String(err) };
    }
  },
);

ipcMain.handle(IPC.UPDATER_OPEN_RELEASES_PAGE, () => {
  openReleasesPage();
});

// ─── Backup / Restore ─────────────────────────────────────────────────────────

ipcMain.handle(IPC.BACKUP_CREATE, async () => {
  return createBackup();
});

ipcMain.handle(IPC.BACKUP_LIST, async () => {
  return listBackups();
});

ipcMain.handle(
  IPC.BACKUP_RESTORE,
  async (
    _event,
    { backupPath }: { backupPath: string },
  ): Promise<{ success: boolean; error?: string }> => {
    const result = await restoreBackup(backupPath);
    if (result.success) {
      // Restart the app so the restored data is picked up by all modules.
      app.relaunch();
      app.quit();
    }
    return result;
  },
);

/** Milliseconds to wait after window creation before sending the update-available event. */
const WINDOW_READY_DELAY_MS = 2_000;

/**
 * On the very first launch, run a background legacy-installation scan and push
 * the results to the renderer via `IPC.LEGACY_SCAN_RESULT`.  Subsequent
 * launches skip the scan entirely (tracked via the store key
 * `legacyAutoScanDone`) so startup performance is not degraded.
 *
 * If the scan throws an unexpected error it is still marked as done to prevent
 * a broken environment from causing every subsequent startup to re-run the
 * slow scan indefinitely.
 */
async function runStartupLegacyScan(): Promise<void> {
  if (storeGet('legacyAutoScanDone') === true) return;

  try {
    const searchRoots = getLegacyAutoDetectRoots();
    const found = new Set<string>();
    await Promise.all(
      searchRoots.map(({ root, maxDepth }) =>
        findLegacyInstalls(root, maxDepth).then(paths => paths.forEach(p => found.add(p)))
      )
    );
    const results = Array.from(found);

    // Mark as done before pushing so a crash during push doesn't re-run the
    // slow scan on every subsequent launch.
    storeSet('legacyAutoScanDone', true);

    if (results.length > 0) {
      storeSet('legacyImportPromptState', {
        status: 'pending',
        paths: results,
        updatedAt: new Date().toISOString(),
      });

      // Delay so the window is fully loaded before the event is delivered.
      // mainWindow may be null if the user closed the window very quickly;
      // the optional-chain handles that case gracefully (identical pattern to
      // runStartupUpdateCheck above).
      setTimeout(() => {
        mainWindow?.webContents.send(IPC.LEGACY_SCAN_RESULT, results);
      }, WINDOW_READY_DELAY_MS);
    }
  } catch (err) {
    // Non-fatal: mark as done to avoid re-running the slow scan on every
    // subsequent launch in environments with a persistent error.
    console.warn('[legacy] Startup scan failed:', err);
    storeSet('legacyAutoScanDone', true);
  }
}

/**
 * Perform a background update check on launch and push a notification to the
 * renderer if a newer version is available.  Respects the user's
 * `checkForUpdates` and `useBetaChannel` launcher settings.
 */
async function runStartupUpdateCheck(): Promise<void> {
  try {
    const stored = storeGet('launcherSettings');
    let includePreReleases = false;
    if (stored && typeof stored === 'object') {
      const settings = stored as Record<string, unknown>;
      if (settings.checkForUpdates === false) return;
      if (settings.useBetaChannel === true) includePreReleases = true;
    }

    const info = await checkForUpdates({ includePreReleases });
    if (info.available) {
      // Delay so the window is fully loaded before the modal appears.
      setTimeout(() => {
        mainWindow?.webContents.send(IPC.UPDATER_UPDATE_AVAILABLE, info);
      }, WINDOW_READY_DELAY_MS);
    }
  } catch (err) {
    // Non-fatal: silently swallow network / API errors on startup.
    console.warn('[updater] Startup check failed:', err);
  }
}

// ─── App lifecycle ───────────────────────────────────────────────────────────

app.whenReady().then(() => {
  copyPresetsToUserData();
  buildMenu();
  createWindow();
  runStartupLegacyScan();
  runStartupUpdateCheck();

  // On Linux AppImage builds, re-register the launcher's icon and .desktop
  // entry every time the app starts.  This repairs the icon in file managers
  // after an in-place auto-update has replaced the AppImage binary on disk
  // (which causes hash-based integration tools like appimaged/AppImageLauncher
  // to orphan their old icon entries).
  //
  // process.env.APPIMAGE is set by the AppImage runtime to the .AppImage file
  // path and is the authoritative source.  The app.getPath('exe') fallback
  // covers the rare edge case where the env var was stripped by the launching
  // environment (see appimage-detect.ts for details on how the AppImage check
  // itself handles this).
  if (process.platform === 'linux' && app.isPackaged &&
      isRunningAsAppImage(process.env, app.getPath('exe'))) {
    registerAppImageDesktopIntegration({
      appImagePath:  process.env.APPIMAGE || app.getPath('exe'),
      resourcesPath: process.resourcesPath,
    });
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    if (hasRunningGames()) {
      console.log('[main] All launcher windows closed while StarMade is still running; keeping the app alive in the background.');
      return;
    }

    app.quit();
  }
});

app.on('before-quit', () => {
  // Stop all running game/server processes
  stopAllGames();
});

