import { describe, it, expect } from 'vitest';
import type { PlaySession } from '../../types';
import { makeSessionId, normalizePlaySession } from '../../utils/playSession';

const base = {
  installationId: 'i1',
  installationName: 'Main',
  installationPath: '/games/sm',
  installationVersion: '0.300.000',
  timestamp: '2026-01-01T00:00:00.000Z',
};

describe('makeSessionId', () => {
  it('is stable across relaunches of the same target', () => {
    expect(makeSessionId('i1', 'play.example.com', 4242, ['b', 'a']))
      .toBe(makeSessionId('i1', 'play.example.com', 4242, ['a', 'b']));
  });

  it('separates a plain launch from a direct connect to localhost', () => {
    // The two produce different game arguments, so they are different targets:
    // collapsing them is what made a pinned singleplayer session relaunch as a
    // connection to a server that was never running.
    expect(makeSessionId('i1')).not.toBe(makeSessionId('i1', 'localhost', 4242));
  });

  it('separates different mod sets and different servers', () => {
    expect(makeSessionId('i1', 'a.example.com')).not.toBe(makeSessionId('i1', 'b.example.com'));
    expect(makeSessionId('i1', undefined, undefined, ['x'])).not.toBe(makeSessionId('i1'));
  });
});

describe('normalizePlaySession', () => {
  it('strips the placeholder uplink an older launcher wrote for singleplayer', () => {
    const legacy = {
      ...base,
      id: 'i1::localhost::4242::',
      sessionType: 'singleplayer',
      serverAddress: 'localhost',
      serverPort: 4242,
    } as PlaySession;

    const fixed = normalizePlaySession(legacy);

    expect(fixed.serverAddress).toBeUndefined();
    expect(fixed.serverPort).toBeUndefined();
    // Rebuilt to the id a fresh launch of the same target now writes, so an old
    // pin keeps matching instead of turning into a stale duplicate.
    expect(fixed.id).toBe(makeSessionId('i1'));
  });

  it('leaves multiplayer sessions untouched', () => {
    const mp = {
      ...base,
      id: makeSessionId('i1', 'play.example.com', 4242),
      sessionType: 'multiplayer',
      serverAddress: 'play.example.com',
      serverPort: 4242,
    } as PlaySession;

    expect(normalizePlaySession(mp)).toEqual(mp);
  });
});
