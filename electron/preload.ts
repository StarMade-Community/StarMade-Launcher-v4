import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from './ipc-channels.js';

/**
 * Typed IPC bridge exposed to the renderer as `window.launcher`.
 *
 * Only a minimal, explicitly typed surface is exposed so the renderer cannot
 * call arbitrary Node APIs (context isolation is enforced).
 */
const launcherApi = {
  /** App-level APIs */
  app: {
    /** Returns the Electron userData directory path. */
    getUserDataPath: (): Promise<string> =>
      ipcRenderer.invoke(IPC.APP_GET_USER_DATA),
  },

  window: {
    minimize: () => ipcRenderer.send(IPC.WINDOW_MINIMIZE),
    maximize: () => ipcRenderer.send(IPC.WINDOW_MAXIMIZE),
    close:    () => ipcRenderer.send(IPC.WINDOW_CLOSE),
    onMaximizedChanged: (cb: (isMaximized: boolean) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, value: boolean) => cb(value);
      ipcRenderer.on(IPC.WINDOW_MAXIMIZED_CHANGED, listener);
      return () => ipcRenderer.removeListener(IPC.WINDOW_MAXIMIZED_CHANGED, listener);
    },
  },

  store: {
    get:    (key: string): Promise<unknown>  => ipcRenderer.invoke(IPC.STORE_GET, key),
    set:    (key: string, value: unknown): Promise<void> => ipcRenderer.invoke(IPC.STORE_SET, key, value),
    delete: (key: string): Promise<void>     => ipcRenderer.invoke(IPC.STORE_DELETE, key),
  },

  // ─── Phase 3: Version manifest ─────────────────────────────────────────────

  versions: {
    /**
     * Fetch all available StarMade versions from the CDN.
     * @param invalidate Pass true to bypass the server-side TTL cache.
     */
    fetch: (invalidate = false): Promise<unknown[]> =>
      ipcRenderer.invoke(IPC.VERSIONS_FETCH, { invalidate }),
  },

  // ─── Phase 3: Download ────────────────────────────────────────────────────

  download: {
    /** Begin downloading game files. Returns immediately; progress arrives via onProgress/onComplete/onError. */
    start: (installationId: string, buildPath: string, targetDir: string): Promise<{ started: boolean }> =>
      ipcRenderer.invoke(IPC.DOWNLOAD_START, installationId, buildPath, targetDir),

    /** Cancel an in-progress download. Safe to call even if no download is running. */
    cancel: (installationId: string): Promise<void> =>
      ipcRenderer.invoke(IPC.DOWNLOAD_CANCEL, installationId),

    /** Subscribe to live progress updates. Returns a cleanup function. */
    onProgress: (cb: (progress: unknown) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, p: unknown) => cb(p);
      ipcRenderer.on(IPC.DOWNLOAD_PROGRESS, listener);
      return () => ipcRenderer.removeListener(IPC.DOWNLOAD_PROGRESS, listener);
    },

    /** Subscribe to download-complete events. Returns a cleanup function. */
    onComplete: (cb: (payload: { installationId: string }) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: { installationId: string }) => cb(payload);
      ipcRenderer.on(IPC.DOWNLOAD_COMPLETE, listener);
      return () => ipcRenderer.removeListener(IPC.DOWNLOAD_COMPLETE, listener);
    },

    /** Subscribe to download-error events. Returns a cleanup function. */
    onError: (cb: (payload: { installationId: string; error: string }) => void): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: { installationId: string; error: string },
      ) => cb(payload);
      ipcRenderer.on(IPC.DOWNLOAD_ERROR, listener);
      return () => ipcRenderer.removeListener(IPC.DOWNLOAD_ERROR, listener);
    },
  },

  // ─── Phase 4: Java management ─────────────────────────────────────────────

  java: {
    /** List all detected Java runtimes (bundled + system). */
    list: (): Promise<{ 
      bundled: Array<{ version: string; path: string; source: string }>; 
      system: Array<{ version: string; path: string; source: string }>;
    }> => ipcRenderer.invoke(IPC.JAVA_LIST),

    /** Download and install a Java runtime (8 or 25). */
    download: (version: 8 | 25): Promise<{ success: boolean; path?: string; error?: string }> =>
      ipcRenderer.invoke(IPC.JAVA_DOWNLOAD, version),

    /** Scan for system-installed Java versions. */
    detect: (): Promise<Array<{ version: string; path: string; source: string }>> =>
      ipcRenderer.invoke(IPC.JAVA_DETECT),

    /** Get default Java paths for jre8 and jre25. */
    getDefaultPaths: (): Promise<{ jre8Path: string; jre25Path: string }> =>
      ipcRenderer.invoke(IPC.JAVA_GET_DEFAULT_PATHS),
  },

  // ─── Phase 5: Game launching ──────────────────────────────────────────────

  game: {
    /** Launch a game or server. */
    launch: (options: {
      installationId: string;
      installationPath: string;
      starMadeVersion: string;
      minMemory?: number;
      maxMemory?: number;
      jvmArgs?: string;
      customJavaPath?: string;
      isServer?: boolean;
      serverPort?: number;
    }): Promise<{ success: boolean; pid?: number; error?: string }> =>
      ipcRenderer.invoke(IPC.GAME_LAUNCH, options),

    /** Stop a running game or server. */
    stop: (installationId: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke(IPC.GAME_STOP, installationId),

    /** Check if a game/server is running. */
    status: (installationId: string): Promise<{ running: boolean; pid?: number; uptime?: number }> =>
      ipcRenderer.invoke(IPC.GAME_STATUS, installationId),

    /** Get all running games/servers. */
    listRunning: (): Promise<Array<{ installationId: string; pid?: number; isServer: boolean; uptime: number }>> =>
      ipcRenderer.invoke(IPC.GAME_LIST_RUNNING),

    /** Get log file path for a running game. */
    getLogPath: (installationId: string): Promise<string | null> =>
      ipcRenderer.invoke(IPC.GAME_GET_LOG_PATH, installationId),

    /** Open log directory in file manager. */
    openLogLocation: (installationPath: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke(IPC.GAME_OPEN_LOG_LOCATION, installationPath),

    /** Get GraphicsInfo.txt content if it exists. */
    getGraphicsInfo: (installationPath: string): Promise<string | null> =>
      ipcRenderer.invoke(IPC.GAME_GET_GRAPHICS_INFO, installationPath),

    /** Subscribe to game log events. Returns a cleanup function. */
    onLog: (cb: (data: { installationId: string; level: string; message: string }) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: { installationId: string; level: string; message: string }) => cb(data);
      ipcRenderer.on(IPC.GAME_LOG, listener);
      return () => ipcRenderer.removeListener(IPC.GAME_LOG, listener);
    },
  },

  /** Dialog APIs (folder picker, etc.) */
  dialog: {
    /** Open folder picker dialog. Returns selected path or null if canceled. */
    openFolder: (defaultPath?: string): Promise<string | null> =>
      ipcRenderer.invoke(IPC.DIALOG_OPEN_FOLDER, defaultPath),
    /** Open file picker dialog. Returns selected path or null if canceled. */
    openFile: (defaultPath?: string, type?: 'image'): Promise<string | null> =>
      ipcRenderer.invoke(IPC.DIALOG_OPEN_FILE, defaultPath, type),
  },

  /** Shell APIs */
  shell: {
    /** Open a path in the native file manager. */
    openPath: (targetPath: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC.SHELL_OPEN_PATH, targetPath),
  },

  /** Background image APIs */
  backgrounds: {
    /** List available background image paths (file:// URLs). */
    list: (): Promise<string[]> =>
      ipcRenderer.invoke(IPC.BACKGROUNDS_LIST),
  },

  /** Icon image APIs */
  icons: {
    /** List available icon image paths (file:// URLs). */
    list: (): Promise<string[]> =>
      ipcRenderer.invoke(IPC.ICONS_LIST),
  },
};

export type LauncherApi = typeof launcherApi;

contextBridge.exposeInMainWorld('launcher', launcherApi);


