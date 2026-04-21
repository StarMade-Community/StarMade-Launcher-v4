// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

import App from '../../App';
import { createLegacyImportPromptState, LEGACY_IMPORT_PROMPT_STORE_KEY } from '../../utils/legacyImport';

const mockUseApp = vi.fn();
const mockUseData = vi.fn();
const mockImportInstallations = vi.fn();

vi.mock('../../contexts/AppContext', () => ({
  useApp: () => mockUseApp(),
}));

vi.mock('../../contexts/DataContext', () => ({
  useData: () => mockUseData(),
}));

vi.mock('../../components/hooks/useLegacyInstallImporter', () => ({
  default: () => ({ importInstallations: mockImportInstallations }),
}));

vi.mock('../../components/layout/Header', () => ({ default: () => <div data-testid="header" /> }));
vi.mock('../../components/layout/Footer', () => ({ default: () => <div data-testid="footer" /> }));
vi.mock('../../components/pages/News', () => ({ default: () => <div>News</div> }));
vi.mock('../../components/pages/Screenshots', () => ({ default: () => <div>Screenshots</div> }));
vi.mock('../../components/pages/Mods', () => ({ default: () => <div>Mods</div> }));
vi.mock('../../components/pages/Installations', () => ({ default: () => <div>Installations</div> }));
vi.mock('../../components/pages/Play', () => ({ default: () => <div>Play</div> }));
vi.mock('../../components/pages/Settings', () => ({ default: () => <div>Settings</div> }));
vi.mock('../../components/pages/ServerPanel', () => ({ default: () => <div>Server Panel</div> }));
vi.mock('../../components/common/LaunchConfirmModal', () => ({ default: () => null }));
vi.mock('../../components/common/GameLogViewer', () => ({ default: () => null }));
vi.mock('../../components/common/UpdateAvailableModal', () => ({ default: () => null }));
vi.mock('../../components/common/LastPlayedWidget', () => ({ default: () => null }));
vi.mock('../../components/hooks/useRandomBackground', () => ({
  default: () => ({ url: null, loaded: true }),
}));

const baseUseAppValue = {
  activePage: 'Play',
  pageProps: {},
  isLaunchModalOpen: false,
  closeLaunchModal: vi.fn(),
  startLaunching: vi.fn(),
  startLaunchingAndTerminate: vi.fn(),
  logViewerOpen: false,
  logViewerInstallation: null,
  closeLogViewer: vi.fn(),
  navigate: vi.fn(),
};

describe('App first-launch legacy import prompt', () => {
  let onScanResult: ((paths: string[]) => void) | null = null;
  let storeGet: Mock<(key: string) => Promise<unknown>>;
  let storeSet: Mock<(key: string, value: unknown) => Promise<void>>;
  let storeDelete: Mock<(key: string) => Promise<void>>;
  let addInstallation: Mock<(installation: unknown) => void>;
  let readVersion: Mock<(path: string) => Promise<string | null>>;

  beforeEach(() => {
    onScanResult = null;
    storeGet = vi.fn(async (key: string) => {
      if (key === LEGACY_IMPORT_PROMPT_STORE_KEY) return undefined;
      if (key === 'defaultInstallationSettings') {
        return { javaMemory: 2048, jvmArgs: '-Xmx4G -Xms1G -Dfoo=bar' };
      }
      return undefined;
    });
    storeSet = vi.fn().mockResolvedValue(undefined);
    storeDelete = vi.fn().mockResolvedValue(undefined);
    addInstallation = vi.fn();
    readVersion = vi.fn().mockResolvedValue('0.203.175');

    mockUseApp.mockReturnValue({ ...baseUseAppValue, navigate: vi.fn() });
    mockUseData.mockReturnValue({
      installations: [],
      addInstallation,
      versions: [{ id: '0.203.175', name: '0.203.175', type: 'release', requiredJavaVersion: 21 }],
      isLoaded: true,
    });

    // Default: auto-import fails so the modal becomes visible after the attempt.
    mockImportInstallations.mockRejectedValue(new Error('auto-import mock failure'));

    (window as unknown as Record<string, unknown>).launcher = {
      store: {
        get: storeGet,
        set: storeSet,
        delete: storeDelete,
      },
      legacy: {
        onScanResult: (cb: (paths: string[]) => void) => {
          onScanResult = cb;
          return () => {
            onScanResult = null;
          };
        },
        readVersion,
      },
      window: {
        onMaximizedChanged: vi.fn(() => () => {}),
      },
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('opens the prompt from the startup scan event and lets the user review it in Settings', async () => {
    const navigate = vi.fn();
    mockUseApp.mockReturnValue({ ...baseUseAppValue, navigate });

    await act(async () => {
      render(<App />);
    });

    await act(async () => {
      onScanResult?.(['/games/StarMade-Classic']);
    });

    expect(screen.getByText('Import Old StarMade Installations')).toBeInTheDocument();
    expect(screen.getByText('/games/StarMade-Classic')).toBeInTheDocument();

    expect(storeSet).toHaveBeenCalledWith(
      LEGACY_IMPORT_PROMPT_STORE_KEY,
      expect.objectContaining({
        status: 'pending',
        paths: ['/games/StarMade-Classic'],
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: /Review in Settings/i }));

    expect(navigate).toHaveBeenCalledWith('Settings', { initialSection: 'launcher' });
    await waitFor(() => {
      expect(screen.queryByText('Import Old StarMade Installations')).not.toBeInTheDocument();
    });
  });

  it('imports all detected legacy installs and marks the prompt as completed', async () => {
    storeGet.mockImplementation(async (key: string) => {
      if (key === LEGACY_IMPORT_PROMPT_STORE_KEY) {
        return createLegacyImportPromptState('pending', ['/games/StarMade-Classic']);
      }
      if (key === 'defaultInstallationSettings') {
        return { javaMemory: 2048, jvmArgs: '-Xmx4G -Xms1G -Dfoo=bar' };
      }
      return undefined;
    });

    // First call is the silent auto-import attempt (fails so the modal stays visible).
    // Subsequent calls are the user-triggered retry (succeeds and produces the expected side effects).
    mockImportInstallations
      .mockRejectedValueOnce(new Error('auto-import mock failure'))
      .mockImplementation(async (paths: string[]) => {
        for (const p of paths) {
          const version = await readVersion(p);
          addInstallation({
            name: p.replace(/[/\\]+$/, '').split(/[/\\]/).pop() ?? 'legacy-install',
            path: p,
            version: version ?? 'unknown',
            type: 'release',
            icon: 'release' as const,
            minMemory: 2048,
            maxMemory: 2048,
            jvmArgs: '-Dfoo=bar',
            requiredJavaVersion: 21,
            installed: true,
            lastPlayed: 'Never',
          });
        }
        return { imported: paths, skipped: [] };
      });

    await act(async () => {
      render(<App />);
    });

    expect(screen.getByText('Import Old StarMade Installations')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Retry Import/i }));

    await waitFor(() => {
      expect(addInstallation).toHaveBeenCalledWith(expect.objectContaining({
        name: 'StarMade-Classic',
        path: '/games/StarMade-Classic',
        version: '0.203.175',
        type: 'release',
        icon: 'release',
        minMemory: 2048,
        maxMemory: 2048,
        jvmArgs: '-Dfoo=bar',
        requiredJavaVersion: 21,
        installed: true,
      }));
    });

    expect(readVersion).toHaveBeenCalledWith('/games/StarMade-Classic');
    expect(storeSet).toHaveBeenCalledWith(
      LEGACY_IMPORT_PROMPT_STORE_KEY,
      expect.objectContaining({
        status: 'imported',
        paths: [],
      }),
    );
  });

  it('does not reopen the prompt after the user dismisses it', async () => {
    await act(async () => {
      render(<App />);
    });

    // Simulate startup scan finding an installation.
    await act(async () => {
      onScanResult?.(['/games/StarMade-Classic']);
    });

    expect(screen.getByText('Import Old StarMade Installations')).toBeInTheDocument();

    // User dismisses the prompt.
    fireEvent.click(screen.getByRole('button', { name: /Not Now/i }));

    await waitFor(() => {
      expect(screen.queryByText('Import Old StarMade Installations')).not.toBeInTheDocument();
    });

    expect(storeSet).toHaveBeenCalledWith(
      LEGACY_IMPORT_PROMPT_STORE_KEY,
      expect.objectContaining({ status: 'dismissed' }),
    );

    // A late scan result arrives — it must NOT overwrite the dismiss.
    await act(async () => {
      onScanResult?.(['/games/StarMade-Classic']);
    });

    expect(screen.queryByText('Import Old StarMade Installations')).not.toBeInTheDocument();
  });

  it('does not reopen the prompt on next launch after dismissal', async () => {
    // Simulate a subsequent launch where the store already has 'dismissed'.
    storeGet.mockImplementation(async (key: string) => {
      if (key === LEGACY_IMPORT_PROMPT_STORE_KEY) {
        return createLegacyImportPromptState('dismissed');
      }
      return undefined;
    });

    await act(async () => {
      render(<App />);
    });

    // The modal should not appear.
    expect(screen.queryByText('Import Old StarMade Installations')).not.toBeInTheDocument();
  });
});

