// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

import { DataProvider, useData } from '../../contexts/DataContext';
import type { ManagedItem } from '../../types';

const installations: ManagedItem[] = [
  {
    id: 'install-1',
    name: 'Alpha Profile',
    version: '0.203.175',
    type: 'release',
    icon: 'release',
    path: '/tmp/starmade-alpha',
    lastPlayed: 'Never',
    installed: true,
  },
  {
    id: 'install-2',
    name: 'Beta Profile',
    version: '0.204.000',
    type: 'release',
    icon: 'release',
    path: '/tmp/starmade-beta',
    lastPlayed: 'Never',
    installed: true,
  },
];

const TestHarness: React.FC = () => {
  const { selectedInstallationId, setSelectedInstallationId } = useData();

  return (
    <>
      <span data-testid="selected-installation-id">{selectedInstallationId ?? 'none'}</span>
      <button onClick={() => setSelectedInstallationId('install-2')}>Select Beta</button>
    </>
  );
};

const flushEffects = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe('DataContext selected installation persistence', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    delete (window as unknown as { launcher?: unknown }).launcher;
  });

  it('restores the previously selected installation from the store', async () => {
    const storeGet = vi.fn(async (key: string) => {
      switch (key) {
        case 'accounts':
          return [];
        case 'activeAccountId':
          return null;
        case 'installations':
          return installations;
        case 'selectedInstallationId':
          return 'install-2';
        case 'servers':
          return [];
        case 'selectedServerId':
          return null;
        case 'selectedVersionId':
          return null;
        case 'pinnedSessions':
          return [];
        case 'lastPlayedSession':
          return null;
        default:
          return null;
      }
    });

    (window as unknown as { launcher: unknown }).launcher = {
      store: {
        get: storeGet,
        set: vi.fn(),
      },
    };

    render(
      <DataProvider>
        <TestHarness />
      </DataProvider>,
    );

    await flushEffects();

    expect(storeGet).toHaveBeenCalledWith('selectedInstallationId');
    expect(screen.getByTestId('selected-installation-id')).toHaveTextContent('install-2');
  });

  it('persists installation selection changes to the store', async () => {
    const storeSet = vi.fn();

    (window as unknown as { launcher: unknown }).launcher = {
      store: {
        get: vi.fn(async (key: string) => {
          switch (key) {
            case 'accounts':
              return [];
            case 'activeAccountId':
              return null;
            case 'installations':
              return installations;
            case 'selectedInstallationId':
              return null;
            case 'servers':
              return [];
            case 'selectedServerId':
              return null;
            case 'selectedVersionId':
              return null;
            case 'pinnedSessions':
              return [];
            case 'lastPlayedSession':
              return null;
            default:
              return null;
          }
        }),
        set: storeSet,
      },
    };

    render(
      <DataProvider>
        <TestHarness />
      </DataProvider>,
    );

    await flushEffects();

    await act(async () => {
      fireEvent.click(screen.getByText('Select Beta'));
    });

    await flushEffects();

    expect(screen.getByTestId('selected-installation-id')).toHaveTextContent('install-2');
    expect(storeSet).toHaveBeenCalledWith('selectedInstallationId', 'install-2');
  });

  it('falls back to the last played installation when the stored selection is missing or invalid', async () => {
    (window as unknown as { launcher: unknown }).launcher = {
      store: {
        get: vi.fn(async (key: string) => {
          switch (key) {
            case 'accounts':
              return [];
            case 'activeAccountId':
              return null;
            case 'installations':
              return installations;
            case 'selectedInstallationId':
              return 'missing-installation';
            case 'servers':
              return [];
            case 'selectedServerId':
              return null;
            case 'selectedVersionId':
              return null;
            case 'pinnedSessions':
              return [];
            case 'lastPlayedSession':
              return {
                id: 'install-2::localhost::4242::',
                installationId: 'install-2',
                installationName: 'Beta Profile',
                installationPath: '/tmp/starmade-beta',
                installationVersion: '0.204.000',
                sessionType: 'singleplayer',
                serverAddress: 'localhost',
                serverPort: 4242,
                timestamp: new Date().toISOString(),
              };
            default:
              return null;
          }
        }),
        set: vi.fn(),
      },
    };

    render(
      <DataProvider>
        <TestHarness />
      </DataProvider>,
    );

    await flushEffects();

    expect(screen.getByTestId('selected-installation-id')).toHaveTextContent('install-2');
  });
});

