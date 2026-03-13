export type ItemType = 'latest' | 'release' | 'dev' | 'archive' | 'pre';

// ─── Session types ────────────────────────────────────────────────────────────

/**
 * Represents a single play session – either launching a singleplayer world or
 * connecting to a multiplayer server from within an installation.
 *
 * Stored in the launcher's persistent store for the "last played" display and
 * for pinned quick-access sessions.  The game itself may also write a
 * `launcher-session.json` file into the installation directory; the launcher
 * reads that file on startup to populate / update this record.
 */
export interface PlaySession {
  /** Unique identifier for this session record. */
  id: string;
  /** ID of the ManagedItem installation this session belongs to. */
  installationId: string;
  /** Display name of the installation (copied so sessions survive renames). */
  installationName: string;
  /** Filesystem path to the installation directory. */
  installationPath: string;
  /** StarMade version string of the installation. */
  installationVersion: string;
  /** Whether this was a singleplayer world or a multiplayer server connection. */
  sessionType: 'singleplayer' | 'multiplayer';
  /**
   * Server address passed via `-uplink`.
   * `'localhost'` for singleplayer worlds, the remote IP for multiplayer.
   */
  serverAddress: string;
  /** Server port (typically 4242). */
  serverPort: number;
  /** Enabled mod IDs to be passed as a comma-separated list after `-uplink`. */
  modIds?: string[];
  /** ISO 8601 timestamp of the last time this session was launched. */
  timestamp: string;
}

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
  // ── Per-installation launch settings ──────────────────────────────────────
  /** Minimum JVM heap in MB (passed as -Xms). */
  minMemory?: number;
  /** Maximum JVM heap in MB (passed as -Xmx). */
  maxMemory?: number;
  /** Extra JVM arguments (must NOT include -Xms/-Xmx; those come from min/maxMemory). */
  jvmArgs?: string;
  /** Override path to the java executable for this installation. */
  customJavaPath?: string;
}

export interface Account {
    id: string;
    name: string;
    /** Optional user-defined display name shown in place of the registry username. */
    displayName?: string;
    uuid?: string;
    /** True for local/offline-only accounts (no registry token). */
    isGuest?: boolean;
}

// ─── Auth types ───────────────────────────────────────────────────────────────

export type LoginResult =
  | {
      success: true;
      accountId: string;
      username: string;
      uuid?: string;
      expiresIn: number;
    }
  | { success: false; error: string };

export interface RegisterResult {
  success: boolean;
  error?: string;
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

export type ServerLifecycleState = 'starting' | 'running' | 'stopping' | 'stopped' | 'error';
export type ServerLogLevel = 'INFO' | 'WARNING' | 'ERROR' | 'FATAL' | 'DEBUG' | 'stdout' | 'stderr';

export type Page = 'Play' | 'Installations' | 'News' | 'Settings' | 'ServerPanel';
export type SettingsSection = 'launcher' | 'accounts' | 'about' | 'defaults';
export type InstallationsTab = 'installations' | 'servers';

export type PageProps = 
    | { initialSection?: SettingsSection } 
    | { initialTab?: InstallationsTab }
    | { serverId?: string; serverName?: string }
    | {};

// Context Types
/** Optional session arguments that override the default launch target. */
export interface SessionLaunchArgs {
  /** Server address for `-uplink` (e.g. `'localhost'` for singleplayer). */
  uplink?: string;
  /** Port for the `-uplink` server. Defaults to 4242. */
  uplinkPort?: number;
  /** Enabled mod IDs to pass as a comma-separated list after `-uplink`. */
  modIds?: string[];
}

export interface AppContextType {
    activePage: Page;
    pageProps: PageProps;
    isLaunchModalOpen: boolean;
    isLaunching: boolean;
    launchError: string | null;
    /** Human-readable status shown in the launch button during pre-launch steps (e.g. "Downloading Java 8…"). */
    launchStatus: string | null;
    logViewerOpen: boolean;
    logViewerInstallation: ManagedItem | null;
    navigate: (page: Page, props?: PageProps) => void;
    openLaunchModal: (installation?: ManagedItem, sessionArgs?: SessionLaunchArgs) => void | Promise<void>;
    closeLaunchModal: () => void;
    startLaunching: () => void;
    /** Stop all currently-running game processes and then launch. */
    startLaunchingAndTerminate: () => void;
    completeLaunching: () => void;
    openLogViewer: (installation: ManagedItem) => void;
    closeLogViewer: () => void;
    /** Launch a previously recorded play session directly (bypasses install picker). */
    launchSession: (session: PlaySession) => void;
}

export interface DataContextType {
    // State
    accounts: Account[];
    activeAccount: Account | null;
    installations: ManagedItem[];
    servers: ManagedItem[];
    selectedServerId: string | null;
    selectedServer: ManagedItem | null;
    versions: Version[];
    selectedVersion: Version | null;
    /** Keyed by installation id. Only present while a download is active or has recently finished. */
    downloadStatuses: Record<string, DownloadStatus>;
    /** True while the live version manifest is being fetched. */
    isVersionsLoading: boolean;

    // Installation / server mutations
    setActiveAccount: (account: Account | null) => void;
    setAccounts: (accounts: Account[]) => void;
    /** Log in to the StarMade registry and add the account (main-process call). */
    loginAccount: (username: string, password: string, displayName?: string) => Promise<LoginResult>;
    /** Log out an account, clear its tokens, and remove it from the accounts list. */
    logoutAccount: (accountId: string) => Promise<void>;
    /** Register a new StarMade registry account (main-process call). */
    registerAccount: (username: string, email: string, password: string, subscribeToNewsletter: boolean) => Promise<RegisterResult>;
    /** Add an offline/guest account that plays without registry authentication. */
    addGuestAccount: (playerName: string) => void;
    setSelectedVersion: (version: Version) => void;
    addInstallation: (item: ManagedItem) => void;
    updateInstallation: (item: ManagedItem) => void;
    deleteInstallation: (id: string) => void;
    addServer: (item: ManagedItem) => void;
    updateServer: (item: ManagedItem) => void;
    deleteServer: (id: string) => void;
    setSelectedServerId: (serverId: string | null) => void;
    getInstallationDefaults: () => ManagedItem;
    getServerDefaults: () => ManagedItem;

    // Download actions
    downloadVersion: (installationId: string) => void;
    cancelDownload: (installationId: string) => void;
    refreshVersions: () => Promise<void>;

    // Session actions
    /** The most recently played session (across all installations). */
    lastPlayedSession: PlaySession | null;
    /** Up to 4 sessions pinned by the user for quick access. */
    pinnedSessions: PlaySession[];
    /** Pin a session for quick access (max 4; oldest pin is dropped when full). */
    pinSession: (session: PlaySession) => void;
    /** Unpin a previously pinned session. */
    unpinSession: (sessionId: string) => void;
    /** Record a completed play session as the new last-played entry. */
    recordSession: (session: PlaySession) => void;
}
