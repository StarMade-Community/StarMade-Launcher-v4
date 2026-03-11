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
    };
  }
}

export {};
