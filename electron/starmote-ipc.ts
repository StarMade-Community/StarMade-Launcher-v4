// ─── Remote connection IPC router ────────────────────────────────────────────
//
// Registers the starmote:* IPC handlers and routes each call to the correct
// backend (StarMote or Azure VM) based on the `backend` field in the payload.

import { IPC } from './ipc-channels.js';
import {
  StarmoteSessionManager,
  type SocketLike,
  type StarmoteConnectionStatus,
  type StarmoteRuntimeEvent,
} from './starmote-session-manager.js';
import { AzureVmBackend } from './azure-vm-backend.js';
import { logStarmoteDebug } from './starmote-debug.js';
import type {
  RemoteBackendType,
  RemoteConnectionStatus,
  RemoteRuntimeEvent,
} from './remote-backend-types.js';

// ─── Interface types ──────────────────────────────────────────────────────────

interface BrowserWindowLike {
  isDestroyed(): boolean;
  webContents: {
    send: (channel: string, payload: unknown) => void;
  };
}

interface IpcMainLike {
  handle: (channel: string, listener: (event: unknown, payload?: unknown) => unknown) => void;
}

interface RemoteConnectPayload {
  serverId: string;
  host: string;
  port: number;
  backend?: RemoteBackendType;
  username?: string;
  clientVersion?: string;
  activeAccountId?: string;
  // Azure VM / SSH
  sshPort?: number;
  sshKeyPath?: string;
  sshPassword?: string;
}

interface RemoteDisconnectPayload {
  serverId: string;
}

interface RemoteStatusPayload {
  serverId?: string;
}

interface RemoteAdminCommandPayload {
  version: number;
  serverId: string;
  command: string;
}

export interface RegisterRemoteIpcOptions {
  ipcMain: IpcMainLike;
  getAllWindows: () => BrowserWindowLike[];
  createSocket: () => SocketLike;
  adminCommandPassword?: string;
  resolveAuthTokenForAccount?: (accountId: string) => Promise<string | null>;
  resolveUsernameForAccount?: (accountId: string) => Promise<string | null> | string | null;
  loginClientVersion?: string;
}

const USER_AGENT_STAR_MOTE_STANDALONE = 2;

// ─── Status normalization ─────────────────────────────────────────────────────

/** Attach the backend tag to a raw StarmoteConnectionStatus for the renderer. */
function tagStarmoteStatus(status: StarmoteConnectionStatus): RemoteConnectionStatus {
  return { ...status, backend: 'starmote' } as RemoteConnectionStatus;
}

// ─── Registration ─────────────────────────────────────────────────────────────

/** @deprecated Use registerRemoteIpcHandlers — kept for call-site compatibility. */
export const registerStarmoteIpcHandlers = registerRemoteIpcHandlers;

export function registerRemoteIpcHandlers(options: RegisterRemoteIpcOptions): void {
  const {
    ipcMain,
    getAllWindows,
    createSocket,
    adminCommandPassword,
    resolveAuthTokenForAccount,
    resolveUsernameForAccount,
    loginClientVersion,
  } = options;

  logStarmoteDebug('ipc.registered');

  // ── Broadcast helpers ────────────────────────────────────────────────────────

  const broadcastStatus = (status: RemoteConnectionStatus): void => {
    for (const win of getAllWindows()) {
      if (win.isDestroyed()) continue;
      win.webContents.send(IPC.STARMOTE_STATUS_CHANGED, status);
    }
  };

  const broadcastRuntimeEvent = (event: RemoteRuntimeEvent | StarmoteRuntimeEvent): void => {
    for (const win of getAllWindows()) {
      if (win.isDestroyed()) continue;
      win.webContents.send(IPC.STARMOTE_RUNTIME_EVENT, event);
    }
  };

  // ── Backend instances ─────────────────────────────────────────────────────

  const starmoteManager = new StarmoteSessionManager({
    createSocket,
    onStatusChanged: (status) => broadcastStatus(tagStarmoteStatus(status)),
    onRuntimeEvent: (event) => broadcastRuntimeEvent(event),
    adminCommandPassword,
    loginClientVersion,
    runAuthStage: async () => undefined,
  });

  const azureVmBackend = new AzureVmBackend({
    onStatusChanged: (status) => broadcastStatus(status),
    onRuntimeEvent: (event) => broadcastRuntimeEvent(event),
  });

  // Track which backend owns each serverId so disconnect / command can route correctly.
  const backendByServerId = new Map<string, RemoteBackendType>();

  // ── STARMOTE_CONNECT ──────────────────────────────────────────────────────

  ipcMain.handle(
    IPC.STARMOTE_CONNECT,
    async (_event, payloadRaw): Promise<{ success: boolean; status?: RemoteConnectionStatus; error?: string }> => {
      const payload = (payloadRaw ?? {}) as RemoteConnectPayload;
      const backend: RemoteBackendType = payload?.backend ?? 'starmote';
      const serverId = payload?.serverId?.trim();
      const host = payload?.host?.trim();
      const port = Number.isFinite(payload?.port) ? Math.trunc(payload.port) : Number.NaN;

      if (!serverId || !host || !Number.isInteger(port) || port < 1 || port > 65535) {
        logStarmoteDebug('ipc.connect.invalid_payload', { serverId, host, backend });
        return { success: false, error: 'serverId, host, and a valid port are required.' };
      }

      logStarmoteDebug('ipc.connect.request', { serverId, host, port, backend });

      // ── Azure VM path ──────────────────────────────────────────────────────
      if (backend === 'azure-vm') {
        const sshPort = payload?.sshPort ?? 22;
        const sshKeyPath = payload?.sshKeyPath?.trim() || undefined;
        const sshPassword = payload?.sshPassword || undefined;
        const username = payload?.username?.trim() || 'azureuser';

        const connectResult = await azureVmBackend.connect({
          serverId,
          backend: 'azure-vm',
          host,
          port,
          username,
          sshPort,
          sshKeyPath,
          sshPassword,
        });

        if (connectResult.success) {
          backendByServerId.set(serverId, 'azure-vm');
        }
        return connectResult;
      }

      // ── StarMote path (default) ────────────────────────────────────────────
      const clientVersion = payload?.clientVersion?.trim() || undefined;
      const activeAccountId = payload?.activeAccountId?.trim() || undefined;
      let username = payload?.username?.trim() || undefined;
      let authToken: string | undefined;

      if (!username && activeAccountId && resolveUsernameForAccount) {
        try {
          const resolved = await resolveUsernameForAccount(activeAccountId);
          username = resolved?.trim() || undefined;
        } catch (error) {
          logStarmoteDebug('ipc.connect.username_resolve_failed', { serverId, activeAccountId, error: String(error) });
        }
      }

      if (activeAccountId && resolveAuthTokenForAccount) {
        try {
          const resolved = await resolveAuthTokenForAccount(activeAccountId);
          authToken = resolved?.trim() || undefined;
        } catch (error) {
          logStarmoteDebug('ipc.connect.auth_token_resolve_failed', { serverId, activeAccountId, error: String(error) });
        }
      }

      const connectResult = await starmoteManager.connect({
        serverId,
        host,
        port,
        username,
        clientVersion,
        activeAccountId,
        authToken,
        userAgent: USER_AGENT_STAR_MOTE_STANDALONE,
      });

      if (connectResult.success) {
        backendByServerId.set(serverId, 'starmote');
      }

      // Attach backend tag to status before returning
      if (connectResult.status) {
        return { ...connectResult, status: tagStarmoteStatus(connectResult.status) };
      }
      return connectResult as { success: boolean; status?: RemoteConnectionStatus; error?: string };
    },
  );

  // ── STARMOTE_DISCONNECT ───────────────────────────────────────────────────

  ipcMain.handle(
    IPC.STARMOTE_DISCONNECT,
    (_event, payloadRaw): { success: boolean; status?: RemoteConnectionStatus; error?: string } => {
      const payload = (payloadRaw ?? {}) as RemoteDisconnectPayload;
      const serverId = payload?.serverId?.trim();
      if (!serverId) {
        logStarmoteDebug('ipc.disconnect.invalid_payload');
        return { success: false, error: 'serverId is required.' };
      }

      logStarmoteDebug('ipc.disconnect.request', { serverId });

      const backend = backendByServerId.get(serverId) ?? 'starmote';
      backendByServerId.delete(serverId);

      if (backend === 'azure-vm') {
        return azureVmBackend.disconnect(serverId);
      }

      const rawStatus = starmoteManager.disconnect(serverId);
      return {
        success: true,
        status: rawStatus ? tagStarmoteStatus(rawStatus) : undefined,
      };
    },
  );

  // ── STARMOTE_STATUS ───────────────────────────────────────────────────────

  ipcMain.handle(
    IPC.STARMOTE_STATUS,
    (_event, payloadRaw): { statuses: RemoteConnectionStatus[] } => {
      const payload = (payloadRaw ?? {}) as RemoteStatusPayload;
      const requestedId = payload?.serverId?.trim();
      logStarmoteDebug('ipc.status.request', { serverId: requestedId ?? null });

      const starmoteStatuses = requestedId
        ? [starmoteManager.getStatusFor(requestedId)]
        : starmoteManager.getStatuses();

      const azureStatuses = requestedId
        ? [azureVmBackend.getStatusFor(requestedId)]
        : azureVmBackend.getStatuses();

      // Deduplicate: if a serverId appears in both, prefer the connected one.
      const byId = new Map<string, RemoteConnectionStatus>();

      for (const s of starmoteStatuses) {
        byId.set(s.serverId, tagStarmoteStatus(s));
      }
      for (const s of azureStatuses) {
        const existing = byId.get(s.serverId);
        if (!existing || s.connected) byId.set(s.serverId, s);
      }

      return { statuses: Array.from(byId.values()) };
    },
  );

  // ── STARMOTE_SEND_ADMIN_COMMAND ───────────────────────────────────────────

  ipcMain.handle(
    IPC.STARMOTE_SEND_ADMIN_COMMAND,
    async (
      _event,
      payloadRaw,
    ): Promise<{ success: boolean; status?: RemoteConnectionStatus; error?: string; reasonCode?: string }> => {
      const payload = (payloadRaw ?? {}) as Partial<RemoteAdminCommandPayload>;
      const version = Number.isFinite(payload?.version) ? Math.trunc(payload.version as number) : Number.NaN;
      const serverId = payload?.serverId?.trim();
      const command = payload?.command?.trim();

      if (version !== 1) {
        return { success: false, error: 'Unsupported command payload version.' };
      }
      if (!serverId) return { success: false, error: 'serverId is required.' };
      if (!command) return { success: false, error: 'command is required.' };

      logStarmoteDebug('ipc.command.send', { serverId, version });

      const backend = backendByServerId.get(serverId) ?? 'starmote';

      if (backend === 'azure-vm') {
        return azureVmBackend.sendAdminCommand({ serverId, command });
      }

      const result = await starmoteManager.sendAdminCommand({ serverId, command });
      if (result.status) {
        return { ...result, status: tagStarmoteStatus(result.status) };
      }
      return result as { success: boolean; status?: RemoteConnectionStatus; error?: string; reasonCode?: string };
    },
  );
}
