/**
 * Shared IPC channel name constants used by both main and renderer processes.
 * Centralising them here prevents typos and makes refactoring easy.
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
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];
