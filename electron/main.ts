import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  shell,
  dialog,
} from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { IPC } from './ipc-channels.js';
import { storeGet, storeSet, storeDelete } from './store.js';
import { fetchAllVersions, invalidateVersionCache } from './versions.js';
import { startDownload, cancelDownload } from './downloader.js';
import type { DownloadProgress } from './downloader.js';
import { downloadJava, detectSystemJava, resolveJavaPath, getDefaultJavaPaths, findJavaExecutableInDir } from './java.js';
import { launchGame, stopGame, getGameStatus, getAllRunningGames, stopAllGames, getLogPath, openLogLocation, getGraphicsInfo } from './launcher.js';
import type { UpdateInfo } from './updater.js';
import { checkForUpdates, downloadUpdate, installUpdate, openReleasesPage } from './updater.js';
import { loginWithPassword, refreshAccessToken, registerAccount, logoutAccount, getAuthStatus, getAccessTokenForLaunch } from './auth.js';
import { isRunningOnWayland } from './wayland-detect.js';
import { parseVersionTxt } from './legacy.js';

// ─── ES Module compatibility ─────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Constants ──────────────────────────────────────────────────────────────

const isDev = !app.isPackaged;
const RENDERER_URL = 'http://localhost:3000';
const PRELOAD_PATH = path.join(__dirname, 'preload.js');

// ─── EPIPE guard ─────────────────────────────────────────────────────────────
// When the launcher is packaged as an AppImage (or any scenario where stdout /
// stderr is not connected to a terminal), Node.js throws an EPIPE error the
// first time console.log / console.error tries to write.  That propagates as
// an uncaught exception and shows the "A JavaScript error occurred" dialog.
// Silently ignoring EPIPE on the stdio streams is the standard Node.js fix.
process.stdout.on('error', (err: NodeJS.ErrnoException) => { if (err.code !== 'EPIPE') throw err; });
process.stderr.on('error', (err: NodeJS.ErrnoException) => { if (err.code !== 'EPIPE') throw err; });

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

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0D0D1B',
    show: false,
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Load the app
  if (isDev) {
    mainWindow.loadURL(RENDERER_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
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

// ─── IPC handlers ────────────────────────────────────────────────────────────

ipcMain.on(IPC.WINDOW_MINIMIZE, () => mainWindow?.minimize());

ipcMain.on(IPC.WINDOW_MAXIMIZE, () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});

ipcMain.on(IPC.WINDOW_CLOSE, () => mainWindow?.close());

// ─── Store IPC handlers ───────────────────────────────────────────────────────

ipcMain.handle(IPC.STORE_GET, (_event, key: string) => storeGet(key));
ipcMain.handle(IPC.STORE_SET, (_event, key: string, value: unknown) => { storeSet(key, value); });
ipcMain.handle(IPC.STORE_DELETE, (_event, key: string) => { storeDelete(key); });

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

ipcMain.handle(IPC.GAME_GET_LOG_PATH, (_event, installationId: string) => {
  return getLogPath(installationId);
});

ipcMain.handle(IPC.GAME_OPEN_LOG_LOCATION, (_event, installationPath: string) => {
  openLogLocation(installationPath);
  return { success: true };
});

ipcMain.handle(IPC.GAME_GET_GRAPHICS_INFO, (_event, installationPath: string) => {
  return getGraphicsInfo(installationPath);
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

ipcMain.handle(IPC.DIALOG_OPEN_FILE, async (_event, defaultPath?: string, type?: 'image') => {
  const imageFilters = [
    { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico'] },
    { name: 'All Files', extensions: ['*'] },
  ];
  const exeFilters = [
    { name: 'Java Executable', extensions: process.platform === 'win32' ? ['exe'] : ['*'] },
    { name: 'All Files', extensions: ['*'] },
  ];

  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    defaultPath: defaultPath || app.getPath('home'),
    filters: type === 'image' ? imageFilters : exeFilters,
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return result.filePaths[0];
});

// ─── App handlers ────────────────────────────────────────────────────────────

ipcMain.handle(IPC.APP_GET_USER_DATA, () => app.getPath('userData'));

// ─── Shell handlers ──────────────────────────────────────────────────────────

ipcMain.handle(IPC.SHELL_OPEN_PATH, async (_event, targetPath: string) => {
  const err = await shell.openPath(targetPath);
  return err === '' ? { success: true } : { success: false, error: err };
});

// ─── Backgrounds handler ─────────────────────────────────────────────────────

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

function listImagesInDir(dir: string): string[] {
  try {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter(f => IMAGE_EXTS.has(path.extname(f).toLowerCase()))
      .map(f => `file://${path.join(dir, f)}`);
  } catch {
    return [];
  }
}

ipcMain.handle(IPC.BACKGROUNDS_LIST, async () => {
  const userDir    = path.join(app.getPath('userData'), 'backgrounds');
  const bundledDir = path.join(__dirname, '..', 'presets', 'backgrounds');

  try { fs.mkdirSync(userDir, { recursive: true }); } catch { /* ignore */ }

  return [...listImagesInDir(bundledDir), ...listImagesInDir(userDir)];
});

ipcMain.handle(IPC.ICONS_LIST, async () => {
  const userDir    = path.join(app.getPath('userData'), 'icons');
  const bundledDir = path.join(__dirname, '..', 'presets', 'icons');

  // Ensure the user icons folder exists so they know where to put images
  try { fs.mkdirSync(userDir, { recursive: true }); } catch { /* ignore */ }

  return [...listImagesInDir(bundledDir), ...listImagesInDir(userDir)];
});

// ─── Preset assets initialisation ───────────────────────────────────────────

/**
 * On the very first launch, copy the bundled preset backgrounds and icons into
 * the user-writable data directory so that users have a set of defaults to
 * start with.  Subsequent launches skip this step (tracked via the store key
 * `presetsInitialized`).
 */
function copyPresetsToUserData(): void {
  if (storeGet('presetsInitialized') === true) return;

  const presetsDir = path.join(__dirname, '..', 'presets');
  const userDataDir = app.getPath('userData');

  const categories: Array<{ src: string; dest: string }> = [
    { src: path.join(presetsDir, 'backgrounds'), dest: path.join(userDataDir, 'backgrounds') },
    { src: path.join(presetsDir, 'icons'),       dest: path.join(userDataDir, 'icons') },
  ];

  let hadError = false;

  for (const { src, dest } of categories) {
    if (!fs.existsSync(src)) continue;

    try {
      fs.mkdirSync(dest, { recursive: true });
      const files = fs.readdirSync(src).filter(f => IMAGE_EXTS.has(path.extname(f).toLowerCase()));
      for (const file of files) {
        const srcFile  = path.join(src, file);
        const destFile = path.join(dest, file);
        // Never overwrite a file the user may have already customised
        if (!fs.existsSync(destFile)) {
          fs.copyFileSync(srcFile, destFile);
        }
      }
    } catch (err) {
      console.error(`[presets] Failed to copy presets from ${src} to ${dest}:`, err);
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
  const searchRoots = new Set<string>([
    process.cwd(),
    app.getAppPath(),
  ]);

  const found = new Set<string>();
  await Promise.all(
    Array.from(searchRoots).map(root =>
      findLegacyInstalls(root, 2).then(paths => paths.forEach(p => found.add(p)))
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

ipcMain.handle(IPC.UPDATER_CHECK, async (): Promise<UpdateInfo> => {
  return checkForUpdates();
});

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

/** Milliseconds to wait after window creation before sending the update-available event. */
const WINDOW_READY_DELAY_MS = 2_000;

/**
 * Perform a background update check on launch and push a notification to the
 * renderer if a newer version is available.  Respects the user's
 * `checkForUpdates` launcher setting.
 */
async function runStartupUpdateCheck(): Promise<void> {
  try {
    const stored = storeGet('launcherSettings');
    if (stored && typeof stored === 'object') {
      const settings = stored as Record<string, unknown>;
      if (settings.checkForUpdates === false) return;
    }

    const info = await checkForUpdates();
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
  runStartupUpdateCheck();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  // Stop all running game/server processes
  stopAllGames();
});

