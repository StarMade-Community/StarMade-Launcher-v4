import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';

import { IPC } from '../../electron/ipc-channels.js';
import { registerStarmoteIpcHandlers } from '../../electron/starmote-ipc.js';
import { encodeStarmotePacket } from '../../electron/starmote-protocol.js';

function encodeJavaUtf(value: string): Buffer {
  const bytes = Buffer.from(value, 'utf8');
  const out = Buffer.allocUnsafe(2 + bytes.byteLength);
  out.writeUInt16BE(bytes.byteLength, 0);
  bytes.copy(out, 2);
  return out;
}

function createLoginResponsePayload(code: number, clientId = 101, extraReason?: string): Buffer {
  const version = encodeJavaUtf('0.203.999');
  const reason = encodeJavaUtf(extraReason ?? '');
  const hasReason = typeof extraReason === 'string';
  const parameterCount = hasReason ? 5 : 4;
  const payloadSize = 5
    + 4
    + 1 + 4
    + 1 + 4
    + 1 + 8
    + 1 + version.byteLength
    + (hasReason ? 1 + reason.byteLength : 0);
  const payload = Buffer.allocUnsafe(payloadSize);

  let offset = 0;
  payload.writeUInt8(42, offset);
  offset += 1;
  payload.writeInt16BE(-1, offset);
  offset += 2;
  payload.writeUInt8(0, offset);
  offset += 1;
  payload.writeUInt8(111, offset);
  offset += 1;

  payload.writeInt32BE(parameterCount, offset);
  offset += 4;

  payload.writeUInt8(1, offset);
  offset += 1;
  payload.writeInt32BE(code, offset);
  offset += 4;

  payload.writeUInt8(1, offset);
  offset += 1;
  payload.writeInt32BE(clientId, offset);
  offset += 4;

  payload.writeUInt8(2, offset);
  offset += 1;
  payload.writeBigInt64BE(BigInt(Date.now()), offset);
  offset += 8;

  payload.writeUInt8(4, offset);
  offset += 1;
  version.copy(payload, offset);
  offset += version.byteLength;

  if (hasReason) {
    payload.writeUInt8(4, offset);
    offset += 1;
    reason.copy(payload, offset);
  }

  return payload;
}

function createTimestampFramedPacket(payload: Buffer): Buffer {
  const frame = Buffer.allocUnsafe(4 + 8 + payload.byteLength);
  frame.writeUInt32BE(payload.byteLength, 0);
  frame.writeBigInt64BE(BigInt(Date.now()), 4);
  payload.copy(frame, 12);
  return frame;
}

class FakeSocket extends EventEmitter {
  public behavior: 'connect' | 'error' | 'timeout' = 'connect';
  public destroyed = false;
  public writes: Uint8Array[] = [];
  public loginResponseCode = 0;

  setNoDelay(): void {
    // no-op for tests
  }

  setTimeout(): void {
    // no-op for tests
  }

  connect(_port: number, _host: string): void {
    queueMicrotask(() => {
      if (this.behavior === 'connect') {
        this.emit('connect');
      } else if (this.behavior === 'error') {
        this.emit('error', new Error('dial failed'));
      } else {
        this.emit('timeout');
      }
    });
  }

  destroy(): this {
    this.destroyed = true;
    this.emit('close');
    return this;
  }

  write(data: Uint8Array): boolean {
    this.writes.push(data);
    const packet = Buffer.from(data);
    if (packet.byteLength >= 9 && packet.readUInt8(4) === 42 && packet.readUInt8(7) === 0) {
      const responsePayload = createLoginResponsePayload(this.loginResponseCode, 1001, this.loginResponseCode < 0 ? 'auth failed' : undefined);
      setTimeout(() => {
        this.emit('data', createTimestampFramedPacket(responsePayload));
      }, 0);
    }
    return true;
  }
}

type Handler = (event: unknown, payload?: unknown) => unknown;

function createHarness(options?: {
  resolveAuthTokenForAccount?: (accountId: string) => Promise<string | null>;
  loginResponseCode?: number;
}) {
  const handlers = new Map<string, Handler>();
  const sent: Array<{ channel: string; payload: unknown }> = [];
  const sockets: FakeSocket[] = [];

  registerStarmoteIpcHandlers({
    ipcMain: {
      handle: (channel, listener) => {
        handlers.set(channel, listener);
      },
    },
    getAllWindows: () => [
      {
        isDestroyed: () => false,
        webContents: {
          send: (channel: string, payload: unknown) => sent.push({ channel, payload }),
        },
      },
    ],
    createSocket: () => {
      const socket = new FakeSocket();
      socket.loginResponseCode = options?.loginResponseCode ?? 0;
      sockets.push(socket);
      return socket;
    },
    resolveAuthTokenForAccount: options?.resolveAuthTokenForAccount ?? (async () => 'token-abc'),
  });

  return {
    handlers,
    sent,
    sockets,
    call: async (channel: string, payload?: unknown) => {
      const handler = handlers.get(channel);
      if (!handler) throw new Error(`Missing handler for ${channel}`);
      return handler({}, payload);
    },
  };
}

describe('StarMote IPC handlers', () => {
  let harness: ReturnType<typeof createHarness>;
  const originalDebug = process.env.STARMOTE_DEBUG;

  beforeEach(() => {
    delete process.env.STARMOTE_DEBUG;
    harness = createHarness();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalDebug === undefined) {
      delete process.env.STARMOTE_DEBUG;
    } else {
      process.env.STARMOTE_DEBUG = originalDebug;
    }
  });

  it('rejects invalid connect payloads', async () => {
    const result = await harness.call(IPC.STARMOTE_CONNECT, {
      serverId: '',
      host: '127.0.0.1',
      port: 4242,
      activeAccountId: 'acct-1',
    });
    expect(result).toEqual({ success: false, error: 'serverId, host, and a valid port are required.' });
  });

  it('requires active account authentication for connect', async () => {
    const result = await harness.call(IPC.STARMOTE_CONNECT, {
      serverId: 'srv-auth-required',
      host: '127.0.0.1',
      port: 4242,
    });

    expect(result).toEqual({ success: false, error: 'StarMade account authentication is required for StarMote.' });
  });

  it('connects successfully and reports connected status', async () => {
    const result = await harness.call(IPC.STARMOTE_CONNECT, {
      serverId: 'srv-1',
      host: '127.0.0.1',
      port: 4242,
      username: 'admin',
      activeAccountId: 'acct-1',
    }) as { success: boolean; status?: { connected: boolean; serverId: string; host?: string; state?: string; reasonCode?: string } };

    expect(result.success).toBe(true);
    expect(result.status?.connected).toBe(true);
    expect(result.status?.state).toBe('ready');
    expect(result.status?.reasonCode).toBe('ready');
    expect(result.status?.serverId).toBe('srv-1');
    expect(result.status?.host).toBe('127.0.0.1');

    const statusAll = await harness.call(IPC.STARMOTE_STATUS) as { statuses: Array<{ serverId: string; connected: boolean }> };
    expect(statusAll.statuses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ serverId: 'srv-1', connected: true, isReady: true }),
      ]),
    );

    expect(harness.sent.some((entry) => entry.channel === IPC.STARMOTE_STATUS_CHANGED)).toBe(true);
  });

  it('stores connection errors and exposes them via status', async () => {
    const connectPromise = harness.call(IPC.STARMOTE_CONNECT, {
      serverId: 'srv-2',
      host: '10.0.0.2',
      port: 4242,
      activeAccountId: 'acct-1',
    }) as Promise<{ success: boolean; error?: string; status?: { connected: boolean; error?: string; state?: string; reasonCode?: string } }>;

    await Promise.resolve();
    harness.sockets[0].behavior = 'error';
    const result = await connectPromise;

    expect(result.success).toBe(false);
    expect(result.error).toContain('Connection failed:');
    expect(result.status?.connected).toBe(false);
    expect(result.status?.state).toBe('error');
    expect(result.status?.reasonCode).toBe('connect_failed');
    expect(result.status?.error).toContain('Connection failed:');

    const statusSingle = await harness.call(IPC.STARMOTE_STATUS, { serverId: 'srv-2' }) as { statuses: Array<{ connected: boolean; error?: string }> };
    expect(statusSingle.statuses[0]?.connected).toBe(false);
    expect(statusSingle.statuses[0]?.error).toContain('Connection failed:');
  });

  it('fails connect when selected account has no usable token', async () => {
    harness = createHarness({
      resolveAuthTokenForAccount: async () => null,
    });

    const result = await harness.call(IPC.STARMOTE_CONNECT, {
      serverId: 'srv-auth-missing',
      host: '127.0.0.1',
      port: 4242,
      activeAccountId: 'acct-1',
    }) as { success: boolean; error?: string; status?: { state?: string; reasonCode?: string } };

    expect(result.success).toBe(false);
    expect(result.error).toContain('StarMade account authentication is required for StarMote');
    expect(result.status).toBeUndefined();
  });

  it('surfaces user-friendly auth diagnostics when login is rejected by server', async () => {
    harness = createHarness({ loginResponseCode: -10 });

    const result = await harness.call(IPC.STARMOTE_CONNECT, {
      serverId: 'srv-auth-rejected',
      host: '127.0.0.1',
      port: 4242,
      activeAccountId: 'acct-1',
    }) as { success: boolean; error?: string; status?: { reasonCode?: string; error?: string } };

    expect(result.success).toBe(false);
    expect(result.status?.reasonCode).toBe('auth_failed');
    expect(result.status?.error).toContain('requires StarMade account authentication');
  });

  it('disconnects an active connection', async () => {
    await harness.call(IPC.STARMOTE_CONNECT, {
      serverId: 'srv-3',
      host: '127.0.0.1',
      port: 5000,
      activeAccountId: 'acct-1',
    });

    const result = await harness.call(IPC.STARMOTE_DISCONNECT, { serverId: 'srv-3' }) as {
      success: boolean;
      status?: { serverId: string; connected: boolean };
    };

    expect(result.success).toBe(true);
    expect(result.status).toEqual({
      serverId: 'srv-3',
      connected: false,
      isReady: false,
      state: 'idle',
      host: '127.0.0.1',
      port: 5000,
      username: 'acct-1',
      connectedAt: undefined,
      error: undefined,
      reasonCode: 'disconnected',
    });
  });

  it('sends a versioned admin command through protocol-ready StarMote sessions', async () => {
    await harness.call(IPC.STARMOTE_CONNECT, {
      serverId: 'srv-command',
      host: '127.0.0.1',
      port: 5001,
      activeAccountId: 'acct-1',
    });

    const result = await harness.call(IPC.STARMOTE_SEND_ADMIN_COMMAND, {
      version: 1,
      serverId: 'srv-command',
      command: '/player_list',
    }) as { success: boolean; error?: string };

    expect(result.success).toBe(true);
    const frame = harness.sockets[0]?.writes[1];
    expect(frame).toBeTruthy();
    const raw = Buffer.from(frame as Uint8Array);
    expect(raw.readUInt32BE(0)).toBe(raw.byteLength - 4);
    expect(raw.readUInt8(4)).toBe(42);
    expect(raw.readUInt8(7)).toBe(2);
    expect(raw.subarray(19).toString('utf8')).toBe('/player_list');
  });

  it('rejects unsupported StarMote command payload versions', async () => {
    const result = await harness.call(IPC.STARMOTE_SEND_ADMIN_COMMAND, {
      version: 2,
      serverId: 'srv-command',
      command: '/player_list',
    }) as { success: boolean; error?: string };

    expect(result.success).toBe(false);
    expect(result.error).toBe('Unsupported StarMote command payload version.');
  });

  it('rejects multiline StarMote admin commands', async () => {
    await harness.call(IPC.STARMOTE_CONNECT, {
      serverId: 'srv-command-validate',
      host: '127.0.0.1',
      port: 5003,
      activeAccountId: 'acct-1',
    });

    const result = await harness.call(IPC.STARMOTE_SEND_ADMIN_COMMAND, {
      version: 1,
      serverId: 'srv-command-validate',
      command: '/player_list\n/shutdown 10',
    }) as { success: boolean; reasonCode?: string; error?: string };

    expect(result.success).toBe(false);
    expect(result.reasonCode).toBe('invalid_command');
    expect(result.error).toContain('single line');
  });

  it('broadcasts runtime events emitted from inbound StarMote socket data', async () => {
    await harness.call(IPC.STARMOTE_CONNECT, {
      serverId: 'srv-runtime-events',
      host: '127.0.0.1',
      port: 5002,
      activeAccountId: 'acct-1',
    });

    const frame = encodeStarmotePacket(0x2301, Buffer.from('SQL QUERY 2 BEGIN\n', 'utf8'));
    harness.sockets[0].emit('data', Buffer.from(frame));

    const runtimeEvents = harness.sent
      .filter((entry) => entry.channel === IPC.STARMOTE_RUNTIME_EVENT)
      .map((entry) => entry.payload as { serverId: string; line: string; source: string; commandId?: number });

    expect(runtimeEvents).toEqual([
      expect.objectContaining({
        serverId: 'srv-runtime-events',
        line: 'SQL QUERY 2 BEGIN',
        source: 'framed-packet',
        commandId: 0x2301,
      }),
    ]);
  });

  it('emits debug logs for IPC operations when STARMOTE_DEBUG is enabled', async () => {
    process.env.STARMOTE_DEBUG = '1';
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    harness = createHarness();

    await harness.call(IPC.STARMOTE_CONNECT, {
      serverId: 'srv-debug-ipc',
      host: '127.0.0.1',
      port: 4242,
      activeAccountId: 'acct-1',
    });
    await harness.call(IPC.STARMOTE_STATUS, { serverId: 'srv-debug-ipc' });
    await harness.call(IPC.STARMOTE_DISCONNECT, { serverId: 'srv-debug-ipc' });

    expect(debugSpy.mock.calls.some((call) => String(call[0]).includes('[StarMote] ipc.registered'))).toBe(true);
    expect(debugSpy.mock.calls.some((call) => String(call[0]).includes('[StarMote] ipc.connect.request'))).toBe(true);
    expect(debugSpy.mock.calls.some((call) => String(call[0]).includes('[StarMote] ipc.status.request'))).toBe(true);
    expect(debugSpy.mock.calls.some((call) => String(call[0]).includes('[StarMote] ipc.disconnect.request'))).toBe(true);
  });
});

