import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from './ipc-channels.js';
import { isStarmoteRolloutEnabled } from './starmote-feature-flag.js';

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
      ipcRenderer.invoke(IPC.APP_GET_USER_DATA), /** Returns total system RAM in MB. */
    getSystemMemory: (): Promise<number> =>
      ipcRenderer.invoke(IPC.APP_GET_SYSTEM_MEMORY),
    /** Returns the server panel schema JSON used to drive config editor metadata. */
    getServerPanelSchema: (): Promise<unknown> =>
      ipcRenderer.invoke(IPC.APP_GET_SERVER_PANEL_SCHEMA),
  },

  licenses: {
    /** List bundled third-party license files. */
    list: (): Promise<Array<{ fileName: string; sizeBytes: number; modifiedMs: number }>> =>
      ipcRenderer.invoke(IPC.LICENSES_LIST),
    /** Read one bundled third-party license file by file name. */
    read: (fileName: string): Promise<{ content: string; error?: string }> =>
      ipcRenderer.invoke(IPC.LICENSES_READ, fileName),
    /** Copy bundled third-party license files to userData. */
    copyToUserData: (): Promise<{ success: boolean; copiedCount: number; destinationDir?: string; error?: string }> =>
      ipcRenderer.invoke(IPC.LICENSES_COPY_TO_USER_DATA),
  },

  window: {
    minimize: () => ipcRenderer.send(IPC.WINDOW_MINIMIZE),
    hide: () => ipcRenderer.send(IPC.WINDOW_HIDE),
    maximize: () => ipcRenderer.send(IPC.WINDOW_MAXIMIZE),
    close:    () => ipcRenderer.send(IPC.WINDOW_CLOSE),
    openServerPanel: (serverId?: string, serverName?: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC.WINDOW_OPEN_SERVER_PANEL, { serverId, serverName }),
    onMaximizedChanged: (cb: (isMaximized: boolean) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, value: boolean) => cb(value);
      ipcRenderer.on(IPC.WINDOW_MAXIMIZED_CHANGED, listener);
      return () => ipcRenderer.removeListener(IPC.WINDOW_MAXIMIZED_CHANGED, listener);
    },
  },

  store: {
    get:      (key: string): Promise<unknown>  => ipcRenderer.invoke(IPC.STORE_GET, key),
    set:      (key: string, value: unknown): Promise<void> => ipcRenderer.invoke(IPC.STORE_SET, key, value),
    delete:   (key: string): Promise<void>     => ipcRenderer.invoke(IPC.STORE_DELETE, key),
    /** Wipe all persisted data and restart the launcher. */
    clearAll: (): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke(IPC.STORE_CLEAR_ALL),
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
      ipcRenderer.invoke(IPC.JAVA_GET_DEFAULT_PATHS), /** Find the java executable inside a given folder (JRE/JDK root). */
    findExecutable: (folderPath: string): Promise<string> =>
      ipcRenderer.invoke(IPC.JAVA_FIND_EXECUTABLE, folderPath),
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
      activeAccountId?: string;
      /** Server address for `-uplink` (direct connect to a world/server). */
      uplink?: string;
      /** Port for the `-uplink` server. */
      uplinkPort?: number;
      /** Mod IDs to pass as a comma-separated list after the `-uplink` port. */
      modIds?: string[];
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

    /** Get tracked play-time totals (ms) keyed by installation id. */
    getPlayTimeTotals: (installationIds?: string[]): Promise<{ byInstallationId: Record<string, number>; totalMs: number }> =>
      ipcRenderer.invoke(IPC.GAME_GET_PLAY_TIME_TOTALS, installationIds),

    /** Get log file path for a running game. */
    getLogPath: (installationId: string): Promise<string | null> =>
      ipcRenderer.invoke(IPC.GAME_GET_LOG_PATH, installationId),

    /** List categorized log files from an installation's logs folder. */
    listLogFiles: (installationPath: string): Promise<{
      categories: Array<{
        id: string;
        label: string;
        files: Array<{
          fileName: string;
          relativePath: string;
          sizeBytes: number;
          modifiedMs: number;
          categoryId: string;
          categoryLabel: string;
        }>;
      }>;
      defaultRelativePath: string | null;
    }> => ipcRenderer.invoke(IPC.GAME_LIST_LOG_FILES, installationPath),

    /** Read the tail of one log file from an installation's logs folder. */
    readLogFile: (installationPath: string, relativePath: string, maxBytes?: number): Promise<{
      content: string;
      truncated: boolean;
      error?: string;
    }> => ipcRenderer.invoke(IPC.GAME_READ_LOG_FILE, installationPath, relativePath, maxBytes),

    /** Open log directory in file manager. */
    openLogLocation: (installationPath: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke(IPC.GAME_OPEN_LOG_LOCATION, installationPath),

    /** Delete all files in an installation's logs folder. */
    clearLogFiles: (installationPath: string): Promise<{ success: boolean; deletedCount: number; error?: string }> =>
      ipcRenderer.invoke(IPC.GAME_CLEAR_LOG_FILES, installationPath),

    /** Get GraphicsInfo.txt content if it exists. */
    getGraphicsInfo: (installationPath: string): Promise<string | null> =>
      ipcRenderer.invoke(IPC.GAME_GET_GRAPHICS_INFO, installationPath),

    /** Read a value from server.cfg by key (e.g. MAX_CLIENTS). */
    readServerConfigValue: (installationPath: string, key: string): Promise<string | null> =>
      ipcRenderer.invoke(IPC.GAME_SERVER_CFG_GET, installationPath, key),

    /** List parsed key/value entries from server.cfg. */
    listServerConfigValues: (installationPath: string): Promise<Array<{ key: string; value: string; comment: string | null }>> =>
      ipcRenderer.invoke(IPC.GAME_SERVER_CFG_LIST, installationPath),

    /** Set a value in server.cfg by key (e.g. MAX_CLIENTS). */
    writeServerConfigValue: (installationPath: string, key: string, value: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC.GAME_SERVER_CFG_SET, installationPath, key, value),

    /** Read installation GameConfig.xml file content. */
    readGameConfigXml: (installationPath: string): Promise<string | null> =>
      ipcRenderer.invoke(IPC.GAME_CONFIG_XML_GET, installationPath),

    /** Write installation GameConfig.xml file content. */
    writeGameConfigXml: (installationPath: string, xmlContent: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC.GAME_CONFIG_XML_SET, installationPath, xmlContent),

    /** List entries in an installation directory (relative path). */
    listInstallationFiles: (installationPath: string, relativeDir?: string): Promise<Array<{
      name: string;
      relativePath: string;
      isDirectory: boolean;
      sizeBytes: number;
      modifiedMs: number;
      isEditableText: boolean;
      nonEditableReason?: string;
    }>> => ipcRenderer.invoke(IPC.GAME_FILES_LIST, installationPath, relativeDir),

    /** Read a text file from an installation directory. */
    readInstallationFile: (installationPath: string, relativePath: string): Promise<{ content: string; error?: string }> =>
      ipcRenderer.invoke(IPC.GAME_FILE_READ, installationPath, relativePath),

    /** Write a text file in an installation directory. */
    writeInstallationFile: (installationPath: string, relativePath: string, content: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC.GAME_FILE_WRITE, installationPath, relativePath, content),

    /** Rename a file/directory in an installation directory. */
    renameInstallationPath: (
      installationPath: string,
      relativePath: string,
      nextName: string,
    ): Promise<{ success: boolean; oldRelativePath?: string; newRelativePath?: string; error?: string }> =>
      ipcRenderer.invoke(IPC.GAME_FILE_RENAME, installationPath, relativePath, nextName),

    /** Copy a file/directory into a destination directory in an installation. */
    copyInstallationPath: (
      installationPath: string,
      sourceRelativePath: string,
      destinationDir: string,
    ): Promise<{ success: boolean; sourceRelativePath?: string; destinationRelativePath?: string; error?: string }> =>
      ipcRenderer.invoke(IPC.GAME_FILE_COPY, installationPath, sourceRelativePath, destinationDir),

    /** Move a file/directory into a destination directory in an installation. */
    moveInstallationPath: (
      installationPath: string,
      sourceRelativePath: string,
      destinationDir: string,
    ): Promise<{ success: boolean; sourceRelativePath?: string; destinationRelativePath?: string; error?: string }> =>
      ipcRenderer.invoke(IPC.GAME_FILE_MOVE, installationPath, sourceRelativePath, destinationDir),

    /** Delete a file/directory from an installation. */
    deleteInstallationPath: (
      installationPath: string,
      relativePath: string,
    ): Promise<{ success: boolean; deletedRelativePath?: string; error?: string }> =>
      ipcRenderer.invoke(IPC.GAME_FILE_DELETE, installationPath, relativePath),

    /**
     * Read the `launcher-session.json` file written by the game into the
     * installation directory.  Returns the parsed object or `null` when the
     * file does not exist or cannot be read.
     */
    readSession: (installationPath: string): Promise<{
      sessionType: 'singleplayer' | 'multiplayer';
      serverAddress: string;
      serverPort: number;
      modIds?: string[];
      timestamp: string;
    } | null> => ipcRenderer.invoke(IPC.GAME_READ_SESSION, installationPath),

    /** Subscribe to game log events. Returns a cleanup function. */
    onLog: (cb: (data: { installationId: string; level: string; message: string }) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: { installationId: string; level: string; message: string }) => cb(data);
      ipcRenderer.on(IPC.GAME_LOG, listener);
      return () => ipcRenderer.removeListener(IPC.GAME_LOG, listener);
    },

    /**
     * Send a line of text to a running server's stdin (console input).
     * Used to submit admin commands such as server_message_broadcast.
     */
    sendServerCommand: (installationId: string, line: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC.GAME_SERVER_STDIN, installationId, line),

    /** List chat log files from an installation's chatlogs directory. */
    listChatFiles: (installationPath: string): Promise<Array<{
      fileName: string;
      channelId: string;
      channelLabel: string;
      channelType: 'general' | 'faction' | 'direct' | 'custom';
      sizeBytes: number;
      modifiedMs: number;
    }>> => ipcRenderer.invoke(IPC.GAME_LIST_CHAT_FILES, installationPath),

    /** Read the tail of a chat log file from the chatlogs directory. */
    readChatFile: (installationPath: string, fileName: string, maxBytes?: number): Promise<{
      content: string;
      truncated: boolean;
      error?: string;
    }> => ipcRenderer.invoke(IPC.GAME_READ_CHAT_FILE, installationPath, fileName, maxBytes),

    /** Subscribe to live chat message events from a running server. Returns a cleanup function. */
    onChatMessage: (cb: (data: {
      installationId: string;
      sender: string;
      receiverType: string;
      receiver: string;
      text: string;
      timestamp: string;
    }) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: {
        installationId: string;
        sender: string;
        receiverType: string;
        receiver: string;
        text: string;
        timestamp: string;
      }) => cb(data);
      ipcRenderer.on(IPC.GAME_CHAT_MESSAGE, listener);
      return () => ipcRenderer.removeListener(IPC.GAME_CHAT_MESSAGE, listener);
    },
  },

 // ─── StarMote remote connection ────────────────────────────────────────────

  ...(isStarmoteRolloutEnabled() ? {
  starmote: {
    /** Open a remote StarMote TCP session for a server profile. */
    connect: (payload: {
      serverId: string;
      host: string;
      port: number;
      username?: string;
    }): Promise<{
      success: boolean;
      status?: {
        serverId: string;
        connected: boolean;
        state?: 'idle' | 'connecting' | 'connected' | 'authenticating' | 'ready' | 'error';
        isReady?: boolean;
        host?: string;
        port?: number;
        username?: string;
        connectedAt?: string;
        error?: string;
        reasonCode?: 'connected' | 'authenticating' | 'ready' | 'auth_failed' | 'timeout' | 'connect_failed' | 'socket_error' | 'protocol_timeout' | 'registry_unavailable' | 'not_ready' | 'invalid_command' | 'send_failed' | 'closed' | 'disconnected' | 'replaced';
      };
      error?: string;
    }> => ipcRenderer.invoke(IPC.STARMOTE_CONNECT, payload),

    /** Close an active remote StarMote session for a server profile. */
    disconnect: (serverId: string): Promise<{
      success: boolean;
      status?: {
        serverId: string;
        connected: boolean;
        state?: 'idle' | 'connecting' | 'connected' | 'authenticating' | 'ready' | 'error';
        isReady?: boolean;
        host?: string;
        port?: number;
        username?: string;
        connectedAt?: string;
        error?: string;
        reasonCode?: 'connected' | 'authenticating' | 'ready' | 'auth_failed' | 'timeout' | 'connect_failed' | 'socket_error' | 'protocol_timeout' | 'registry_unavailable' | 'not_ready' | 'invalid_command' | 'send_failed' | 'closed' | 'disconnected' | 'replaced';
      };
      error?: string;
    }> => ipcRenderer.invoke(IPC.STARMOTE_DISCONNECT, { serverId }),

    /** Send a versioned admin command through a protocol-ready StarMote session. */
    sendAdminCommand: (payload: {
      version: 1;
      serverId: string;
      command: string;
    }): Promise<{
      success: boolean;
      status?: {
        serverId: string;
        connected: boolean;
        state?: 'idle' | 'connecting' | 'connected' | 'authenticating' | 'ready' | 'error';
        isReady?: boolean;
        host?: string;
        port?: number;
        username?: string;
        connectedAt?: string;
        error?: string;
        reasonCode?: 'connected' | 'authenticating' | 'ready' | 'auth_failed' | 'timeout' | 'connect_failed' | 'socket_error' | 'protocol_timeout' | 'registry_unavailable' | 'not_ready' | 'invalid_command' | 'send_failed' | 'closed' | 'disconnected' | 'replaced';
      };
      error?: string;
      reasonCode?: 'connected' | 'authenticating' | 'ready' | 'auth_failed' | 'timeout' | 'connect_failed' | 'socket_error' | 'protocol_timeout' | 'registry_unavailable' | 'not_ready' | 'invalid_command' | 'send_failed' | 'closed' | 'disconnected' | 'replaced';
    }> => ipcRenderer.invoke(IPC.STARMOTE_SEND_ADMIN_COMMAND, payload),

    /** Fetch current StarMote connection status for one profile or all profiles. */
    getStatus: (serverId?: string): Promise<{
      statuses: Array<{
        serverId: string;
        connected: boolean;
        state?: 'idle' | 'connecting' | 'connected' | 'authenticating' | 'ready' | 'error';
        isReady?: boolean;
        host?: string;
        port?: number;
        username?: string;
        connectedAt?: string;
        error?: string;
        reasonCode?: 'connected' | 'authenticating' | 'ready' | 'auth_failed' | 'timeout' | 'connect_failed' | 'socket_error' | 'protocol_timeout' | 'registry_unavailable' | 'not_ready' | 'invalid_command' | 'send_failed' | 'closed' | 'disconnected' | 'replaced';
      }>;
    }> => ipcRenderer.invoke(IPC.STARMOTE_STATUS, { serverId }),

    /** Subscribe to StarMote connection status changes. Returns a cleanup function. */
    onStatusChanged: (cb: (status: {
      serverId: string;
      connected: boolean;
      state?: 'idle' | 'connecting' | 'connected' | 'authenticating' | 'ready' | 'error';
      isReady?: boolean;
      host?: string;
      port?: number;
      username?: string;
      connectedAt?: string;
      error?: string;
      reasonCode?: 'connected' | 'authenticating' | 'ready' | 'auth_failed' | 'timeout' | 'connect_failed' | 'socket_error' | 'protocol_timeout' | 'registry_unavailable' | 'not_ready' | 'invalid_command' | 'send_failed' | 'closed' | 'disconnected' | 'replaced';
    }) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, status: {
        serverId: string;
        connected: boolean;
        state?: 'idle' | 'connecting' | 'connected' | 'authenticating' | 'ready' | 'error';
        isReady?: boolean;
        host?: string;
        port?: number;
        username?: string;
        connectedAt?: string;
        error?: string;
        reasonCode?: 'connected' | 'authenticating' | 'ready' | 'auth_failed' | 'timeout' | 'connect_failed' | 'socket_error' | 'protocol_timeout' | 'registry_unavailable' | 'not_ready' | 'invalid_command' | 'send_failed' | 'closed' | 'disconnected' | 'replaced';
      }) => cb(status);
      ipcRenderer.on(IPC.STARMOTE_STATUS_CHANGED, listener);
      return () => ipcRenderer.removeListener(IPC.STARMOTE_STATUS_CHANGED, listener);
    },

    /** Subscribe to normalized runtime line events from StarMote sessions. */
    onRuntimeEvent: (cb: (event: {
      version: 1;
      serverId: string;
      line: string;
      source: 'framed-packet' | 'text-fallback';
      commandId?: number;
    }) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: {
        version: 1;
        serverId: string;
        line: string;
        source: 'framed-packet' | 'text-fallback';
        commandId?: number;
      }) => cb(payload);
      ipcRenderer.on(IPC.STARMOTE_RUNTIME_EVENT, listener);
      return () => ipcRenderer.removeListener(IPC.STARMOTE_RUNTIME_EVENT, listener);
    },
  },
  } : {}),

  /** Dialog APIs (folder picker, etc.) */
  dialog: {
    /** Open folder picker dialog. Returns selected path or null if canceled. */
    openFolder: (defaultPath?: string): Promise<string | null> =>
      ipcRenderer.invoke(IPC.DIALOG_OPEN_FOLDER, defaultPath),
    /** Open file picker dialog. Returns selected path or null if canceled. */
    openFile: (defaultPath?: string, type?: 'image' | 'java' | 'modpack'): Promise<string | null> =>
      ipcRenderer.invoke(IPC.DIALOG_OPEN_FILE, defaultPath, type),
  },

  /** Shell APIs */
  shell: {
    /** Open a path in the native file manager. */
    openPath: (targetPath: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC.SHELL_OPEN_PATH, targetPath),
    /** Open a URL in the system default browser (http/https only). */
    openExternal: (url: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC.SHELL_OPEN_EXTERNAL, url),
  },

  /** Installation file management APIs */
  installation: {
    /**
     * Recursively delete the physical files at the given path.
     * Returns { success: true } when the directory was removed (or was already
     * absent), or { success: false, error } on failure.
     */
    deleteFiles: (targetPath: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC.INSTALLATION_DELETE_FILES, targetPath),

    /**
     * Create a compressed (.zip) backup of the installation directory.
     * Returns { success: true, backupPath } on success or { success: false, error } on failure.
     */
    backup: (
      installationPath: string,
      installationId: string,
      installationName: string,
    ): Promise<{ success: boolean; backupPath?: string; error?: string }> =>
      ipcRenderer.invoke(IPC.INSTALLATION_BACKUP, { installationPath, installationId, installationName }),

    /**
     * Restore an installation from a compressed backup.
     * Returns { success: true } or { success: false, error }.
     */
    restore: (
      backupPath: string,
      targetPath: string,
    ): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC.INSTALLATION_RESTORE, { backupPath, targetPath }),

    /**
     * List available backups for an installation (newest first).
     * Returns an array of backup descriptors.
     */
    listBackups: (
      installationId: string,
    ): Promise<Array<{ name: string; path: string; createdAt: string; sizeBytes: number }>> =>
      ipcRenderer.invoke(IPC.INSTALLATION_LIST_BACKUPS, installationId),
  },

  /** Background image APIs */
  backgrounds: {
    /** List available background image paths (file:// URLs). */
    list: (): Promise<string[]> =>
      ipcRenderer.invoke(IPC.BACKGROUNDS_LIST),
    /** Returns a pinned launcher background URL, if configured. */
    getPreferred: (): Promise<string | null> =>
      ipcRenderer.invoke(IPC.BACKGROUNDS_GET_PREFERRED),
  },

  /** Icon image APIs */
  icons: {
    /** List available icon image paths (file:// URLs). */
    list: (): Promise<string[]> =>
      ipcRenderer.invoke(IPC.ICONS_LIST),
    /** Import a custom icon into the user icons folder. */
    import: (sourcePath: string): Promise<{ success: boolean; path?: string; error?: string }> =>
      ipcRenderer.invoke(IPC.ICONS_IMPORT, sourcePath),
  },

  /** Screenshot management APIs */
  screenshots: {
    /** List PNG screenshots from an installation's screenshots folder. */
    list: (installationPath: string): Promise<{
      screenshotsDir: string;
      screenshots: Array<{
        name: string;
        path: string;
        fileUrl: string;
        sizeBytes: number;
        modifiedMs: number;
        width: number;
        height: number;
      }>;
    }> => ipcRenderer.invoke(IPC.SCREENSHOTS_LIST, installationPath),

    /** Copy a screenshot image into the system clipboard. */
    copyToClipboard: (installationPath: string, screenshotPath: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC.SCREENSHOTS_COPY_TO_CLIPBOARD, installationPath, screenshotPath),

    /** Open the screenshot's containing folder in the native file manager. */
    openContainingFolder: (installationPath: string, screenshotPath: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC.SCREENSHOTS_OPEN_CONTAINING_FOLDER, installationPath, screenshotPath),

    /** Delete a screenshot file from the installation screenshots folder. */
    delete: (installationPath: string, screenshotPath: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC.SCREENSHOTS_DELETE, installationPath, screenshotPath),

    /** Set a screenshot as the launcher's preferred background image. */
    setAsLauncherBackground: (installationPath: string, screenshotPath: string): Promise<{ success: boolean; url?: string; error?: string }> =>
      ipcRenderer.invoke(IPC.SCREENSHOTS_SET_AS_LAUNCHER_BACKGROUND, installationPath, screenshotPath),

    /** Copy a screenshot to an installation loading-screens folder. */
    setAsLoadingScreen: (
      sourceInstallationPath: string,
      screenshotPath: string,
      targetInstallationPath?: string,
    ): Promise<{ success: boolean; destinationPath?: string; error?: string }> =>
      ipcRenderer.invoke(
        IPC.SCREENSHOTS_SET_AS_LOADING_SCREEN,
        sourceInstallationPath,
        screenshotPath,
        targetInstallationPath,
      ),
  },

  /** Mods management APIs */
  mods: {
    /** List mod jars from the installation's mods directory. */
    list: (installationPath: string): Promise<{
      modsDir: string;
      mods: Array<{
        fileName: string;
        absolutePath: string;
        relativePath: string;
        sizeBytes: number;
        modifiedMs: number;
        enabled: boolean;
        downloadUrl?: string;
        resourceId?: number;
        smdVersion?: string;
      }>;
    }> => ipcRenderer.invoke(IPC.MODS_LIST, installationPath),

    /** Browse StarMade Dock StarLoader mods. */
    listSmdMods: (searchQuery?: string): Promise<{
      success: boolean;
      mods: Array<{
        resourceId: number;
        name: string;
        author: string;
        tagLine?: string;
        gameVersion?: string;
        downloadCount: number;
        ratingAverage: number;
        latestVersion?: string;
      }>;
      error?: string;
    }> => ipcRenderer.invoke(IPC.MODS_SMD_LIST, searchQuery),

    /** Install or update an SMD mod by resource id. */
    installOrUpdateFromSmd: (
      installationPath: string,
      resourceId: number,
      enabled = true,
    ): Promise<{
      success: boolean;
      mod?: {
        fileName: string;
        absolutePath: string;
        relativePath: string;
        sizeBytes: number;
        modifiedMs: number;
        enabled: boolean;
        downloadUrl?: string;
        resourceId?: number;
        smdVersion?: string;
      };
      error?: string;
    }> => ipcRenderer.invoke(IPC.MODS_SMD_INSTALL_OR_UPDATE, installationPath, resourceId, enabled),

    /** Check installed SMD mods for newer versions. */
    checkSmdUpdates: (installed: Array<{ resourceId: number; smdVersion: string }>): Promise<{
      success: boolean;
      updates: Array<{
        resourceId: number;
        currentVersion: string;
        latestVersion?: string;
        hasUpdate: boolean;
        error?: string;
      }>;
      error?: string;
    }> => ipcRenderer.invoke(IPC.MODS_SMD_CHECK_UPDATES, installed),

    /** Remove a mod jar from an installation. */
    remove: (installationPath: string, relativePath: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC.MODS_REMOVE, installationPath, relativePath),

    /** Deprecated: StarMade manages mod enable/disable state in-game. */
    setEnabled: (
      installationPath: string,
      relativePath: string,
      enabled: boolean,
    ): Promise<{ success: boolean; relativePath?: string; error?: string }> =>
      ipcRenderer.invoke(IPC.MODS_SET_ENABLED, installationPath, relativePath, enabled),

    /** Export a link-only modpack manifest JSON. */
    exportModpack: (
      installationPath: string,
      outputPath: string,
      options?: { name?: string; sourceInstallation?: { id?: string; name?: string; version?: string } },
    ): Promise<{ success: boolean; outputPath?: string; exportedCount?: number; skippedCount?: number; error?: string }> =>
      ipcRenderer.invoke(IPC.MODS_EXPORT_MODPACK, installationPath, outputPath, options),

    /** Import a modpack manifest and download all listed mods. */
    importModpack: (
      installationPath: string,
      manifestPath: string,
    ): Promise<{
      success: boolean;
      downloadedCount?: number;
      skippedCount?: number;
      failedCount?: number;
      failures?: string[];
      error?: string;
    }> => ipcRenderer.invoke(IPC.MODS_IMPORT_MODPACK, installationPath, manifestPath),
  },

  /** Legacy installation detection APIs */
  legacy: {
    /** Scan the current and sub-directories for legacy StarMade installations (containing StarMade.jar). */
    scan: (): Promise<string[]> =>
      ipcRenderer.invoke(IPC.LEGACY_SCAN),

    /** Scan a specific folder (and its sub-directories) for legacy StarMade installations. */
    scanFolder: (folderPath: string): Promise<string[]> =>
      ipcRenderer.invoke(IPC.LEGACY_SCAN_FOLDER, folderPath),

    /** Read and parse the version from a legacy install's version.txt. Returns the version string or null. */
    readVersion: (installPath: string): Promise<string | null> =>
      ipcRenderer.invoke(IPC.LEGACY_READ_VERSION, installPath),

    /**
     * Subscribe to first-startup legacy scan results pushed by the main process.
     * Returns a cleanup function.
     */
    onScanResult: (cb: (paths: string[]) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, paths: string[]) => cb(paths);
      ipcRenderer.on(IPC.LEGACY_SCAN_RESULT, listener);
      return () => ipcRenderer.removeListener(IPC.LEGACY_SCAN_RESULT, listener);
    },
  },

  /** Account authentication APIs */
  auth: {
    /**
     * Authenticate with the StarMade registry (ROPC flow).
     * Credentials are processed in the main process; the renderer only receives
     * a safe summary (accountId, username, expiresIn) — never the raw token.
     */
    login: (username: string, password: string): Promise<{
      success: boolean;
      accountId?: string;
      username?: string;
      uuid?: string;
      expiresIn?: number;
      error?: string;
    }> => ipcRenderer.invoke(IPC.AUTH_LOGIN, { username, password }),

    /** Log out an account and clear its stored tokens. */
    logout: (accountId: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke(IPC.AUTH_LOGOUT, { accountId }),

    /** Refresh the access token for an account. */
    refresh: (accountId: string): Promise<{
      success: boolean;
      accountId?: string;
      username?: string;
      expiresIn?: number;
      error?: string;
    }> => ipcRenderer.invoke(IPC.AUTH_REFRESH, { accountId }),

    /** Register a new StarMade registry account. */
    register: (
      username: string,
      email: string,
      password: string,
      subscribeToNewsletter: boolean,
    ): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC.AUTH_REGISTER, { username, email, password, subscribeToNewsletter }),

    /**
     * Get the current auth status for an account without a network call.
     * Returns { authenticated, expired }.
     */
    getStatus: (accountId: string): Promise<{ authenticated: boolean; expired: boolean }> =>
      ipcRenderer.invoke(IPC.AUTH_GET_STATUS, { accountId }),
  },

  /** Launcher auto-updater APIs */
  updater: {
    /** Get the current running launcher version string (e.g. "4.0.0"). */
    getVersion: (): Promise<string> =>
      ipcRenderer.invoke(IPC.UPDATER_GET_VERSION),

    /**
     * Manually trigger an update check against GitHub releases.
     * Pass `includePreReleases: true` to include pre-release versions.
     * Resolves with update info (available, latestVersion, etc.).
     */
    checkForUpdates: (options?: { includePreReleases?: boolean }): Promise<{
      available: boolean;
      latestVersion: string;
      currentVersion: string;
      releaseNotes: string;
      downloadUrl: string;
      assetUrl?: string;
      assetName?: string;
      isPreRelease?: boolean;
    }> => ipcRenderer.invoke(IPC.UPDATER_CHECK, options),

    /**
     * Download the update asset. Returns the local installer path on success.
     * Progress events arrive via onDownloadProgress.
     */
    downloadUpdate: (
      assetUrl: string,
      assetName: string,
    ): Promise<{ success: boolean; installerPath?: string; error?: string }> =>
      ipcRenderer.invoke(IPC.UPDATER_DOWNLOAD, { assetUrl, assetName }),

    /**
     * Run the downloaded installer and quit the launcher.
     * Falls back to opening the releases page in the browser if installation fails.
     */
    installUpdate: (
      installerPath: string,
    ): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC.UPDATER_INSTALL, { installerPath }),

    /** Open the GitHub releases page in the default browser. */
    openReleasesPage: (): Promise<void> =>
      ipcRenderer.invoke(IPC.UPDATER_OPEN_RELEASES_PAGE),

    /** Subscribe to live download-progress events. Returns a cleanup function. */
    onDownloadProgress: (
      cb: (progress: { bytesReceived: number; totalBytes: number; percent: number }) => void,
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        progress: { bytesReceived: number; totalBytes: number; percent: number },
      ) => cb(progress);
      ipcRenderer.on(IPC.UPDATER_DOWNLOAD_PROGRESS, listener);
      return () => ipcRenderer.removeListener(IPC.UPDATER_DOWNLOAD_PROGRESS, listener);
    },

    /**
     * Subscribe to update-available events pushed by the main process on
     * startup.  Returns a cleanup function.
     */
    onUpdateAvailable: (cb: (info: {
      available: boolean;
      latestVersion: string;
      currentVersion: string;
      releaseNotes: string;
      downloadUrl: string;
      assetUrl?: string;
      assetName?: string;
      isPreRelease?: boolean;
    }) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, info: {
        available: boolean;
        latestVersion: string;
        currentVersion: string;
        releaseNotes: string;
        downloadUrl: string;
        assetUrl?: string;
        assetName?: string;
        isPreRelease?: boolean;
      }) => cb(info);
      ipcRenderer.on(IPC.UPDATER_UPDATE_AVAILABLE, listener);
      return () => ipcRenderer.removeListener(IPC.UPDATER_UPDATE_AVAILABLE, listener);
    },
  },

  /** Launcher data backup / restore APIs */
  backup: {
    /**
     * Create a timestamped backup of the launcher userData directory.
     * Returns the path to the backup on success.
     */
    create: (): Promise<{ success: boolean; backupPath?: string; error?: string }> =>
      ipcRenderer.invoke(IPC.BACKUP_CREATE),

    /**
     * List available backups, newest first.
     * Each entry has `name`, `path`, and `date`.
     */
    list: (): Promise<Array<{ name: string; path: string; date: string }>> =>
      ipcRenderer.invoke(IPC.BACKUP_LIST),

    /**
     * Restore a backup from the given path and restart the launcher.
     * The app will relaunch automatically on success.
     */
    restore: (backupPath: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC.BACKUP_RESTORE, { backupPath }),
  },
};

export type LauncherApi = typeof launcherApi;

contextBridge.exposeInMainWorld('launcher', launcherApi);


