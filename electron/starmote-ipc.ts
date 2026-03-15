import { IPC } from './ipc-channels.js';
import {
  StarmoteSessionManager,
  type SocketLike,
  type StarmoteConnectionStatus,
} from './starmote-session-manager.js';

interface BrowserWindowLike {
  isDestroyed(): boolean;
  webContents: {
    send: (channel: string, payload: unknown) => void;
  };
}

interface IpcMainLike {
  handle: (channel: string, listener: (event: unknown, payload?: unknown) => unknown) => void;
}

interface StarmoteConnectPayload {
  serverId: string;
  host: string;
  port: number;
  username?: string;
}

interface StarmoteDisconnectPayload {
  serverId: string;
}

interface StarmoteStatusPayload {
  serverId?: string;
}

interface RegisterStarmoteIpcOptions {
  ipcMain: IpcMainLike;
  getAllWindows: () => BrowserWindowLike[];
  createSocket: () => SocketLike;
}

export function registerStarmoteIpcHandlers(options: RegisterStarmoteIpcOptions): void {
  const { ipcMain, getAllWindows, createSocket } = options;

  const broadcastStarmoteStatus = (status: StarmoteConnectionStatus): void => {
    for (const window of getAllWindows()) {
      if (window.isDestroyed()) continue;
      window.webContents.send(IPC.STARMOTE_STATUS_CHANGED, status);
    }
  };

  const manager = new StarmoteSessionManager({
    createSocket,
    onStatusChanged: broadcastStarmoteStatus,
  });

  ipcMain.handle(
    IPC.STARMOTE_CONNECT,
    async (
      _event,
      payloadRaw,
    ): Promise<{ success: boolean; status?: StarmoteConnectionStatus; error?: string }> => {
      const payload = (payloadRaw ?? {}) as StarmoteConnectPayload;
      const serverId = payload?.serverId?.trim();
      const host = payload?.host?.trim();
      const port = Number.isFinite(payload?.port) ? Math.trunc(payload.port) : Number.NaN;
      const username = payload?.username?.trim() || undefined;

      if (!serverId || !host || !Number.isInteger(port) || port < 1 || port > 65535) {
        return { success: false, error: 'serverId, host, and a valid port are required.' };
      }

      return manager.connect({ serverId, host, port, username });
    },
  );

  ipcMain.handle(
    IPC.STARMOTE_DISCONNECT,
    (_event, payloadRaw): { success: boolean; status?: StarmoteConnectionStatus; error?: string } => {
      const payload = (payloadRaw ?? {}) as StarmoteDisconnectPayload;
      const serverId = payload?.serverId?.trim();
      if (!serverId) {
        return { success: false, error: 'serverId is required.' };
      }

      const status = manager.disconnect(serverId);
      return { success: true, status };
    },
  );

  ipcMain.handle(
    IPC.STARMOTE_STATUS,
    (_event, payloadRaw): { statuses: StarmoteConnectionStatus[] } => {
      const payload = (payloadRaw ?? {}) as StarmoteStatusPayload;
      const requestedId = payload?.serverId?.trim();
      if (requestedId) {
        return { statuses: [manager.getStatusFor(requestedId)] };
      }

      return { statuses: manager.getStatuses() };
    },
  );
}

