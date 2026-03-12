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

// ─── ES Module compatibility ─────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Constants ──────────────────────────────────────────────────────────────

const isDev = !app.isPackaged;
const RENDERER_URL = 'http://localhost:3000';
const PRELOAD_PATH = path.join(__dirname, 'preload.js');

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
}) => {
  const launcherDir = getLauncherDir();
  return launchGame({ ...options, launcherDir });
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
  const bundledDir = path.join(__dirname, '..', 'backgrounds');

  try { fs.mkdirSync(userDir, { recursive: true }); } catch { /* ignore */ }

  return [...listImagesInDir(bundledDir), ...listImagesInDir(userDir)];
});

ipcMain.handle(IPC.ICONS_LIST, async () => {
  const userDir    = path.join(app.getPath('userData'), 'icons');
  const bundledDir = path.join(__dirname, '..', 'icons');

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
  if (storeGet('presetsInitialized')) return;

  const presetsDir = path.join(__dirname, '..', 'presets');
  const userDataDir = app.getPath('userData');

  const categories: Array<{ src: string; dest: string }> = [
    { src: path.join(presetsDir, 'backgrounds'), dest: path.join(userDataDir, 'backgrounds') },
    { src: path.join(presetsDir, 'icons'),       dest: path.join(userDataDir, 'icons') },
  ];

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
    }
  }

  storeSet('presetsInitialized', true);
}

// ─── Auto-updater stub ───────────────────────────────────────────────────────
// Full auto-update logic (electron-updater) will be wired in Phase 7/8.
// The stub is kept here so Phase 7 only needs to uncomment/expand it.
//
// import { autoUpdater } from 'electron-updater';
// function initAutoUpdater(): void {
//   autoUpdater.checkForUpdatesAndNotify();
// }

// ─── App lifecycle ───────────────────────────────────────────────────────────

app.whenReady().then(() => {
  copyPresetsToUserData();
  buildMenu();
  createWindow();

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

