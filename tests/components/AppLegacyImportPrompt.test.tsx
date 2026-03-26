// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

import App from '../../App';
import { createLegacyImportPromptState, LEGACY_IMPORT_PROMPT_STORE_KEY } from '../../utils/legacyImport';

const mockUseApp = vi.fn();
const mockUseData = vi.fn();

vi.mock('../../contexts/AppContext', () => ({
  useApp: () => mockUseApp(),
}));

vi.mock('../../contexts/DataContext', () => ({
  useData: () => mockUseData(),
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
  let storeGet: ReturnType<typeof vi.fn>;
  let storeSet: ReturnType<typeof vi.fn>;
  let storeDelete: ReturnType<typeof vi.fn>;
  let addInstallation: ReturnType<typeof vi.fn>;
  let readVersion: ReturnType<typeof vi.fn>;

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
      versions: [{ id: '0.203.175', name: '0.203.175', type: 'release', requiredJavaVersion: 25 }],
      isLoaded: true,
    });

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

    render(<App />);

    await act(async () => {
      onScanResult?.(['/games/StarMade-Classic']);
    });

    expect(await screen.findByText('Import Old StarMade Installations')).toBeInTheDocument();
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

    render(<App />);

    expect(await screen.findByText('Import Old StarMade Installations')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Import Installation/i }));

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
        requiredJavaVersion: 25,
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
});

