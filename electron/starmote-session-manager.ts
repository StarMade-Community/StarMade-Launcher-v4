import { logStarmoteDebug } from './starmote-debug.js';
import { encodeAdminCommandPacket } from './starmote-protocol.js';

export interface SocketLike {
  setNoDelay(noDelay?: boolean): void;
  setTimeout(timeout: number): void;
  once(event: 'connect' | 'timeout' | 'error' | 'close', listener: (...args: unknown[]) => void): this;
  on(event: 'error' | 'close', listener: (...args: unknown[]) => void): this;
  removeListener(event: 'error' | 'close', listener: (...args: unknown[]) => void): this;
  connect(port: number, host: string): void;
  write(data: Uint8Array): boolean;
  removeAllListeners(): this;
  destroy(): void;
}

export type StarmoteSessionState = 'idle' | 'connecting' | 'connected' | 'authenticating' | 'ready' | 'error';
export type StarmoteReasonCode =
  | 'connected'
  | 'authenticating'
  | 'ready'
  | 'auth_failed'
  | 'timeout'
  | 'connect_failed'
  | 'socket_error'
  | 'protocol_timeout'
  | 'registry_unavailable'
  | 'not_ready'
  | 'invalid_command'
  | 'send_failed'
  | 'closed'
  | 'disconnected'
  | 'replaced';

export interface StarmoteConnectionStatus {
  serverId: string;
  connected: boolean;
  state: StarmoteSessionState;
  isReady?: boolean;
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
  commandRegistryReady: boolean;
  generation: number;
}

interface StarmoteSessionManagerOptions {
  createSocket: () => SocketLike;
  onStatusChanged?: (status: StarmoteConnectionStatus) => void;
  runAuthStage?: (params: StarmoteConnectParams) => Promise<void>;
  waitForCommandRegistry?: (params: StarmoteConnectParams, attempt: number) => Promise<void>;
  commandSendTimeoutMs?: number;
  handshakeTimeoutMs?: number;
  handshakeRetries?: number;
}

interface StarmoteSendAdminCommandParams {
  serverId: string;
  command: string;
}

type StarmoteSendAdminCommandResult = {
  success: boolean;
  status: StarmoteConnectionStatus;
  error?: string;
  reasonCode?: StarmoteReasonCode;
};

function formatSocketError(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in (error as Record<string, unknown>)) {
    return String((error as { message?: unknown }).message);
  }
  return String(error);
}

export class StarmoteSessionManager {
  private readonly createSocket: () => SocketLike;
  private readonly onStatusChanged?: (status: StarmoteConnectionStatus) => void;
  private readonly runAuthStage: (params: StarmoteConnectParams) => Promise<void>;
  private readonly waitForCommandRegistry: (params: StarmoteConnectParams, attempt: number) => Promise<void>;
  private readonly commandSendTimeoutMs: number;
  private readonly handshakeTimeoutMs: number;
  private readonly handshakeRetries: number;
  private readonly sessions = new Map<string, StarmoteSessionRecord>();

  constructor(options: StarmoteSessionManagerOptions) {
    this.createSocket = options.createSocket;
    this.onStatusChanged = options.onStatusChanged;
    this.runAuthStage = options.runAuthStage ?? (async () => undefined);
    this.waitForCommandRegistry = options.waitForCommandRegistry ?? (async () => undefined);
    this.commandSendTimeoutMs = Number.isFinite(options.commandSendTimeoutMs)
      ? Math.max(1000, Math.trunc(options.commandSendTimeoutMs as number))
      : 5000;
    this.handshakeTimeoutMs = Number.isFinite(options.handshakeTimeoutMs)
      ? Math.max(1000, Math.trunc(options.handshakeTimeoutMs as number))
      : 3000;
    this.handshakeRetries = Number.isFinite(options.handshakeRetries)
      ? Math.max(0, Math.trunc(options.handshakeRetries as number))
      : 1;
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
      connected: session.state === 'connected' || session.state === 'authenticating' || session.state === 'ready',
      state: session.state,
      isReady: session.state === 'ready',
      host: session.host,
      port: session.port,
      username: session.username,
      connectedAt: session.connectedAt ? new Date(session.connectedAt).toISOString() : undefined,
      error: session.error,
      reasonCode: session.reasonCode,
    };
  }

  async sendAdminCommand(params: StarmoteSendAdminCommandParams): Promise<StarmoteSendAdminCommandResult> {
    const serverId = params.serverId.trim();
    const command = params.command.trim();
    const session = this.sessions.get(serverId);

    if (!session || !session.socket || session.state !== 'ready' || !session.commandRegistryReady) {
      return {
        success: false,
        status: this.getStatusFor(serverId),
        error: 'Remote StarMote session is not protocol-ready yet.',
        reasonCode: 'not_ready',
      };
    }

    if (!command) {
      return {
        success: false,
        status: this.getStatusFor(serverId),
        error: 'Command text is required.',
        reasonCode: 'invalid_command',
      };
    }

    try {
      const packet = encodeAdminCommandPacket(command);
      await this.writePacketWithTimeout(session.socket, packet, this.commandSendTimeoutMs);
      logStarmoteDebug('session.command.sent', { serverId, bytes: packet.byteLength });
      return {
        success: true,
        status: this.getStatusFor(serverId),
      };
    } catch (error) {
      const errorText = `Failed to send admin command: ${formatSocketError(error)}`;
      logStarmoteDebug('session.command.send_failed', { serverId, error: errorText });
      return {
        success: false,
        status: this.getStatusFor(serverId),
        error: errorText,
        reasonCode: 'send_failed',
      };
    }
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
      commandRegistryReady: false,
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
    this.emitStatus(params.serverId);

    active.state = 'authenticating';
    active.reasonCode = 'authenticating';
    active.commandRegistryReady = false;
    this.emitStatus(params.serverId);

    try {
      await this.runAuthStage(params);

      const attempts = this.handshakeRetries + 1;
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        const ready = await this.runHandshakeAttempt(params, attempt);
        if (!ready) {
          continue;
        }
        if (active.generation !== generation) {
          throw new Error('Connection attempt was replaced by a newer session.');
        }
        active.commandRegistryReady = true;
        break;
      }
    } catch (error) {
      const errorText = formatSocketError(error);
      const isTimeout = /timed out/i.test(errorText);
      active.socket = undefined;
      active.connectedAt = undefined;
      active.state = 'error';
      active.error = isTimeout
        ? `Protocol handshake timed out: ${errorText}`
        : `Authentication/registry setup failed: ${errorText}`;
      active.reasonCode = isTimeout ? 'protocol_timeout' : 'registry_unavailable';
      active.commandRegistryReady = false;
      try {
        socket.removeAllListeners();
        socket.destroy();
      } catch {
        // Ignore teardown races.
      }
      this.emitStatus(params.serverId);
      logStarmoteDebug('session.connect.auth_failed', {
        serverId: params.serverId,
        error: active.error,
      });
      return {
        success: false,
        error: active.error,
        status: this.getStatusFor(params.serverId),
      };
    }

    active.state = 'ready';
    active.reasonCode = 'ready';

    socket.on('error', (error) => {
      const current = this.sessions.get(params.serverId);
      if (!current || current.generation !== generation) return;
      current.socket = undefined;
      current.connectedAt = undefined;
      current.state = 'error';
      current.error = `Connection error: ${formatSocketError(error)}`;
      current.reasonCode = 'socket_error';
      current.commandRegistryReady = false;
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
      if (current.state === 'connected' || current.state === 'authenticating' || current.state === 'ready') {
        current.state = 'idle';
        current.reasonCode = 'closed';
        current.commandRegistryReady = false;
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
    session.commandRegistryReady = false;

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

  private async runHandshakeAttempt(params: StarmoteConnectParams, attempt: number): Promise<boolean> {
    try {
      await this.withTimeout(
        this.waitForCommandRegistry(params, attempt),
        this.handshakeTimeoutMs,
        `Command registry handshake timed out after ${this.handshakeTimeoutMs}ms`,
      );
      logStarmoteDebug('session.handshake.ready', {
        serverId: params.serverId,
        attempt,
      });
      return true;
    } catch (error) {
      if (attempt > this.handshakeRetries) {
        throw error;
      }

      logStarmoteDebug('session.handshake.retry', {
        serverId: params.serverId,
        attempt,
        error: formatSocketError(error),
      });
      return false;
    }
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    message: string,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);

      promise
        .then((value) => {
          clearTimeout(timeoutId);
          resolve(value);
        })
        .catch((error) => {
          clearTimeout(timeoutId);
          reject(error);
        });
    });
  }

  private async writePacketWithTimeout(socket: SocketLike, packet: Uint8Array, timeoutMs: number): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        socket.removeListener('error', onError);
        socket.removeListener('close', onClose);
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      };

      const onError = (error: unknown) => finish(new Error(formatSocketError(error)));
      const onClose = () => finish(new Error('Socket closed while sending packet.'));
      const timeoutId = setTimeout(() => finish(new Error(`Packet send timed out after ${timeoutMs}ms.`)), timeoutMs);

      socket.on('error', onError);
      socket.on('close', onClose);

      try {
        socket.write(packet);
        finish();
      } catch (error) {
        finish(new Error(formatSocketError(error)));
      }
    });
  }
}

