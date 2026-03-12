import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import type { DataContextType, ManagedItem, Account, Version } from '../types';
import { 
    accountsData, 
    versionsData, 
    initialInstallationsData, 
    initialServersData,
    defaultInstallationData,
    defaultServerData
} from '../data/mockData';

// ─── Store keys ──────────────────────────────────────────────────────────────

const SK_ACCOUNTS          = 'accounts';
const SK_ACTIVE_ACCOUNT_ID = 'activeAccountId';
const SK_INSTALLATIONS     = 'installations';
const SK_SERVERS           = 'servers';
const SK_VERSIONS          = 'versions';
const SK_SELECTED_VER_ID   = 'selectedVersionId';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Returns true when running inside Electron with the store bridge available. */
const hasStore = (): boolean =>
  typeof window !== 'undefined' && typeof window.launcher?.store !== 'undefined';

// ─── Context ─────────────────────────────────────────────────────────────────

const DataContext = createContext<DataContextType | undefined>(undefined);

export const DataProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [accounts, setAccounts] = useState<Account[]>(accountsData);
    const [activeAccount, setActiveAccount] = useState<Account | null>(accountsData[0] || null);
    
    const [installations, setInstallations] = useState<ManagedItem[]>(initialInstallationsData);
    const [servers, setServers] = useState<ManagedItem[]>(initialServersData);
    
    const [versions, setVersions] = useState<Version[]>(versionsData);
    const [selectedVersion, setSelectedVersion] = useState<Version | null>(versionsData[0] || null);

    /** Becomes true once the initial store-load attempt has completed. */
    const [isLoaded, setIsLoaded] = useState(false);

    // ── Load from store on mount ─────────────────────────────────────────────

    useEffect(() => {
        if (!hasStore()) {
            setIsLoaded(true);
            return;
        }

        Promise.all([
            window.launcher.store.get(SK_ACCOUNTS),
            window.launcher.store.get(SK_ACTIVE_ACCOUNT_ID),
            window.launcher.store.get(SK_INSTALLATIONS),
            window.launcher.store.get(SK_SERVERS),
            window.launcher.store.get(SK_VERSIONS),
            window.launcher.store.get(SK_SELECTED_VER_ID),
        ]).then(([
            storedAccounts,
            storedActiveAccountId,
            storedInstallations,
            storedServers,
            storedVersions,
            storedSelectedVersionId,
        ]) => {
            const accts = Array.isArray(storedAccounts) ? (storedAccounts as Account[]) : accountsData;
            const vers  = Array.isArray(storedVersions) ? (storedVersions as Version[]) : versionsData;

            if (Array.isArray(storedAccounts))      setAccounts(accts);
            if (Array.isArray(storedInstallations)) setInstallations(storedInstallations as ManagedItem[]);
            if (Array.isArray(storedServers))       setServers(storedServers as ManagedItem[]);
            if (Array.isArray(storedVersions))      setVersions(vers);

            if (typeof storedActiveAccountId === 'string') {
                const account = accts.find(a => a.id === storedActiveAccountId);
                if (account) setActiveAccount(account);
            }

            if (typeof storedSelectedVersionId === 'string') {
                const version = vers.find(v => v.id === storedSelectedVersionId);
                if (version) setSelectedVersion(version);
            }

            setIsLoaded(true);
        }).catch(() => setIsLoaded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── Persist on change (only after initial load) ──────────────────────────

    useEffect(() => {
        if (isLoaded && hasStore()) window.launcher.store.set(SK_ACCOUNTS, accounts);
    }, [accounts, isLoaded]);

    useEffect(() => {
        if (isLoaded && hasStore()) window.launcher.store.set(SK_ACTIVE_ACCOUNT_ID, activeAccount?.id ?? null);
    }, [activeAccount, isLoaded]);

    useEffect(() => {
        if (isLoaded && hasStore()) window.launcher.store.set(SK_INSTALLATIONS, installations);
    }, [installations, isLoaded]);

    useEffect(() => {
        if (isLoaded && hasStore()) window.launcher.store.set(SK_SERVERS, servers);
    }, [servers, isLoaded]);

    useEffect(() => {
        if (isLoaded && hasStore()) window.launcher.store.set(SK_VERSIONS, versions);
    }, [versions, isLoaded]);

    useEffect(() => {
        if (isLoaded && hasStore()) window.launcher.store.set(SK_SELECTED_VER_ID, selectedVersion?.id ?? null);
    }, [selectedVersion, isLoaded]);

    // ── Mutations ────────────────────────────────────────────────────────────

    const addInstallation = (item: ManagedItem) => setInstallations(prev => [item, ...prev]);
    const updateInstallation = (item: ManagedItem) => setInstallations(prev => prev.map(i => i.id === item.id ? item : i));
    const deleteInstallation = (id: string) => setInstallations(prev => prev.filter(i => i.id !== id));
    
    const addServer = (item: ManagedItem) => setServers(prev => [item, ...prev]);
    const updateServer = (item: ManagedItem) => setServers(prev => prev.map(s => s.id === item.id ? item : s));
    const deleteServer = (id: string) => setServers(prev => prev.filter(s => s.id !== id));

    const getInstallationDefaults = () => ({ ...defaultInstallationData, id: Date.now().toString() });
    const getServerDefaults = () => ({ ...defaultServerData, id: Date.now().toString() });

    const value = {
        accounts,
        activeAccount,
        installations,
        servers,
        versions,
        selectedVersion,
        setActiveAccount,
        setSelectedVersion,
        addInstallation,
        updateInstallation,
        deleteInstallation,
        addServer,
        updateServer,
        deleteServer,
        getInstallationDefaults,
        getServerDefaults,
    };

    return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export const useData = (): DataContextType => {
    const context = useContext(DataContext);
    if (context === undefined) {
        throw new Error('useData must be used within a DataProvider');
    }
    return context;
}

