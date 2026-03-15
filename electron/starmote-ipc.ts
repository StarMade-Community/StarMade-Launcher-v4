import { IPC } from './ipc-channels.js';
import {
  StarmoteSessionManager,
  type SocketLike,
  type StarmoteConnectionStatus,
  type StarmoteRuntimeEvent,
} from './starmote-session-manager.js';
import { logStarmoteDebug } from './starmote-debug.js';

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

interface StarmoteAdminCommandPayload {
  version: number;
  serverId: string;
  command: string;
}

interface RegisterStarmoteIpcOptions {
  ipcMain: IpcMainLike;
  getAllWindows: () => BrowserWindowLike[];
  createSocket: () => SocketLike;
  adminCommandPassword?: string;
}

export function registerStarmoteIpcHandlers(options: RegisterStarmoteIpcOptions): void {
  const { ipcMain, getAllWindows, createSocket, adminCommandPassword } = options;
  logStarmoteDebug('ipc.registered');

  const broadcastStarmoteStatus = (status: StarmoteConnectionStatus): void => {
    for (const window of getAllWindows()) {
      if (window.isDestroyed()) continue;
      window.webContents.send(IPC.STARMOTE_STATUS_CHANGED, status);
    }
  };

  const broadcastRuntimeEvent = (event: StarmoteRuntimeEvent): void => {
    for (const window of getAllWindows()) {
      if (window.isDestroyed()) continue;
      window.webContents.send(IPC.STARMOTE_RUNTIME_EVENT, event);
    }
  };

  const manager = new StarmoteSessionManager({
    createSocket,
    onStatusChanged: broadcastStarmoteStatus,
    onRuntimeEvent: broadcastRuntimeEvent,
    adminCommandPassword,
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
        logStarmoteDebug('ipc.connect.invalid_payload', {
          serverId,
          host,
          hasValidPort: Number.isInteger(port) && port >= 1 && port <= 65535,
        });
        return { success: false, error: 'serverId, host, and a valid port are required.' };
      }

      logStarmoteDebug('ipc.connect.request', {
        serverId,
        host,
        port,
        username,
      });
      return manager.connect({ serverId, host, port, username });
    },
  );

  ipcMain.handle(
    IPC.STARMOTE_DISCONNECT,
    (_event, payloadRaw): { success: boolean; status?: StarmoteConnectionStatus; error?: string } => {
      const payload = (payloadRaw ?? {}) as StarmoteDisconnectPayload;
      const serverId = payload?.serverId?.trim();
      if (!serverId) {
        logStarmoteDebug('ipc.disconnect.invalid_payload');
        return { success: false, error: 'serverId is required.' };
      }

      logStarmoteDebug('ipc.disconnect.request', { serverId });
      const status = manager.disconnect(serverId);
      return { success: true, status };
    },
  );

  ipcMain.handle(
    IPC.STARMOTE_STATUS,
    (_event, payloadRaw): { statuses: StarmoteConnectionStatus[] } => {
      const payload = (payloadRaw ?? {}) as StarmoteStatusPayload;
      const requestedId = payload?.serverId?.trim();
      logStarmoteDebug('ipc.status.request', { serverId: requestedId ?? null });
      if (requestedId) {
        return { statuses: [manager.getStatusFor(requestedId)] };
      }

      return { statuses: manager.getStatuses() };
    },
  );

  ipcMain.handle(
    IPC.STARMOTE_SEND_ADMIN_COMMAND,
    async (
      _event,
      payloadRaw,
    ): Promise<{ success: boolean; status?: StarmoteConnectionStatus; error?: string; reasonCode?: string }> => {
      const payload = (payloadRaw ?? {}) as Partial<StarmoteAdminCommandPayload>;
      const version = Number.isFinite(payload?.version) ? Math.trunc(payload.version as number) : Number.NaN;
      const serverId = payload?.serverId?.trim();
      const command = payload?.command?.trim();

      if (version !== 1) {
        return { success: false, error: 'Unsupported StarMote command payload version.' };
      }
      if (!serverId) {
        return { success: false, error: 'serverId is required.' };
      }
      if (!command) {
        return { success: false, error: 'command is required.' };
      }

      logStarmoteDebug('ipc.command.send', { serverId, version });
      return manager.sendAdminCommand({ serverId, command });
    },
  );
}

