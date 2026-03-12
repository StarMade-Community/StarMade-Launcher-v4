import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from './ipc-channels';

/**
 * Typed IPC bridge exposed to the renderer as `window.launcher`.
 *
 * Only a minimal, explicitly typed surface is exposed so the renderer cannot
 * call arbitrary Node APIs (context isolation is enforced).
 */
const launcherApi = {
  window: {
    minimize: () => ipcRenderer.send(IPC.WINDOW_MINIMIZE),
    maximize: () => ipcRenderer.send(IPC.WINDOW_MAXIMIZE),
    close: () => ipcRenderer.send(IPC.WINDOW_CLOSE),
    onMaximizedChanged: (cb: (isMaximized: boolean) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, value: boolean) =>
        cb(value);
      ipcRenderer.on(IPC.WINDOW_MAXIMIZED_CHANGED, listener);
      // Return a cleanup function the caller can use to unsubscribe
      return () => ipcRenderer.removeListener(IPC.WINDOW_MAXIMIZED_CHANGED, listener);
    },
  },
  store: {
    get: (key: string): Promise<unknown> => ipcRenderer.invoke(IPC.STORE_GET, key),
    set: (key: string, value: unknown): Promise<void> => ipcRenderer.invoke(IPC.STORE_SET, key, value),
    delete: (key: string): Promise<void> => ipcRenderer.invoke(IPC.STORE_DELETE, key),
  },
};

export type LauncherApi = typeof launcherApi;

contextBridge.exposeInMainWorld('launcher', launcherApi);
