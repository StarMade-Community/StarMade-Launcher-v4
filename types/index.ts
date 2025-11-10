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
}

export interface Account {
    id: string;
    name: string;
    uuid?: string;
}

export interface Version {
  id: string;
  name: string;
  type: 'latest' | 'release' | 'dev' | 'archive';
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
    navigate: (page: Page, props?: PageProps) => void;
    openLaunchModal: () => void;
    closeLaunchModal: () => void;
    startLaunching: () => void;
    completeLaunching: () => void;
}

export interface DataContextType {
    // State
    accounts: Account[];
    activeAccount: Account | null;
    installations: ManagedItem[];
    servers: ManagedItem[];
    versions: Version[];
    selectedVersion: Version | null;

    // Actions
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
}
