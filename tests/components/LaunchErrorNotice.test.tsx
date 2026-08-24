// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

import { AppProvider, useApp } from '../../contexts/AppContext';
import LaunchErrorNotice from '../../components/common/LaunchErrorNotice';
import type { ManagedItem, PlaySession } from '../../types';

const mockUseData = vi.fn();
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

const Harness: React.FC = () => {
  const { openLaunchModal, launchSession } = useApp();
  const orphan = {
    id: 'orphan',
    installationId: 'deleted-install',
    installationName: 'Old Profile',
    sessionType: 'singleplayer',
  } as PlaySession;

  return (
    <>
      <button onClick={() => void openLaunchModal(installation)}>Launch</button>
      <button onClick={() => launchSession(orphan)}>Quick play</button>
      <LaunchErrorNotice />
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

describe('LaunchErrorNotice', () => {
  beforeEach(() => {
    mockUseData.mockReturnValue({
      activeAccount: null,
      installations: [installation],
      versions: [],
      recordSession: vi.fn(),
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it('renders nothing while no launch has failed', () => {
    stubLauncher(vi.fn().mockResolvedValue({ success: true, pid: 1 }));
    render(<AppProvider><Harness /></AppProvider>);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the reason the game failed to launch, and dismisses', async () => {
    stubLauncher(vi.fn().mockResolvedValue({ success: false, error: 'Java 21 runtime is missing' }));

    render(<AppProvider><Harness /></AppProvider>);

    await act(async () => { fireEvent.click(screen.getByText('Launch')); });
    await flush();

    expect(screen.getByRole('alert')).toHaveTextContent('Java 21 runtime is missing');

    fireEvent.click(screen.getByLabelText('Dismiss launch error'));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('explains why a quick-play card for a deleted installation does nothing', async () => {
    const launch = vi.fn();
    stubLauncher(launch);

    render(<AppProvider><Harness /></AppProvider>);

    await act(async () => { fireEvent.click(screen.getByText('Quick play')); });
    await flush();

    expect(launch).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Old Profile');
  });

  it('clears a previous failure when the next launch starts', async () => {
    const launch = vi.fn()
      .mockResolvedValueOnce({ success: false, error: 'Port already in use' })
      .mockResolvedValueOnce({ success: true, pid: 7 });
    stubLauncher(launch);

    render(<AppProvider><Harness /></AppProvider>);

    await act(async () => { fireEvent.click(screen.getByText('Launch')); });
    await flush();
    expect(screen.getByRole('alert')).toHaveTextContent('Port already in use');

    await act(async () => { fireEvent.click(screen.getByText('Launch')); });
    await flush();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
