// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';

import GameLogViewer from '../../components/common/GameLogViewer';

type LogListener = (data: { installationId: string; level: string; message: string }) => void;

let listeners: LogListener[];
const cleanup = vi.fn();

const props = {
  installationId: 'install-1',
  installationName: 'Main',
  installationPath: '/tmp/starmade',
  onClose: vi.fn(),
};

beforeEach(() => {
  listeners = [];
  cleanup.mockReset();
  (window as unknown as Record<string, unknown>).launcher = {
    game: {
      getLogPath: vi.fn().mockResolvedValue('/tmp/starmade/logs/latest.log'),
      onLog: vi.fn((cb: LogListener) => { listeners.push(cb); return cleanup; }),
    },
  };
});

afterEach(() => vi.restoreAllMocks());

const emit = async (message: string) => {
  await act(async () => {
    listeners.forEach(cb => cb({ installationId: 'install-1', level: 'INFO', message }));
  });
};

describe('GameLogViewer', () => {
  it('keeps collecting log lines while closed and shows them when reopened', async () => {
    const { rerender } = render(<GameLogViewer {...props} isOpen />);

    await emit('while open');

    expect(screen.getByText('while open')).toBeInTheDocument();

    // User closes the panel; the game keeps running and keeps logging.
    rerender(<GameLogViewer {...props} isOpen={false} />);
    await emit('while closed');

    // The subscription must survive the close, otherwise reopening resumes
    // mid-stream with a hole where these lines should be.
    expect(cleanup).not.toHaveBeenCalled();

    rerender(<GameLogViewer {...props} isOpen />);
    expect(screen.getByText('while open')).toBeInTheDocument();
    expect(screen.getByText('while closed')).toBeInTheDocument();
  });
});
