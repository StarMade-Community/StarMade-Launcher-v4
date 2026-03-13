import type { Version, DownloadProgress } from './index';

declare global {
  interface Window {
    /** IPC bridge exposed by the Electron preload script. Undefined in plain browser environments. */
    launcher: {
      /** App-level APIs */
      app: {
        /** Returns the Electron userData directory path. */
        getUserDataPath: () => Promise<string>;
        /** Returns total system RAM in MB. */
        getSystemMemory: () => Promise<number>;
      };

      window: {
        /** Minimize the application window */
        minimize: () => void;
        /** Toggle maximize / restore the application window */
        maximize: () => void;
        /** Close the application window */
        close: () => void;
        /**
         * Subscribe to maximized-state changes.
         * @returns A cleanup function that removes the listener when called.
         */
        onMaximizedChanged: (cb: (isMaximized: boolean) => void) => () => void;
      };

      /** Persistent JSON store — backed by a file in Electron's userData directory. */
      store: {
        /** Retrieve a top-level value by key. Resolves to `undefined` if the key does not exist. */
        get: (key: string) => Promise<unknown>;
        /** Persist a value under the given key. */
        set: (key: string, value: unknown) => Promise<void>;
        /** Remove a key from the store. */
        delete: (key: string) => Promise<void>;
      };

      /** Version manifest API — Phase 3. */
      versions: {
        /**
         * Fetch all available StarMade versions from the CDN build indexes.
         * @param invalidate  Pass `true` to bypass the in-process TTL cache.
         */
        fetch: (invalidate?: boolean) => Promise<Version[]>;
      };

      /** Game download API — Phase 3. */
      download: {
        /**
         * Start downloading game files for the given build path into `targetDir`.
         * Returns immediately; progress is delivered via `onProgress` / `onComplete` / `onError`.
         */
        start: (installationId: string, buildPath: string, targetDir: string) => Promise<{ started: boolean }>;
        /** Cancel an in-progress download. Safe to call when no download is running. */
        cancel: (installationId: string) => Promise<void>;
        /** Subscribe to live progress events. Returns a cleanup function. */
        onProgress: (cb: (progress: DownloadProgress) => void) => () => void;
        /** Subscribe to download-complete events. Returns a cleanup function. */
        onComplete: (cb: (payload: { installationId: string }) => void) => () => void;
        /** Subscribe to download-error events. Returns a cleanup function. */
        onError: (cb: (payload: { installationId: string; error: string }) => void) => () => void;
      };

      /** Java management API — Phase 4. */
      java: {
        /** List all detected Java runtimes (bundled + system). */
        list: () => Promise<{
          bundled: Array<{ version: string; path: string; source: string }>;
          system: Array<{ version: string; path: string; source: string }>;
        }>;
        /** Download and install a Java runtime (8 or 25). */
        download: (version: 8 | 25) => Promise<{ success: boolean; path?: string; error?: string }>;
        /** Scan for system-installed Java versions. */
        detect: () => Promise<Array<{ version: string; path: string; source: string }>>;
        /** Get default Java paths for jre8 and jre25. */
        getDefaultPaths: () => Promise<{ jre8Path: string; jre25Path: string }>;
        /** Find the java executable inside a given folder (JRE/JDK root). */
        findExecutable: (folderPath: string) => Promise<string>;
      };

      /** Game launching API — Phase 5. */
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
          /** Active account id — used to inject the registry auth token into the game process. */
          activeAccountId?: string;
          /** Server address for `-uplink` (direct connect to a world/server). */
          uplink?: string;
          /** Port for the `-uplink` server. */
          uplinkPort?: number;
          /** Mod IDs to pass as a comma-separated list after the `-uplink` port. */
          modIds?: string[];
        }) => Promise<{ success: boolean; pid?: number; error?: string }>;
        /** Stop a running game or server. */
        stop: (installationId: string) => Promise<{ success: boolean }>;
        /** Check if a game/server is running. */
        status: (installationId: string) => Promise<{ running: boolean; pid?: number; uptime?: number }>;
        /** Get all running games/servers. */
        listRunning: () => Promise<Array<{ installationId: string; pid?: number; isServer: boolean; uptime: number }>>;
        /** Get log file path for a running game. */
        getLogPath: (installationId: string) => Promise<string | null>;
        /** List categorized log files from an installation's logs folder. */
        listLogFiles: (installationPath: string) => Promise<{
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
        }>;
        /** Read the tail of one log file from an installation's logs folder. */
        readLogFile: (installationPath: string, relativePath: string, maxBytes?: number) => Promise<{
          content: string;
          truncated: boolean;
          error?: string;
        }>;
        /** Open log directory in file manager. */
        openLogLocation: (installationPath: string) => Promise<{ success: boolean }>;
        /** Get GraphicsInfo.txt content if it exists. */
        getGraphicsInfo: (installationPath: string) => Promise<string | null>;
        /** Read a value from server.cfg by key (e.g. MAX_CLIENTS). */
        readServerConfigValue: (installationPath: string, key: string) => Promise<string | null>;
        /** Set a value in server.cfg by key (e.g. MAX_CLIENTS). */
        writeServerConfigValue: (installationPath: string, key: string, value: string) => Promise<{ success: boolean; error?: string }>;
        /** Subscribe to game log events. Returns a cleanup function. */
        onLog: (cb: (data: { installationId: string; level: string; message: string }) => void) => () => void;
        /**
         * Read the `launcher-session.json` file written by the game into the
         * installation directory.  Returns the parsed object or `null` when the
         * file does not exist or cannot be read.
         */
        readSession: (installationPath: string) => Promise<{
          sessionType: 'singleplayer' | 'multiplayer';
          serverAddress: string;
          serverPort: number;
          modIds?: string[];
          timestamp: string;
        } | null>;
      };

      /** Dialog APIs */
      dialog: {
        /** Open folder picker dialog. Returns selected path or null if canceled. */
        openFolder: (defaultPath?: string) => Promise<string | null>;
        /** Open file picker dialog. Returns selected path or null if canceled. */
        openFile: (defaultPath?: string, type?: 'image') => Promise<string | null>;
      };

      /** Shell APIs */
      shell: {
        /** Open a path in the native file manager. */
        openPath: (targetPath: string) => Promise<{ success: boolean; error?: string }>;
        /** Open a URL in the system default browser (http/https only). */
        openExternal: (url: string) => Promise<{ success: boolean; error?: string }>;
      };

      /** Background image APIs */
      backgrounds: {
        /** List available background image paths (file:// URLs). */
        list: () => Promise<string[]>;
      };

      /** Icon image APIs */
      icons: {
        /** List available icon image paths (file:// URLs). */
        list: () => Promise<string[]>;
      };

      /** Account authentication APIs */
      auth: {
        /**
         * Authenticate with the StarMade registry.
         * Returns a safe summary — the raw token is held only in the main process.
         */
        login: (username: string, password: string) => Promise<{
          success: boolean;
          accountId?: string;
          username?: string;
          uuid?: string;
          expiresIn?: number;
          error?: string;
        }>;
        /** Log out an account and clear its stored tokens. */
        logout: (accountId: string) => Promise<{ success: boolean }>;
        /** Refresh the access token for an account. */
        refresh: (accountId: string) => Promise<{
          success: boolean;
          accountId?: string;
          username?: string;
          expiresIn?: number;
          error?: string;
        }>;
        /** Register a new StarMade registry account. */
        register: (
          username: string,
          email: string,
          password: string,
          subscribeToNewsletter: boolean,
        ) => Promise<{ success: boolean; error?: string }>;
        /**
         * Get the current auth status for an account without a network call.
         */
        getStatus: (accountId: string) => Promise<{ authenticated: boolean; expired: boolean }>;
      };

      /** Legacy installation detection APIs */
      legacy: {
        /** Scan the current and sub-directories for legacy StarMade installations (containing StarMade.jar). */
        scan: () => Promise<string[]>;
        /** Scan a specific folder (and its sub-directories) for legacy StarMade installations. */
        scanFolder: (folderPath: string) => Promise<string[]>;
        /** Read and parse the version from a legacy install's version.txt. Returns the version string or null. */
        readVersion: (installPath: string) => Promise<string | null>;
        /**
         * Subscribe to first-startup legacy scan results pushed by the main process.
         * Returns a cleanup function.
         */
        onScanResult: (cb: (paths: string[]) => void) => (() => void);
      };

      /** Launcher auto-updater APIs */
      updater: {
        /** Get the current running launcher version string (e.g. "4.0.0"). */
        getVersion: () => Promise<string>;
        /**
         * Manually trigger an update check against GitHub releases.
         * Resolves with update info (available, latestVersion, etc.).
         */
        checkForUpdates: () => Promise<{
          available: boolean;
          latestVersion: string;
          currentVersion: string;
          releaseNotes: string;
          downloadUrl: string;
          /** Direct download URL for the platform installer asset, if available. */
          assetUrl?: string;
          /** Filename of the installer asset. */
          assetName?: string;
        }>;
        /**
         * Download the update installer asset.
         * Progress events arrive via onDownloadProgress.
         * Resolves with the local path to the downloaded file on success.
         */
        downloadUpdate: (
          assetUrl: string,
          assetName: string,
        ) => Promise<{ success: boolean; installerPath?: string; error?: string }>;
        /**
         * Execute the downloaded installer and quit the launcher.
         * Falls back to opening the releases page in the browser on failure.
         */
        installUpdate: (
          installerPath: string,
        ) => Promise<{ success: boolean; error?: string }>;
        /** Open the GitHub releases page in the default browser. */
        openReleasesPage: () => Promise<void>;
        /** Subscribe to live download-progress events. Returns a cleanup function. */
        onDownloadProgress: (
          cb: (progress: { bytesReceived: number; totalBytes: number; percent: number }) => void,
        ) => () => void;
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
        }) => void) => () => void;
      };
    };
  }
}

export {};


