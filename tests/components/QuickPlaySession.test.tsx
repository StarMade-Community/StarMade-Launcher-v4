// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

import { AppProvider, useApp } from '../../contexts/AppContext';
import type { ManagedItem, PlaySession } from '../../types';
import { makeSessionId } from '../../utils/playSession';

const mockUseData = vi.fn();
const mockRecordSession = vi.fn();

vi.mock('../../contexts/DataContext', () => ({ useData: () => mockUseData() }));

const installation: ManagedItem = {
  id: 'install-1',
  name: 'Test Installation',
  version: '0.300.000',
  type: 'release',
  icon: 'release',
  path: '/tmp/starmade',
  lastPlayed: 'Never',
};

/** Launches the installation directly, then replays the session that recorded. */
const ReplayHarness: React.FC = () => {
  const { openLaunchModal, launchSession } = useApp();
  const recorded = mockRecordSession.mock.calls[0]?.[0] as PlaySession | undefined;

  return (
    <>
      <button onClick={() => void openLaunchModal(installation)}>Launch</button>
      <button disabled={!recorded} onClick={() => recorded && launchSession(recorded)}>Replay</button>
    </>
  );
};

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

function stubLauncher(launch: ReturnType<typeof vi.fn>) {
  (window as unknown as Record<string, unknown>).launcher = {
    game: { launch, listRunning: vi.fn().mockResolvedValue([]) },
    store: { get: vi.fn().mockResolvedValue({ closeBehavior: 'Keep the launcher open' }) },
    window: { close: vi.fn(), hide: vi.fn(), minimize: vi.fn() },
  };
}

describe('quick-play session round trip', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockRecordSession.mockReset();
    mockUseData.mockReturnValue({
      activeAccount: null,
      installations: [installation],
      versions: [],
      recordSession: mockRecordSession,
    });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('replays a singleplayer session with the same arguments it was launched with', async () => {
    const launch = vi.fn().mockResolvedValue({ success: true, pid: 1 });
    stubLauncher(launch);

    render(<AppProvider><ReplayHarness /></AppProvider>);

    await act(async () => { fireEvent.click(screen.getByText('Launch')); });
    await flush();

    // A plain launch passes no uplink at all — the game opens its own menus.
    expect(launch.mock.calls[0][0]).toMatchObject({ uplink: undefined, uplinkPort: undefined });

    const recorded = mockRecordSession.mock.calls[0][0] as PlaySession;
    expect(recorded.sessionType).toBe('singleplayer');
    expect(recorded.serverAddress).toBeUndefined();
    expect(recorded.id).toBe(makeSessionId('install-1'));

    // `isLaunching` blocks a second launch for a couple of seconds.
    await act(async () => { vi.advanceTimersByTime(2500); });

    await act(async () => { fireEvent.click(screen.getByText('Replay')); });
    await flush();

    // The replay must not invent a direct connection to a local server.
    expect(launch).toHaveBeenCalledTimes(2);
    expect(launch.mock.calls[1][0]).toMatchObject({ uplink: undefined, uplinkPort: undefined });
    // Same target, same id — so the record updates instead of duplicating and
    // an existing pin keeps matching it.
    expect((mockRecordSession.mock.calls[1][0] as PlaySession).id).toBe(recorded.id);
  });

  it('replays a multiplayer session against the same server', async () => {
    const launch = vi.fn().mockResolvedValue({ success: true, pid: 2 });
    stubLauncher(launch);

    const Harness: React.FC = () => {
      const { launchSession } = useApp();
      const session = {
        id: makeSessionId('install-1', 'play.example.com', 4242),
        installationId: 'install-1',
        installationName: 'Test Installation',
        installationPath: '/tmp/starmade',
        installationVersion: '0.300.000',
        sessionType: 'multiplayer',
        serverAddress: 'play.example.com',
        serverPort: 4242,
        timestamp: new Date().toISOString(),
      } as PlaySession;
      return <button onClick={() => launchSession(session)}>Replay MP</button>;
    };

    render(<AppProvider><Harness /></AppProvider>);

    await act(async () => { fireEvent.click(screen.getByText('Replay MP')); });
    await flush();

    expect(launch.mock.calls[0][0]).toMatchObject({
      uplink: 'play.example.com',
      uplinkPort: 4242,
    });
  });

  it('does not launch a session whose installation has been deleted', async () => {
    const launch = vi.fn().mockResolvedValue({ success: true, pid: 3 });
    stubLauncher(launch);
    mockUseData.mockReturnValue({
      activeAccount: null,
      installations: [],                       // installation removed since the pin was made
      versions: [],
      recordSession: mockRecordSession,
    });

    const Harness: React.FC = () => {
      const { launchSession } = useApp();
      const session = { id: 'x', installationId: 'install-1', sessionType: 'singleplayer' } as PlaySession;
      return <button onClick={() => launchSession(session)}>Replay</button>;
    };

    render(<AppProvider><Harness /></AppProvider>);

    await act(async () => { fireEvent.click(screen.getByText('Replay')); });
    await flush();

    expect(launch).not.toHaveBeenCalled();
  });
});
