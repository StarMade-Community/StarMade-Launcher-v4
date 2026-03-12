import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import type { DataContextType, ManagedItem, Account, Version, DownloadStatus, DownloadProgress } from '../types';
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

/** Returns true when running inside Electron with the full launcher bridge available. */
const hasStore    = (): boolean => typeof window !== 'undefined' && typeof window.launcher?.store    !== 'undefined';
const hasVersions = (): boolean => typeof window !== 'undefined' && typeof window.launcher?.versions !== 'undefined';
const hasDownload = (): boolean => typeof window !== 'undefined' && typeof window.launcher?.download !== 'undefined';

// ─── Context ─────────────────────────────────────────────────────────────────

const DataContext = createContext<DataContextType | undefined>(undefined);

export const DataProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [accounts,       setAccounts]       = useState<Account[]>(accountsData);
    const [activeAccount,  setActiveAccount]  = useState<Account | null>(accountsData[0] || null);
    const [installations,  setInstallations]  = useState<ManagedItem[]>(initialInstallationsData);
    const [servers,        setServers]        = useState<ManagedItem[]>(initialServersData);
    const [versions,       setVersions]       = useState<Version[]>(versionsData);
    const [selectedVersion, setSelectedVersion] = useState<Version | null>(versionsData[0] || null);
    const [isLoaded,       setIsLoaded]       = useState(false);
    const [isVersionsLoading, setIsVersionsLoading] = useState(false);
    const [downloadStatuses, setDownloadStatuses] = useState<Record<string, DownloadStatus>>({});

    // ── Load from store on mount ─────────────────────────────────────────────

    useEffect(() => {
        if (!hasStore()) { setIsLoaded(true); return; }

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

    // ── Fetch live versions after store is loaded ────────────────────────────

    const refreshVersions = useCallback(async (invalidate = false) => {
        if (!hasVersions()) return;
        setIsVersionsLoading(true);
        try {
            const liveVersions = await window.launcher.versions.fetch(invalidate);
            if (Array.isArray(liveVersions) && liveVersions.length > 0) {
                setVersions(liveVersions as Version[]);
                // Keep selected version in sync; fall back to first release
                setSelectedVersion(prev => {
                    const still = (liveVersions as Version[]).find(v => v.id === prev?.id && v.type === prev?.type);
                    return still ?? ((liveVersions as Version[])[0] ?? null);
                });
            }
        } catch (err) {
            console.warn('[DataContext] Could not fetch live versions:', err);
        } finally {
            setIsVersionsLoading(false);
        }
    }, []);

    useEffect(() => {
        if (isLoaded) refreshVersions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isLoaded]);

    // ── Subscribe to download events ─────────────────────────────────────────

    useEffect(() => {
        if (!hasDownload()) return;

        const removeProgress = window.launcher.download.onProgress((progress: DownloadProgress) => {
            setDownloadStatuses(prev => ({
                ...prev,
                [progress.installationId]: {
                    state:           progress.phase,
                    percent:         progress.percent,
                    bytesReceived:   progress.bytesReceived,
                    totalBytes:      progress.totalBytes,
                    filesDownloaded: progress.filesDownloaded,
                    totalFiles:      progress.totalFiles,
                    currentFile:     progress.currentFile,
                },
            }));
        });

        const removeComplete = window.launcher.download.onComplete(({ installationId }) => {
            setDownloadStatuses(prev => ({
                ...prev,
                [installationId]: {
                    state: 'complete', percent: 100,
                    bytesReceived: 0, totalBytes: 0,
                    filesDownloaded: 0, totalFiles: 0,
                    currentFile: 'Download complete',
                },
            }));
            // Persist the installed flag so "Play" is shown after restart
            setInstallations(prev =>
                prev.map(i => i.id === installationId ? { ...i, installed: true } : i)
            );
        });

        const removeError = window.launcher.download.onError(({ installationId, error }) => {
            setDownloadStatuses(prev => ({
                ...prev,
                [installationId]: {
                    state: 'error', percent: 0,
                    bytesReceived: 0, totalBytes: 0,
                    filesDownloaded: 0, totalFiles: 0,
                    currentFile: '', error,
                },
            }));
        });

        return () => { removeProgress(); removeComplete(); removeError(); };
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

    const addInstallation    = (item: ManagedItem) => setInstallations(prev => [item, ...prev]);
    const updateInstallation = (item: ManagedItem) => setInstallations(prev => prev.map(i => i.id === item.id ? item : i));
    const deleteInstallation = (id: string)        => setInstallations(prev => prev.filter(i => i.id !== id));

    const addServer    = (item: ManagedItem) => setServers(prev => [item, ...prev]);
    const updateServer = (item: ManagedItem) => setServers(prev => prev.map(s => s.id === item.id ? item : s));
    const deleteServer = (id: string)        => setServers(prev => prev.filter(s => s.id !== id));

    const getInstallationDefaults = () => ({ ...defaultInstallationData, id: Date.now().toString() });
    const getServerDefaults       = () => ({ ...defaultServerData,       id: Date.now().toString() });

    // ── Download actions ──────────────────────────────────────────────────────

    const downloadVersion = useCallback((installationId: string) => {
        if (!hasDownload()) {
            console.warn('[DataContext] Download API not available (not running in Electron).');
            return;
        }

        setInstallations(prev => prev.map(i => i.id === installationId ? i : i)); // noop – keep ref stable

        setDownloadStatuses(prev => ({
            ...prev,
            [installationId]: {
                state: 'checksums', percent: 0,
                bytesReceived: 0, totalBytes: 0,
                filesDownloaded: 0, totalFiles: 0,
                currentFile: 'Starting…',
            },
        }));

        // Resolve installationId → installation → buildPath
        setInstallations(prev => {
            const installation = prev.find(i => i.id === installationId);
            if (!installation) return prev;

            // Use stored buildPath first; fall back to looking it up in the versions list
            let buildPath = installation.buildPath;
            if (!buildPath) {
                setVersions(vPrev => {
                    const v = vPrev.find(v => v.id === installation.version && v.type === installation.type);
                    buildPath = v?.buildPath;
                    return vPrev;
                });
            }

            if (!buildPath) {
                setDownloadStatuses(ds => ({
                    ...ds,
                    [installationId]: {
                        state: 'error', percent: 0,
                        bytesReceived: 0, totalBytes: 0,
                        filesDownloaded: 0, totalFiles: 0,
                        currentFile: '',
                        error: 'Version not available for download — build path unknown.',
                    },
                }));
                return prev;
            }

            window.launcher.download.start(installationId, buildPath, installation.path)
                .catch((err: unknown) => console.error('[DataContext] download.start failed:', err));

            return prev;
        });
    }, []);

    const cancelDownload = useCallback((installationId: string) => {
        if (!hasDownload()) return;
        window.launcher.download.cancel(installationId)
            .catch((err: unknown) => console.error('[DataContext] download.cancel failed:', err));
        setDownloadStatuses(prev => {
            const entry = prev[installationId];
            if (!entry) return prev;
            return { ...prev, [installationId]: { ...entry, state: 'cancelled' } };
        });
    }, []);

    const value: DataContextType = {
        accounts,
        activeAccount,
        installations,
        servers,
        versions,
        selectedVersion,
        downloadStatuses,
        isVersionsLoading,
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
        downloadVersion,
        cancelDownload,
        refreshVersions: () => refreshVersions(true),
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


