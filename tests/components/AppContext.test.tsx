// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

import { AppProvider, useApp } from '../../contexts/AppContext';
import type { ManagedItem } from '../../types';

const mockUseData = vi.fn();
const mockRecordSession = vi.fn();

vi.mock('../../contexts/DataContext', () => ({
  useData: () => mockUseData(),
}));

const installation: ManagedItem = {
  id: 'install-1',
  name: 'Test Installation',
  version: '0.203.175',
  type: 'release',
  icon: 'release',
  path: '/tmp/starmade',
  lastPlayed: 'Never',
};

const LaunchHarness: React.FC = () => {
  const { openLaunchModal, logViewerOpen } = useApp();

  return (
    <>
      <button onClick={() => void openLaunchModal(installation)}>Launch</button>
      <span data-testid="log-viewer-state">{logViewerOpen ? 'open' : 'closed'}</span>
    </>
  );
};

const flushLaunch = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe('AppContext post-launch behavior', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockRecordSession.mockReset();
    mockUseData.mockReturnValue({
      activeAccount: null,
      installations: [installation],
      recordSession: mockRecordSession,
    });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('closes the launcher after a successful launch when closeBehavior is set to close', async () => {
    const close = vi.fn();
    const launch = vi.fn().mockResolvedValue({ success: true, pid: 1234 });

    (window as unknown as Record<string, unknown>).launcher = {
      game: {
        launch,
        listRunning: vi.fn().mockResolvedValue([]),
      },
      store: {
        get: vi.fn().mockResolvedValue({ closeBehavior: 'Close launcher', showLog: true }),
      },
      window: {
        close,
        minimize: vi.fn(),
      },
    };

    render(
      <AppProvider>
        <LaunchHarness />
      </AppProvider>,
    );

    await act(async () => {
      fireEvent.click(screen.getByText('Launch'));
    });

    await flushLaunch();

    await act(async () => {
      vi.advanceTimersByTime(250);
    });

    expect(launch).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(mockRecordSession).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('log-viewer-state')).toHaveTextContent('closed');
  });

  it('keeps the launcher open and opens the log viewer when requested', async () => {
    const close = vi.fn();
    const launch = vi.fn().mockResolvedValue({ success: true, pid: 5678 });

    (window as unknown as Record<string, unknown>).launcher = {
      game: {
        launch,
        listRunning: vi.fn().mockResolvedValue([]),
      },
      store: {
        get: vi.fn().mockResolvedValue({ closeBehavior: 'Keep the launcher open', showLog: true }),
      },
      window: {
        close,
        minimize: vi.fn(),
      },
    };

    render(
      <AppProvider>
        <LaunchHarness />
      </AppProvider>,
    );

    await act(async () => {
      fireEvent.click(screen.getByText('Launch'));
    });

    await flushLaunch();

    expect(launch).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('log-viewer-state')).toHaveTextContent('open');
    expect(close).not.toHaveBeenCalled();
  });
});

