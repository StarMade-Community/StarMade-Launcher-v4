/**
 * Shared IPC channel name constants used by both main and renderer processes.
 * Centralizing them here prevents typos and makes refactoring easy.
 */
export const IPC = {
  /** Renderer → Main: minimize the application window */
  WINDOW_MINIMIZE: 'window:minimize',
  /** Renderer → Main: toggle maximize / restore the application window */
  WINDOW_MAXIMIZE: 'window:maximize',
  /** Renderer → Main: close the application window */
  WINDOW_CLOSE: 'window:close',
  /** Main → Renderer: whether the window is currently maximized */
  WINDOW_MAXIMIZED_CHANGED: 'window:maximized-changed',

  /** Renderer → Main: get a value from the persistent JSON store */
  STORE_GET: 'store:get',
  /** Renderer → Main: set a value in the persistent JSON store */
  STORE_SET: 'store:set',
  /** Renderer → Main: delete a key from the persistent JSON store */
  STORE_DELETE: 'store:delete',

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
  /** Renderer → Main (invoke): open log directory in file manager. */
  GAME_OPEN_LOG_LOCATION: 'game:open-log-location',
  /** Renderer → Main (invoke): get GraphicsInfo.txt content if it exists. */
  GAME_GET_GRAPHICS_INFO: 'game:get-graphics-info',

  // ─── Dialog ─────────────────────────────────────────────────────────────────
  
  /** Renderer → Main (invoke): open folder picker dialog. */
  DIALOG_OPEN_FOLDER: 'dialog:open-folder',
  /** Renderer → Main (invoke): open file picker dialog. Returns selected path or null. */
  DIALOG_OPEN_FILE: 'dialog:open-file',

  // ─── App ────────────────────────────────────────────────────────────────────

  /** Renderer → Main (invoke): get the app userData directory path. */
  APP_GET_USER_DATA: 'app:get-user-data',

  // ─── Shell ──────────────────────────────────────────────────────────────────

  /** Renderer → Main (invoke): open a path in the native file manager. */
  SHELL_OPEN_PATH: 'shell:open-path',

  // ─── Backgrounds ────────────────────────────────────────────────────────────

  /** Renderer → Main (invoke): list available background image paths. */
  BACKGROUNDS_LIST: 'backgrounds:list',

  // ─── Icons ──────────────────────────────────────────────────────────────────

  /** Renderer → Main (invoke): list available icon image paths. */
  ICONS_LIST: 'icons:list',

  // ─── Legacy installation detection ──────────────────────────────────────────

  /** Renderer → Main (invoke): scan current and sub-directories for legacy StarMade installs (StarMade.jar). */
  LEGACY_SCAN: 'legacy:scan',
  /** Renderer → Main (invoke): scan a specific folder for legacy StarMade installs. */
  LEGACY_SCAN_FOLDER: 'legacy:scan-folder',
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];


