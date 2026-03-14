/**
 * Shared IPC channel name constants used by both main and renderer processes.
 * Centralizing them here prevents typos and makes refactoring easy.
 */
export const IPC = {
  /** Renderer → Main: minimize the application window */
  WINDOW_MINIMIZE: 'window:minimize',
  /** Renderer → Main: hide the application window without quitting the app */
  WINDOW_HIDE: 'window:hide',
  /** Renderer → Main: toggle maximize / restore the application window */
  WINDOW_MAXIMIZE: 'window:maximize',
  /** Renderer → Main: close the application window */
  WINDOW_CLOSE: 'window:close',
  /** Renderer → Main (invoke): open the Server Panel in a dedicated pop-out window. */
  WINDOW_OPEN_SERVER_PANEL: 'window:open-server-panel',
  /** Main → Renderer: whether the window is currently maximized */
  WINDOW_MAXIMIZED_CHANGED: 'window:maximized-changed',

  /** Renderer → Main: get a value from the persistent JSON store */
  STORE_GET: 'store:get',
  /** Renderer → Main: set a value in the persistent JSON store */
  STORE_SET: 'store:set',
  /** Renderer → Main: delete a key from the persistent JSON store */
  STORE_DELETE: 'store:delete',
  /**
   * Renderer → Main (invoke): clear all persisted store data and restart the
   * launcher.  This is the "factory reset" / "clear all client data" action.
   * Returns: { success: boolean; error?: string }
   */
  STORE_CLEAR_ALL: 'store:clear-all',

  // ─── Phase 3: Version manifest ────────────────────────────────────────────

  /** Renderer → Main (invoke): fetch all available versions from the StarMade CDN. Returns Version[]. */
  VERSIONS_FETCH: 'versions:fetch',

  // ─── Phase 3: Game download ───────────────────────────────────────────────

  /** Renderer → Main (invoke): start downloading game files for an installation. */
  DOWNLOAD_START: 'download:start',
  /** Renderer → Main (invoke): cancel an in-progress download. */
  DOWNLOAD_CANCEL: 'download:cancel',
  /** Main → Renderer: live download progress update. */
  DOWNLOAD_PROGRESS: 'download:progress',
  /** Main → Renderer: download completed successfully. */
  DOWNLOAD_COMPLETE: 'download:complete',
  /** Main → Renderer: download failed with an error. */
  DOWNLOAD_ERROR: 'download:error',

  // ─── Phase 4: Java management ─────────────────────────────────────────────

  /** Renderer → Main (invoke): list all detected Java runtimes (bundled + system). */
  JAVA_LIST: 'java:list',
  /** Renderer → Main (invoke): download and install a Java runtime (8 or 25). */
  JAVA_DOWNLOAD: 'java:download',
  /** Renderer → Main (invoke): scan for system-installed Java versions. */
  JAVA_DETECT: 'java:detect',
  /** Renderer → Main (invoke): get default Java paths for jre8 and jre25. */
  JAVA_GET_DEFAULT_PATHS: 'java:get-default-paths',
  /** Renderer → Main (invoke): find a Java executable inside a given folder. */
  JAVA_FIND_EXECUTABLE: 'java:find-executable',

  // ─── Phase 5: Game launching ──────────────────────────────────────────────

  /** Renderer → Main (invoke): launch a game or server. */
  GAME_LAUNCH: 'game:launch',
  /** Renderer → Main (invoke): stop a running game or server. */
  GAME_STOP: 'game:stop',
  /** Renderer → Main (invoke): check if a game/server is running. */
  GAME_STATUS: 'game:status',
  /** Renderer → Main (invoke): get all running games/servers. */
  GAME_LIST_RUNNING: 'game:list-running',
  /** Main → Renderer: game log output line. */
  GAME_LOG: 'game:log',
  /** Renderer → Main (invoke): get log file path for a running game. */
  GAME_GET_LOG_PATH: 'game:get-log-path',
  /** Renderer → Main (invoke): list categorized log files in an installation logs directory. */
  GAME_LIST_LOG_FILES: 'game:list-log-files',
  /** Renderer → Main (invoke): read the tail of a specific log file from an installation logs directory. */
  GAME_READ_LOG_FILE: 'game:read-log-file',
  /** Renderer → Main (invoke): open log directory in file manager. */
  GAME_OPEN_LOG_LOCATION: 'game:open-log-location',
  /** Renderer → Main (invoke): delete all files/directories inside an installation logs folder. */
  GAME_CLEAR_LOG_FILES: 'game:clear-log-files',
  /** Renderer → Main (invoke): get GraphicsInfo.txt content if it exists. */
  GAME_GET_GRAPHICS_INFO: 'game:get-graphics-info',

  // ─── Server chat ────────────────────────────────────────────────────────────

  /**
   * Renderer → Main (invoke): send a line of text to a running server's stdin.
   * Payload: { installationId: string; line: string }
   * Returns: { success: boolean; error?: string }
   */
  GAME_SERVER_STDIN: 'game:server-stdin',

  /** Main → Renderer: live parsed chat message from a running server. */
  GAME_CHAT_MESSAGE: 'game:chat-message',

  /**
   * Renderer → Main (invoke): list chat log files from an installation's
   * chatlogs directory.
   * Payload: installationPath: string
   * Returns: ChatFileInfo[]
   */
  GAME_LIST_CHAT_FILES: 'game:list-chat-files',

  /**
   * Renderer → Main (invoke): read a chat log file from the chatlogs directory.
   * Payload: installationPath: string, fileName: string, maxBytes?: number
   * Returns: { content: string; truncated: boolean; error?: string }
   */
  GAME_READ_CHAT_FILE: 'game:read-chat-file',
  /** Renderer → Main (invoke): read a key from installation server.cfg. */
  GAME_SERVER_CFG_GET: 'game:server-cfg-get',
  /** Renderer → Main (invoke): list parsed key/value entries from installation server.cfg. */
  GAME_SERVER_CFG_LIST: 'game:server-cfg-list',
  /** Renderer → Main (invoke): set a key in installation server.cfg. */
  GAME_SERVER_CFG_SET: 'game:server-cfg-set',
  /** Renderer → Main (invoke): read installation GameConfig.xml content. */
  GAME_CONFIG_XML_GET: 'game:config-xml-get',
  /** Renderer → Main (invoke): write installation GameConfig.xml content. */
  GAME_CONFIG_XML_SET: 'game:config-xml-set',
  /** Renderer → Main (invoke): list files/directories inside an installation path. */
  GAME_FILES_LIST: 'game:files-list',
  /** Renderer → Main (invoke): read a text file from an installation path. */
  GAME_FILE_READ: 'game:file-read',
  /** Renderer → Main (invoke): write a text file to an installation path. */
  GAME_FILE_WRITE: 'game:file-write',
  /**
   * Renderer → Main (invoke): read the `launcher-session.json` file written by
   * the game into an installation directory.  Returns the parsed object or
   * `null` if the file does not exist or cannot be parsed.
   */
  GAME_READ_SESSION: 'game:read-session',

  // ─── Dialog ─────────────────────────────────────────────────────────────────
  
  /** Renderer → Main (invoke): open folder picker dialog. */
  DIALOG_OPEN_FOLDER: 'dialog:open-folder',
  /** Renderer → Main (invoke): open file picker dialog. Returns selected path or null. */
  DIALOG_OPEN_FILE: 'dialog:open-file',

  // ─── App ────────────────────────────────────────────────────────────────────

  /** Renderer → Main (invoke): get the app userData directory path. */
  APP_GET_USER_DATA: 'app:get-user-data',
  /** Renderer → Main (invoke): get total system RAM in MB. */
  APP_GET_SYSTEM_MEMORY: 'app:get-system-memory',
  /** Renderer → Main (invoke): get server panel schema JSON used by config editors. */
  APP_GET_SERVER_PANEL_SCHEMA: 'app:get-server-panel-schema',

  // ─── Installation file management ───────────────────────────────────────────

  /**
   * Renderer → Main (invoke): recursively delete the physical files for an
   * installation or server at the given path.
   * Payload: targetPath: string
   * Returns: { success: boolean; error?: string }
   */
  INSTALLATION_DELETE_FILES: 'installation:delete-files',

  /**
   * Renderer → Main (invoke): create a compressed (.zip) backup of an
   * installation directory.
   * Payload: { installationPath: string; installationId: string; installationName: string }
   * Returns: { success: boolean; backupPath?: string; error?: string }
   */
  INSTALLATION_BACKUP: 'installation:backup',

  /**
   * Renderer → Main (invoke): restore an installation from a compressed backup.
   * Payload: { backupPath: string; targetPath: string }
   * Returns: { success: boolean; error?: string }
   */
  INSTALLATION_RESTORE: 'installation:restore',

  /**
   * Renderer → Main (invoke): list available backups for an installation.
   * Payload: installationId: string
   * Returns: Array<{ name: string; path: string; createdAt: string; sizeBytes: number }>
   */
  INSTALLATION_LIST_BACKUPS: 'installation:list-backups',

  // ─── Shell ──────────────────────────────────────────────────────────────────

  /** Renderer → Main (invoke): open a path in the native file manager. */
  SHELL_OPEN_PATH: 'shell:open-path',
  /** Renderer → Main (invoke): open a URL in the system default browser. */
  SHELL_OPEN_EXTERNAL: 'shell:open-external',

  // ─── Backgrounds ────────────────────────────────────────────────────────────

  /** Renderer → Main (invoke): list available background image paths. */
  BACKGROUNDS_LIST: 'backgrounds:list',

  // ─── Icons ──────────────────────────────────────────────────────────────────

  /** Renderer → Main (invoke): list available icon image paths. */
  ICONS_LIST: 'icons:list',
  /** Renderer → Main (invoke): import an icon image into the user icons directory. */
  ICONS_IMPORT: 'icons:import',

  // ─── Legacy installation detection ──────────────────────────────────────────

  /** Renderer → Main (invoke): scan current and sub-directories for legacy StarMade installs (StarMade.jar). */
  LEGACY_SCAN: 'legacy:scan',
  /** Renderer → Main (invoke): scan a specific folder for legacy StarMade installs. */
  LEGACY_SCAN_FOLDER: 'legacy:scan-folder',
  /** Renderer → Main (invoke): read and parse the version from a legacy install's version.txt. Returns the version string or null. */
  LEGACY_READ_VERSION: 'legacy:read-version',
  /** Main → Renderer: first-startup background legacy scan completed; payload is the array of found paths. */
  LEGACY_SCAN_RESULT: 'legacy:scan-result',

  // ─── Launcher auto-updater ───────────────────────────────────────────────────

  /**
   * Renderer → Main (invoke): check GitHub releases for a newer launcher version.
   * Payload: { includePreReleases?: boolean }
   */
  UPDATER_CHECK: 'updater:check',
  /** Renderer → Main (invoke): get the current running launcher version string. */
  UPDATER_GET_VERSION: 'updater:get-version',
  /** Main → Renderer: a newer launcher version was found during the startup check. */
  UPDATER_UPDATE_AVAILABLE: 'updater:update-available',

  // ─── Launcher data backup ────────────────────────────────────────────────────

  /**
   * Renderer → Main (invoke): create a timestamped backup of the launcher
   * userData directory.
   * Returns: { success: boolean; backupPath?: string; error?: string }
   */
  BACKUP_CREATE: 'backup:create',

  /**
   * Renderer → Main (invoke): list available backups (newest first).
   * Returns: Array<{ name: string; path: string; date: string }>
   */
  BACKUP_LIST: 'backup:list',

  /**
   * Renderer → Main (invoke): restore a backup and restart the launcher.
   * Payload: { backupPath: string }
   * Returns: { success: boolean; error?: string }
   */
  BACKUP_RESTORE: 'backup:restore',
  /**
   * Renderer → Main (invoke): download the update asset.
   * Payload: { assetUrl: string; assetName: string }
   * Returns: { success: boolean; installerPath?: string; error?: string }
   * Progress is pushed via UPDATER_DOWNLOAD_PROGRESS.
   */
  UPDATER_DOWNLOAD: 'updater:download',
  /** Main → Renderer: live download progress for an update asset. */
  UPDATER_DOWNLOAD_PROGRESS: 'updater:download-progress',
  /**
   * Renderer → Main (invoke): run the downloaded installer and quit.
   * Payload: { installerPath: string }
   * Returns: { success: boolean; error?: string }
   * On success the app will quit; on failure the browser opens as fallback.
   */
  UPDATER_INSTALL: 'updater:install',
  /**
   * Renderer → Main (invoke): open the GitHub releases page in the browser.
   * Used as the explicit fallback when the user chooses "Open in Browser".
   */
  UPDATER_OPEN_RELEASES_PAGE: 'updater:open-releases-page',

  // ─── Account authentication ───────────────────────────────────────────────

  /**
   * Renderer → Main (invoke): authenticate with the StarMade registry.
   * Payload: { username: string; password: string }
   * Returns: LoginResult (see electron/auth.ts)
   */
  AUTH_LOGIN: 'auth:login',

  /**
   * Renderer → Main (invoke): log out / clear stored tokens for an account.
   * Payload: { accountId: string }
   * Returns: { success: true }
   */
  AUTH_LOGOUT: 'auth:logout',

  /**
   * Renderer → Main (invoke): refresh the access token for an account.
   * Payload: { accountId: string }
   * Returns: LoginResult
   */
  AUTH_REFRESH: 'auth:refresh',

  /**
   * Renderer → Main (invoke): register a new StarMade registry account.
   * Payload: { username: string; email: string; password: string; subscribeToNewsletter: boolean }
   * Returns: { success: boolean; error?: string }
   */
  AUTH_REGISTER: 'auth:register',

  /**
   * Renderer → Main (invoke): get the current auth status for an account (no network call).
   * Payload: { accountId: string }
   * Returns: { authenticated: boolean; expired: boolean }
   */
  AUTH_GET_STATUS: 'auth:get-status',
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];


