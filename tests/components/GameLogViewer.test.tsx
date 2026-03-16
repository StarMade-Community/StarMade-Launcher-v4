// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';

import GameLogViewer from '../../components/common/GameLogViewer';

type LogPayload = {
  installationId: string;
  level: string;
  message: string;
};

describe('GameLogViewer crash detection', () => {
  let logListener: ((data: LogPayload) => void) | undefined;

  const installLauncherMock = () => {
    const onLog = vi.fn((listener: (data: LogPayload) => void) => {
      logListener = listener;
      return vi.fn();
    });

    const launcherMock = {
      game: {
        onLog,
        getLogPath: vi.fn().mockResolvedValue('/tmp/starmade.log'),
        getGraphicsInfo: vi.fn().mockResolvedValue(null),
        openLogLocation: vi.fn().mockResolvedValue(undefined),
      },
    };

    Object.defineProperty(window, 'launcher', {
      value: launcherMock,
      configurable: true,
      writable: true,
    });
  };

  const renderViewer = () => {
    render(
      <GameLogViewer
        installationId="install-1"
        installationName="Main Install"
        installationPath="/tmp/starmade"
        isOpen
        onClose={vi.fn()}
      />
    );
  };

  const emitLog = async (message: string, level = 'INFO') => {
    await act(async () => {
      logListener?.({ installationId: 'install-1', level, message });
    });
  };

  beforeEach(() => {
    logListener = undefined;
    installLauncherMock();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prefers crash markers over a clean process exit fallback', async () => {
    renderViewer();

    await emitLog('client booting');
    await emitLog('CRITICAL GL ERROR: failed to initialize pipeline', 'ERROR');
    await emitLog('Process exited with code 0');

    await waitFor(() => {
      expect(screen.getByText(/CRASH DETECTED - Click to Report/i)).toBeInTheDocument();
    });

    const reportText = document.querySelector('pre')?.textContent ?? '';
    expect(reportText).toContain('CRASH LOG (50 entries above/below "critical gl error")');
    expect(reportText).toContain('CRITICAL GL ERROR: failed to initialize pipeline');
  });

  it('captures a centered +/-50 context around the crash marker', async () => {
    renderViewer();

    for (let i = 0; i < 60; i += 1) {
      await emitLog(`before-${i}`);
    }

    await emitLog('critical gl error happened here', 'ERROR');

    for (let i = 0; i < 60; i += 1) {
      await emitLog(`after-${i}`);
    }

    await emitLog('Process exited with code 0');

    await waitFor(() => {
      expect(screen.getByText(/CRASH DETECTED - Click to Report/i)).toBeInTheDocument();
    });

    const reportText = document.querySelector('pre')?.textContent ?? '';

    expect(reportText).toContain('before-10');
    expect(reportText).not.toContain('before-9');
    expect(reportText).toContain('after-49');
    expect(reportText).not.toContain('after-50');
  });

  it('falls back to process exit code detection when markers are absent', async () => {
    renderViewer();

    await emitLog('client booting');
    await emitLog('Process exited with code 1');

    await waitFor(() => {
      expect(screen.getByText(/CRASH DETECTED - Click to Report/i)).toBeInTheDocument();
    });

    const reportText = document.querySelector('pre')?.textContent ?? '';
    expect(reportText).toContain('CRASH LOG (Last 100 entries before crash)');
  });
});

