import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';

import { StarmoteSessionManager } from '../../electron/starmote-session-manager.js';

class FakeSocket extends EventEmitter {
  public behavior: 'connect' | 'error' | 'timeout' | 'manual' = 'connect';
  public destroyed = false;

  setNoDelay(): void {
    // no-op for tests
  }

  setTimeout(): void {
    // no-op for tests
  }

  connect(): void {
    queueMicrotask(() => {
      if (this.behavior === 'manual') return;
      if (this.behavior === 'connect') {
        this.emit('connect');
      } else if (this.behavior === 'error') {
        this.emit('error', new Error('dial failed'));
      } else {
        this.emit('timeout');
      }
    });
  }

  destroy(): void {
    this.destroyed = true;
    this.emit('close');
  }
}

function createHarness() {
  const emitted: Array<{ serverId: string; state: string; reasonCode?: string; error?: string }> = [];
  const sockets: FakeSocket[] = [];

  const manager = new StarmoteSessionManager({
    createSocket: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    onStatusChanged: (status) => {
      emitted.push({
        serverId: status.serverId,
        state: status.state,
        reasonCode: status.reasonCode,
        error: status.error,
      });
    },
  });

  return { manager, sockets, emitted };
}

describe('StarmoteSessionManager', () => {
  let harness: ReturnType<typeof createHarness>;
  const originalDebug = process.env.STARMOTE_DEBUG;

  beforeEach(() => {
    harness = createHarness();
    delete process.env.STARMOTE_DEBUG;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalDebug === undefined) {
      delete process.env.STARMOTE_DEBUG;
    } else {
      process.env.STARMOTE_DEBUG = originalDebug;
    }
  });

  it('reports connecting then connected for a successful session', async () => {
    const result = await harness.manager.connect({
      serverId: 'srv-1',
      host: '127.0.0.1',
      port: 4242,
      username: 'admin',
    });

    expect(result.success).toBe(true);
    expect(result.status.state).toBe('connected');
    expect(result.status.reasonCode).toBe('connected');
    expect(harness.emitted.map((entry) => entry.state)).toEqual(['connecting', 'connected']);
  });

  it('handles disconnect during connect without leaving the session stuck', async () => {
    const connectPromise = harness.manager.connect({
      serverId: 'srv-2',
      host: '127.0.0.1',
      port: 4242,
    });
    harness.sockets[0].behavior = 'manual';

    const disconnectStatus = harness.manager.disconnect('srv-2');
    const connectResult = await connectPromise;

    expect(disconnectStatus.state).toBe('idle');
    expect(disconnectStatus.reasonCode).toBe('disconnected');
    expect(connectResult.success).toBe(false);
    expect(connectResult.status.state).toBe('idle');
    expect(connectResult.status.reasonCode).toBe('disconnected');
  });

  it('replaces an existing connection with a new one for the same server', async () => {
    await harness.manager.connect({
      serverId: 'srv-3',
      host: '127.0.0.1',
      port: 4242,
    });

    const second = await harness.manager.connect({
      serverId: 'srv-3',
      host: '127.0.0.2',
      port: 4243,
    });

    expect(second.success).toBe(true);
    expect(second.status.host).toBe('127.0.0.2');
    expect(second.status.port).toBe(4243);
    expect(harness.sockets[0].destroyed).toBe(true);
  });

  it('transitions to error when a connected socket later errors', async () => {
    await harness.manager.connect({
      serverId: 'srv-4',
      host: '127.0.0.1',
      port: 4242,
    });

    harness.sockets[0].emit('error', new Error('boom'));

    const status = harness.manager.getStatusFor('srv-4');
    expect(status.state).toBe('error');
    expect(status.reasonCode).toBe('socket_error');
    expect(status.error).toContain('Connection error: boom');
  });

  it('retains the last connect failure until a new session replaces it', async () => {
    const connectPromise = harness.manager.connect({
      serverId: 'srv-5',
      host: '10.0.0.2',
      port: 4242,
    });
    harness.sockets[0].behavior = 'error';
    await connectPromise;

    const failedStatus = harness.manager.getStatusFor('srv-5');
    expect(failedStatus.state).toBe('error');
    expect(failedStatus.reasonCode).toBe('connect_failed');

    await harness.manager.connect({
      serverId: 'srv-5',
      host: '127.0.0.1',
      port: 4242,
    });

    const recoveredStatus = harness.manager.getStatusFor('srv-5');
    expect(recoveredStatus.state).toBe('connected');
    expect(recoveredStatus.error).toBeUndefined();
  });

  it('does not emit debug logs when STARMOTE_DEBUG is not enabled', async () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => undefined);

    await harness.manager.connect({
      serverId: 'srv-debug-off',
      host: '127.0.0.1',
      port: 4242,
    });

    expect(debugSpy).not.toHaveBeenCalled();
  });

  it('emits debug logs when STARMOTE_DEBUG is enabled', async () => {
    process.env.STARMOTE_DEBUG = '1';
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => undefined);

    await harness.manager.connect({
      serverId: 'srv-debug-on',
      host: '127.0.0.1',
      port: 4242,
    });

    expect(debugSpy).toHaveBeenCalled();
    expect(debugSpy.mock.calls.some((call) => String(call[0]).includes('[StarMote] session.connect.start'))).toBe(true);
    expect(debugSpy.mock.calls.some((call) => String(call[0]).includes('[StarMote] session.connect.success'))).toBe(true);
  });
});

