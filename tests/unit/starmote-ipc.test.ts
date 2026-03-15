import { describe, it, expect, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

import { IPC } from '../../electron/ipc-channels.js';
import { registerStarmoteIpcHandlers } from '../../electron/starmote-ipc.js';

class FakeSocket extends EventEmitter {
  public behavior: 'connect' | 'error' | 'timeout' = 'connect';
  public destroyed = false;

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
}

type Handler = (event: unknown, payload?: unknown) => unknown;

function createHarness() {
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
      sockets.push(socket);
      return socket;
    },
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

  beforeEach(() => {
    harness = createHarness();
  });

  it('rejects invalid connect payloads', async () => {
    const result = await harness.call(IPC.STARMOTE_CONNECT, { serverId: '', host: '127.0.0.1', port: 4242 });
    expect(result).toEqual({ success: false, error: 'serverId, host, and a valid port are required.' });
  });

  it('connects successfully and reports connected status', async () => {
    const result = await harness.call(IPC.STARMOTE_CONNECT, {
      serverId: 'srv-1',
      host: '127.0.0.1',
      port: 4242,
      username: 'admin',
    }) as { success: boolean; status?: { connected: boolean; serverId: string; host?: string; state?: string; reasonCode?: string } };

    expect(result.success).toBe(true);
    expect(result.status?.connected).toBe(true);
    expect(result.status?.state).toBe('connected');
    expect(result.status?.reasonCode).toBe('connected');
    expect(result.status?.serverId).toBe('srv-1');
    expect(result.status?.host).toBe('127.0.0.1');

    const statusAll = await harness.call(IPC.STARMOTE_STATUS) as { statuses: Array<{ serverId: string; connected: boolean }> };
    expect(statusAll.statuses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ serverId: 'srv-1', connected: true }),
      ]),
    );

    expect(harness.sent.some((entry) => entry.channel === IPC.STARMOTE_STATUS_CHANGED)).toBe(true);
  });

  it('stores connection errors and exposes them via status', async () => {
    const connectPromise = harness.call(IPC.STARMOTE_CONNECT, {
      serverId: 'srv-2',
      host: '10.0.0.2',
      port: 4242,
    }) as Promise<{ success: boolean; error?: string; status?: { connected: boolean; error?: string; state?: string; reasonCode?: string } }>;

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

  it('disconnects an active connection', async () => {
    await harness.call(IPC.STARMOTE_CONNECT, {
      serverId: 'srv-3',
      host: '127.0.0.1',
      port: 5000,
    });

    const result = await harness.call(IPC.STARMOTE_DISCONNECT, { serverId: 'srv-3' }) as {
      success: boolean;
      status?: { serverId: string; connected: boolean };
    };

    expect(result.success).toBe(true);
    expect(result.status).toEqual({
      serverId: 'srv-3',
      connected: false,
      state: 'idle',
      host: '127.0.0.1',
      port: 5000,
      username: undefined,
      connectedAt: undefined,
      error: undefined,
      reasonCode: 'disconnected',
    });
  });
});

