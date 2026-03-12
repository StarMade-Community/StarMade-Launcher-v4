import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import type { DataContextType, ManagedItem, Account, Version, DownloadStatus, DownloadProgress } from '../types';

// ─── Store keys ──────────────────────────────────────────────────────────────

const SK_ACCOUNTS          = 'accounts';
const SK_ACTIVE_ACCOUNT_ID = 'activeAccountId';
const SK_INSTALLATIONS     = 'installations';
const SK_SERVERS           = 'servers';
const SK_SELECTED_VER_ID   = 'selectedVersionId';

// ─── Default values ──────────────────────────────────────────────────────────

const DEFAULT_INSTALLATION: Omit<ManagedItem, 'id'> = {
  name: 'New Installation',
  version: '0.203.175',
  type: 'release',
  icon: 'release',
  path: '/home/user/starmade/installations/new-installation',
  lastPlayed: 'Never',
  installed: false,
};

const DEFAULT_SERVER: Omit<ManagedItem, 'id'> = {
  name: 'New Server',
  version: '0.203.175',
  type: 'release',
  icon: 'server',
  path: '/home/user/starmade/servers/new-server',
  lastPlayed: 'Never',
  port: '4242',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Returns true when running inside Electron with the full launcher bridge available. */
const hasStore    = (): boolean => typeof window !== 'undefined' && typeof window.launcher?.store    !== 'undefined';
const hasVersions = (): boolean => typeof window !== 'undefined' && typeof window.launcher?.versions !== 'undefined';
const hasDownload = (): boolean => typeof window !== 'undefined' && typeof window.launcher?.download !== 'undefined';

// ─── Context ─────────────────────────────────────────────────────────────────

const DataContext = createContext<DataContextType | undefined>(undefined);

export const DataProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [accounts,       setAccounts]       = useState<Account[]>([]);
    const [activeAccount,  setActiveAccount]  = useState<Account | null>(null);
    const [installations,  setInstallations]  = useState<ManagedItem[]>([]);
    const [servers,        setServers]        = useState<ManagedItem[]>([]);
    const [versions,       setVersions]       = useState<Version[]>([]);
    const [selectedVersion, setSelectedVersion] = useState<Version | null>(null);
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
            window.launcher.store.get(SK_SELECTED_VER_ID),
        ]).then(([
            storedAccounts,
            storedActiveAccountId,
            storedInstallations,
            storedServers,
            storedSelectedVersionId,
        ]) => {
            // Load accounts
            if (Array.isArray(storedAccounts) && storedAccounts.length > 0) {
                setAccounts(storedAccounts as Account[]);
                
                // Set active account if one was previously selected
                if (typeof storedActiveAccountId === 'string') {
                    const account = (storedAccounts as Account[]).find(a => a.id === storedActiveAccountId);
                    if (account) setActiveAccount(account);
                    // If stored ID not found, leave activeAccount as null (user will see prompt)
                }
            }
            // If no accounts at all, leave empty - user will see "Not Logged In" prompt

            // Load installations
            if (Array.isArray(storedInstallations)) {
                setInstallations(storedInstallations as ManagedItem[]);
            }

            // Load servers
            if (Array.isArray(storedServers)) {
                setServers(storedServers as ManagedItem[]);
            }

            // Selected version ID (we'll resolve it after fetching versions)
            if (typeof storedSelectedVersionId === 'string') {
                // Store for later use after versions are fetched
                setSelectedVersion({ id: storedSelectedVersionId } as Version);
            }

            setIsLoaded(true);
        }).catch(err => {
            console.error('[DataContext] Failed to load from store:', err);
            setIsLoaded(true);
        });
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
                
                // Resolve selected version
                setSelectedVersion(prev => {
                    // If we have a stored ID (from initial load), find it in live versions
                    if (prev?.id && !prev.name) {
                        const stored = (liveVersions as Version[]).find(v => v.id === prev.id);
                        if (stored) return stored;
                    }
                    // Otherwise check if previous selection still exists
                    const still = (liveVersions as Version[]).find(v => v.id === prev?.id);
                    // Fall back to first version
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
        if (isLoaded && hasStore()) {
            // Filter out temporary offline accounts before persisting
            const persistableAccounts = accounts.filter(a => !a.id.startsWith('offline-'));
            window.launcher.store.set(SK_ACCOUNTS, persistableAccounts);
        }
    }, [accounts, isLoaded]);

    useEffect(() => {
        if (isLoaded && hasStore()) {
            // Don't persist offline account IDs
            const accountIdToPersist = activeAccount?.id.startsWith('offline-') ? null : activeAccount?.id ?? null;
            window.launcher.store.set(SK_ACTIVE_ACCOUNT_ID, accountIdToPersist);
        }
    }, [activeAccount, isLoaded]);

    useEffect(() => {
        if (isLoaded && hasStore()) window.launcher.store.set(SK_INSTALLATIONS, installations);
    }, [installations, isLoaded]);

    useEffect(() => {
        if (isLoaded && hasStore()) window.launcher.store.set(SK_SERVERS, servers);
    }, [servers, isLoaded]);


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

    const getInstallationDefaults = () => ({ ...DEFAULT_INSTALLATION, id: Date.now().toString() });
    const getServerDefaults       = () => ({ ...DEFAULT_SERVER,       id: Date.now().toString() });

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
        setAccounts,
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


