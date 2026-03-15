import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';

import { StarmoteSessionManager } from '../../electron/starmote-session-manager.js';
import { decodeStarmotePacket, STARMOTE_COMMAND_IDS, STARMOTE_PROTOCOL_VERSION } from '../../electron/starmote-protocol.js';

class FakeSocket extends EventEmitter {
  public behavior: 'connect' | 'error' | 'timeout' | 'manual' = 'connect';
  public destroyed = false;
  public writes: Uint8Array[] = [];

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

  write(data: Uint8Array): boolean {
    this.writes.push(data);
    return true;
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

function createHandshakeTimeoutHarness() {
  const manager = new StarmoteSessionManager({
    createSocket: () => new FakeSocket(),
    waitForCommandRegistry: async () => {
      await new Promise<void>(() => undefined);
    },
    handshakeTimeoutMs: 20,
    handshakeRetries: 1,
  });

  return { manager };
}

function createAuthFailHarness() {
  const manager = new StarmoteSessionManager({
    createSocket: () => new FakeSocket(),
    runAuthStage: async () => {
      throw new Error('bad credentials');
    },
  });

  return { manager };
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
    expect(result.status.state).toBe('ready');
    expect(result.status.reasonCode).toBe('ready');
    expect(result.status.isReady).toBe(true);
    expect(harness.emitted.map((entry) => entry.state)).toEqual(['connecting', 'connected', 'authenticating', 'ready']);
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
    expect(recoveredStatus.state).toBe('ready');
    expect(recoveredStatus.error).toBeUndefined();
  });

  it('transitions to registry_unavailable when auth stage throws', async () => {
    const authFailHarness = createAuthFailHarness();
    const result = await authFailHarness.manager.connect({
      serverId: 'srv-auth-fail',
      host: '127.0.0.1',
      port: 4242,
    });

    expect(result.success).toBe(false);
    expect(result.status.state).toBe('error');
    expect(result.status.reasonCode).toBe('registry_unavailable');
    expect(result.status.error).toContain('Authentication/registry setup failed: bad credentials');
  });

  it('fails with protocol_timeout when command-registry handshake times out', async () => {
    const timeoutHarness = createHandshakeTimeoutHarness();

    const result = await timeoutHarness.manager.connect({
      serverId: 'srv-handshake-timeout',
      host: '127.0.0.1',
      port: 4242,
    });

    expect(result.success).toBe(false);
    expect(result.status.state).toBe('error');
    expect(result.status.reasonCode).toBe('protocol_timeout');
    expect(result.status.error).toContain('Protocol handshake timed out');
  });

  it('sends admin commands only after protocol-ready state and writes encoded packets', async () => {
    const connectResult = await harness.manager.connect({
      serverId: 'srv-send-command',
      host: '127.0.0.1',
      port: 4242,
    });
    expect(connectResult.success).toBe(true);

    const sendResult = await harness.manager.sendAdminCommand({
      serverId: 'srv-send-command',
      command: '/player_list',
    });
    expect(sendResult.success).toBe(true);

    const frame = harness.sockets[0]?.writes[0];
    expect(frame).toBeTruthy();
    const decoded = decodeStarmotePacket(frame as Uint8Array);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      expect(decoded.packet.version).toBe(STARMOTE_PROTOCOL_VERSION);
      expect(decoded.packet.commandId).toBe(STARMOTE_COMMAND_IDS.ADMIN_COMMAND);
      expect(Buffer.from(decoded.packet.payload).toString('utf8')).toBe('/player_list');
    }
  });

  it('rejects admin command sends when the session is not protocol-ready', async () => {
    const sendResult = await harness.manager.sendAdminCommand({
      serverId: 'srv-not-ready',
      command: '/player_list',
    });

    expect(sendResult.success).toBe(false);
    expect(sendResult.reasonCode).toBe('not_ready');
    expect(sendResult.error).toContain('not protocol-ready');
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

