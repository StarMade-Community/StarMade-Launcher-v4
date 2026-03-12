import type { Version, DownloadProgress } from './index';

declare global {
  interface Window {
    /** IPC bridge exposed by the Electron preload script. Undefined in plain browser environments. */
    launcher: {
      /** App-level APIs */
      app: {
        /** Returns the Electron userData directory path. */
        getUserDataPath: () => Promise<string>;
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
        }) => Promise<{ success: boolean; pid?: number; error?: string }>;
        /** Stop a running game or server. */
        stop: (installationId: string) => Promise<{ success: boolean }>;
        /** Check if a game/server is running. */
        status: (installationId: string) => Promise<{ running: boolean; pid?: number; uptime?: number }>;
        /** Get all running games/servers. */
        listRunning: () => Promise<Array<{ installationId: string; pid?: number; isServer: boolean; uptime: number }>>;
        /** Get log file path for a running game. */
        getLogPath: (installationId: string) => Promise<string | null>;
        /** Open log directory in file manager. */
        openLogLocation: (installationPath: string) => Promise<{ success: boolean }>;
        /** Get GraphicsInfo.txt content if it exists. */
        getGraphicsInfo: (installationPath: string) => Promise<string | null>;
        /** Subscribe to game log events. Returns a cleanup function. */
        onLog: (cb: (data: { installationId: string; level: string; message: string }) => void) => () => void;
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
    };
  }
}

export {};


