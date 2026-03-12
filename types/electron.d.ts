declare global {
  interface Window {
    /** IPC bridge exposed by the Electron preload script. Undefined in plain browser environments. */
    launcher: {
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
    };
  }
}

export {};
