export type ItemType = 'latest' | 'release' | 'dev' | 'archive' | 'pre';

export interface ManagedItem {
  id: string;
  name: string;
  version: string;
  type: ItemType;
  icon: string;
  path: string;
  lastPlayed: string;
  port?: string;
  /** CDN build path (e.g. `./build/starmade-build_20231020_123456`). Set when a version is chosen from the live manifest. */
  buildPath?: string;
  /** True once the game files have been downloaded and verified. Undefined for legacy/mock items (treated as installed). */
  installed?: boolean;
  /** Which Java major version this installation requires (8 for < 0.3.x, 25 for >= 0.3.x). */
  requiredJavaVersion?: 8 | 25;
}

export interface Account {
    id: string;
    name: string;
    uuid?: string;
}

export interface Version {
  id: string;
  name: string;
  type: 'release' | 'dev' | 'pre' | 'archive';
  /** Build timestamp from the manifest (e.g. `20231020_123456`). */
  build?: string;
  /** Server-side build path (e.g. `./build/starmade-build_20231020_123456`). */
  buildPath?: string;
  /** Which Java major version this StarMade version requires (8 for < 0.3.x, 25 for >= 0.3.x). */
  requiredJavaVersion?: 8 | 25;
}

// ─── Download types ───────────────────────────────────────────────────────────

export type DownloadPhase = 'checksums' | 'downloading' | 'complete' | 'error' | 'cancelled';

/** Live progress snapshot pushed by the main process during a download. */
export interface DownloadProgress {
  installationId: string;
  phase: 'checksums' | 'downloading';
  percent: number;
  bytesReceived: number;
  totalBytes: number;
  filesDownloaded: number;
  totalFiles: number;
  currentFile: string;
}

/** Aggregated download state kept in DataContext for each installation. */
export interface DownloadStatus {
  state: DownloadPhase;
  percent: number;
  bytesReceived: number;
  totalBytes: number;
  filesDownloaded: number;
  totalFiles: number;
  currentFile: string;
  error?: string;
}

export type Page = 'Play' | 'Installations' | 'News' | 'Settings';
export type SettingsSection = 'launcher' | 'accounts' | 'about' | 'defaults';
export type InstallationsTab = 'installations' | 'servers';

export type PageProps = 
    | { initialSection?: SettingsSection } 
    | { initialTab?: InstallationsTab }
    | {};

// Context Types
export interface AppContextType {
    activePage: Page;
    pageProps: PageProps;
    isLaunchModalOpen: boolean;
    isLaunching: boolean;
    launchError: string | null;
    logViewerOpen: boolean;
    logViewerInstallation: ManagedItem | null;
    navigate: (page: Page, props?: PageProps) => void;
    openLaunchModal: (installation?: ManagedItem) => void;
    closeLaunchModal: () => void;
    startLaunching: () => void;
    completeLaunching: () => void;
    openLogViewer: (installation: ManagedItem) => void;
    closeLogViewer: () => void;
}

export interface DataContextType {
    // State
    accounts: Account[];
    activeAccount: Account | null;
    installations: ManagedItem[];
    servers: ManagedItem[];
    versions: Version[];
    selectedVersion: Version | null;
    /** Keyed by installation id. Only present while a download is active or has recently finished. */
    downloadStatuses: Record<string, DownloadStatus>;
    /** True while the live version manifest is being fetched. */
    isVersionsLoading: boolean;

    // Installation / server mutations
    setActiveAccount: (account: Account) => void;
    setSelectedVersion: (version: Version) => void;
    addInstallation: (item: ManagedItem) => void;
    updateInstallation: (item: ManagedItem) => void;
    deleteInstallation: (id: string) => void;
    addServer: (item: ManagedItem) => void;
    updateServer: (item: ManagedItem) => void;
    deleteServer: (id: string) => void;
    getInstallationDefaults: () => ManagedItem;
    getServerDefaults: () => ManagedItem;

    // Download actions
    downloadVersion: (installationId: string) => void;
    cancelDownload: (installationId: string) => void;
    refreshVersions: () => Promise<void>;
}
