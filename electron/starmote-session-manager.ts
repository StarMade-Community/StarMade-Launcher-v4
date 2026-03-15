import { logStarmoteDebug } from './starmote-debug.js';

export interface SocketLike {
  setNoDelay(noDelay?: boolean): void;
  setTimeout(timeout: number): void;
  once(event: 'connect' | 'timeout' | 'error' | 'close', listener: (...args: unknown[]) => void): this;
  on(event: 'error' | 'close', listener: (...args: unknown[]) => void): this;
  connect(port: number, host: string): void;
  removeAllListeners(): this;
  destroy(): void;
}

export type StarmoteSessionState = 'idle' | 'connecting' | 'connected' | 'error';
export type StarmoteReasonCode =
  | 'connected'
  | 'timeout'
  | 'connect_failed'
  | 'socket_error'
  | 'closed'
  | 'disconnected'
  | 'replaced';

export interface StarmoteConnectionStatus {
  serverId: string;
  connected: boolean;
  state: StarmoteSessionState;
  host?: string;
  port?: number;
  username?: string;
  connectedAt?: string;
  error?: string;
  reasonCode?: StarmoteReasonCode;
}

export interface StarmoteConnectParams {
  serverId: string;
  host: string;
  port: number;
  username?: string;
}

interface StarmoteSessionRecord {
  serverId: string;
  host?: string;
  port?: number;
  username?: string;
  socket?: SocketLike;
  connectedAt?: number;
  state: StarmoteSessionState;
  error?: string;
  reasonCode?: StarmoteReasonCode;
  generation: number;
}

interface StarmoteSessionManagerOptions {
  createSocket: () => SocketLike;
  onStatusChanged?: (status: StarmoteConnectionStatus) => void;
}

function formatSocketError(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in (error as Record<string, unknown>)) {
    return String((error as { message?: unknown }).message);
  }
  return String(error);
}

export class StarmoteSessionManager {
  private readonly createSocket: () => SocketLike;
  private readonly onStatusChanged?: (status: StarmoteConnectionStatus) => void;
  private readonly sessions = new Map<string, StarmoteSessionRecord>();

  constructor(options: StarmoteSessionManagerOptions) {
    this.createSocket = options.createSocket;
    this.onStatusChanged = options.onStatusChanged;
  }

  getStatusFor(serverId: string): StarmoteConnectionStatus {
    const session = this.sessions.get(serverId);
    if (!session) {
      return {
        serverId,
        connected: false,
        state: 'idle',
      };
    }

    return {
      serverId,
      connected: session.state === 'connected',
      state: session.state,
      host: session.host,
      port: session.port,
      username: session.username,
      connectedAt: session.connectedAt ? new Date(session.connectedAt).toISOString() : undefined,
      error: session.error,
      reasonCode: session.reasonCode,
    };
  }

  getStatuses(): StarmoteConnectionStatus[] {
    return Array.from(this.sessions.keys()).map((serverId) => this.getStatusFor(serverId));
  }

  async connect(params: StarmoteConnectParams): Promise<{ success: boolean; status: StarmoteConnectionStatus; error?: string }> {
    logStarmoteDebug('session.connect.start', {
      serverId: params.serverId,
      host: params.host,
      port: params.port,
      username: params.username,
    });

    const previous = this.sessions.get(params.serverId);
    if (previous?.socket) {
      logStarmoteDebug('session.connect.replace_existing', { serverId: params.serverId });
      this.disconnect(params.serverId, false, 'replaced');
    }

    const generation = (previous?.generation ?? 0) + 1;
    const socket = this.createSocket();
    socket.setNoDelay(true);

    const session: StarmoteSessionRecord = {
      serverId: params.serverId,
      host: params.host,
      port: params.port,
      username: params.username,
      socket,
      state: 'connecting',
      generation,
    };
    this.sessions.set(params.serverId, session);
    this.emitStatus(params.serverId);

    const connectResult = await new Promise<{ success: true } | { success: false; error: string; reasonCode: StarmoteReasonCode }>((resolve) => {
      let settled = false;
      const finish = (result: { success: true } | { success: false; error: string; reasonCode: StarmoteReasonCode }) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };

      socket.setTimeout(7000);
      socket.once('connect', () => {
        socket.setTimeout(0);
        finish({ success: true });
      });
      socket.once('timeout', () => {
        finish({ success: false, error: `Connection timed out (${params.host}:${params.port}).`, reasonCode: 'timeout' });
      });
      socket.once('error', (error) => {
        finish({ success: false, error: `Connection failed: ${formatSocketError(error)}`, reasonCode: 'connect_failed' });
      });
      socket.once('close', () => {
        finish({ success: false, error: 'Connection cancelled before session was established.', reasonCode: 'disconnected' });
      });

      socket.connect(params.port, params.host);
    });

    const active = this.sessions.get(params.serverId);
    if (!active || active.generation !== generation) {
      logStarmoteDebug('session.connect.replaced_during_attempt', { serverId: params.serverId, generation });
      return {
        success: false,
        status: this.getStatusFor(params.serverId),
        error: 'Connection attempt was replaced by a newer session.',
      };
    }

    if (connectResult.success === false) {
      const { error, reasonCode } = connectResult;
      active.socket = undefined;
      active.connectedAt = undefined;
      active.state = reasonCode === 'disconnected' ? 'idle' : 'error';
      active.error = reasonCode === 'disconnected' ? undefined : error;
      active.reasonCode = reasonCode;
      try { socket.destroy(); } catch { /* ignore */ }
      this.emitStatus(params.serverId);
      logStarmoteDebug('session.connect.failed', {
        serverId: params.serverId,
        reasonCode,
        error,
      });
      return {
        success: false,
        error,
        status: this.getStatusFor(params.serverId),
      };
    }

    active.state = 'connected';
    active.connectedAt = Date.now();
    active.error = undefined;
    active.reasonCode = 'connected';
    active.socket = socket;

    socket.on('error', (error) => {
      const current = this.sessions.get(params.serverId);
      if (!current || current.generation !== generation) return;
      current.socket = undefined;
      current.connectedAt = undefined;
      current.state = 'error';
      current.error = `Connection error: ${formatSocketError(error)}`;
      current.reasonCode = 'socket_error';
      try {
        socket.removeAllListeners();
        socket.destroy();
      } catch {
        // Ignore teardown races.
      }
      this.emitStatus(params.serverId);
      logStarmoteDebug('session.socket.error', {
        serverId: params.serverId,
        reasonCode: current.reasonCode,
        error: current.error,
      });
    });

    socket.on('close', () => {
      const current = this.sessions.get(params.serverId);
      if (!current || current.generation !== generation) return;
      current.socket = undefined;
      current.connectedAt = undefined;
      if (current.state === 'connected') {
        current.state = 'idle';
        current.reasonCode = 'closed';
      }
      this.emitStatus(params.serverId);
      logStarmoteDebug('session.socket.closed', {
        serverId: params.serverId,
        reasonCode: current.reasonCode,
      });
    });

    this.emitStatus(params.serverId);
    logStarmoteDebug('session.connect.success', {
      serverId: params.serverId,
      host: params.host,
      port: params.port,
      username: params.username,
      state: active.state,
    });
    return {
      success: true,
      status: this.getStatusFor(params.serverId),
    };
  }

  disconnect(serverId: string, preserveError = true, reasonCode: StarmoteReasonCode = 'disconnected'): StarmoteConnectionStatus {
    const session = this.sessions.get(serverId);
    if (!session) {
      logStarmoteDebug('session.disconnect.missing', { serverId, reasonCode });
      return {
        serverId,
        connected: false,
        state: 'idle',
      };
    }

    const existingError = session.error;
    const hadSocket = !!session.socket;
    const socket = session.socket;
    const wasConnecting = session.state === 'connecting';

    session.socket = undefined;
    session.connectedAt = undefined;
    session.state = 'idle';
    session.reasonCode = reasonCode;
    session.error = preserveError && !hadSocket ? existingError : undefined;

    if (socket) {
      try {
        if (!wasConnecting) {
          socket.removeAllListeners();
        }
        socket.destroy();
      } catch {
        // Ignore teardown races.
      }
    }

    this.emitStatus(serverId);
    logStarmoteDebug('session.disconnect.done', {
      serverId,
      reasonCode,
      preserveError,
      hadSocket,
      wasConnecting,
    });
    return this.getStatusFor(serverId);
  }

  private emitStatus(serverId: string): void {
    this.onStatusChanged?.(this.getStatusFor(serverId));
  }
}

