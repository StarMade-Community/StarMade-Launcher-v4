// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import Installations from '../../components/pages/Installations';
import type { ManagedItem } from '../../types';

const mockUseData = vi.fn();
const mockUseApp = vi.fn();
let mockClearPageProps: ReturnType<typeof vi.fn>;

vi.mock('../../contexts/DataContext', () => ({
  useData: () => mockUseData(),
}));

vi.mock('../../contexts/AppContext', () => ({
  useApp: () => mockUseApp(),
}));

vi.mock('../../components/common/PageContainer', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('../../components/common/InstallationForm', () => ({
  default: () => null,
}));

vi.mock('../../components/common/DeleteConfirmModal', () => ({
  default: () => null,
}));

vi.mock('../../components/common/BackupConfirmModal', () => ({
  default: () => null,
}));

vi.mock('../../components/common/RestoreBackupModal', () => ({
  default: () => null,
}));

vi.mock('../../components/common/ItemCard', () => ({
  default: ({ item }: { item: ManagedItem }) => <div>{item.name}</div>,
}));

const installationItem: ManagedItem = {
  id: 'inst-1',
  name: 'Alpha Installation',
  version: '0.205.1',
  type: 'release',
  icon: 'release',
  path: '/tmp/inst',
  lastPlayed: 'Never',
  installed: true,
};

const serverItem: ManagedItem = {
  id: 'srv-1',
  name: 'Beta Server',
  version: '0.205.1',
  type: 'release',
  icon: 'server',
  path: '/tmp/server',
  lastPlayed: 'Never',
};

describe('Installations tab switching during downloads', () => {
  beforeEach(() => {
    mockClearPageProps = vi.fn();
    mockUseApp.mockReset();
    mockUseApp.mockReturnValue({
      openLaunchModal: vi.fn(),
      navigate: vi.fn(),
      clearPageProps: mockClearPageProps,
    });
  });

  it('does not force the initial tab after user switches tabs and data updates', () => {
    const dataState = {
      installations: [installationItem],
      servers: [serverItem],
      playTimeByInstallationMs: { 'inst-1': 0 },
      totalInstallPlayTimeMs: 0,
      downloadStatuses: {
        'srv-1': {
          progress: 2,
          bytesDownloaded: 10,
          totalBytes: 100,
          filesDownloaded: 1,
          totalFiles: 10,
          currentFile: 'server/data.bin',
        },
      },
      addInstallation: vi.fn(),
      updateInstallation: vi.fn(),
      deleteInstallation: vi.fn(),
      addServer: vi.fn(),
      updateServer: vi.fn(),
      deleteServer: vi.fn(),
      setSelectedServerId: vi.fn(),
      downloadVersion: vi.fn(),
      cancelDownload: vi.fn(),
      getInstallationDefaults: vi.fn(() => installationItem),
      getServerDefaults: vi.fn(() => serverItem),
    };

    mockUseData.mockImplementation(() => dataState);

    const { rerender } = render(<Installations initialTab="servers" />);

    expect(screen.getByText('Beta Server')).toBeInTheDocument();
    expect(screen.queryByText('Alpha Installation')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Installations' }));

    expect(screen.getByText('Alpha Installation')).toBeInTheDocument();
    expect(screen.queryByText('Beta Server')).not.toBeInTheDocument();

    dataState.downloadStatuses['srv-1'] = {
      progress: 35,
      bytesDownloaded: 35,
      totalBytes: 100,
      filesDownloaded: 4,
      totalFiles: 10,
      currentFile: 'server/chunks/part-4.bin',
    };

    rerender(<Installations initialTab="servers" />);

    expect(screen.getByText('Alpha Installation')).toBeInTheDocument();
    expect(screen.queryByText('Beta Server')).not.toBeInTheDocument();

    expect(mockClearPageProps).toHaveBeenCalledTimes(1);
  });
});

