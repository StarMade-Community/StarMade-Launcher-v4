import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import type { DataContextType, ManagedItem, Account, Version, DownloadStatus, DownloadProgress, LoginResult, RegisterResult, PlaySession, PlayTimeTotals } from '../types';

// ─── Store keys ──────────────────────────────────────────────────────────────

const SK_ACCOUNTS          = 'accounts';
const SK_ACTIVE_ACCOUNT_ID = 'activeAccountId';
const SK_INSTALLATIONS     = 'installations';
const SK_SELECTED_INSTALLATION_ID = 'selectedInstallationId';
const SK_SERVERS           = 'servers';
const SK_SELECTED_SERVER_ID = 'selectedServerId';
const SK_SELECTED_VER_ID   = 'selectedVersionId';
const SK_PINNED_SESSIONS   = 'pinnedSessions';
const SK_LAST_PLAYED       = 'lastPlayedSession';

// ─── Default values ──────────────────────────────────────────────────────────

const DEFAULT_INSTALLATION: Omit<ManagedItem, 'id'> = {
  name: 'New Installation',
  version: '0.203.175',
  type: 'release',
  icon: 'release',
  path: '',
  lastPlayed: 'Never',
  installed: false,
};

const DEFAULT_SERVER: Omit<ManagedItem, 'id'> = {
  name: 'New Server',
  version: '0.203.175',
  type: 'release',
  icon: 'server',
  path: '',
  lastPlayed: 'Never',
  installed: false,
  port: '4242',
    maxPlayers: 32,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Returns true when running inside Electron with the full launcher bridge available. */
const hasStore    = (): boolean => typeof window !== 'undefined' && typeof window.launcher?.store    !== 'undefined';
const hasVersions = (): boolean => typeof window !== 'undefined' && typeof window.launcher?.versions !== 'undefined';
const hasDownload = (): boolean => typeof window !== 'undefined' && typeof window.launcher?.download !== 'undefined';
const hasAuth     = (): boolean => typeof window !== 'undefined' && typeof window.launcher?.auth     !== 'undefined';
const hasGame     = (): boolean => typeof window !== 'undefined' && typeof window.launcher?.game     !== 'undefined';

const areDownloadStatusesEqual = (a?: DownloadStatus, b?: DownloadStatus): boolean => {
    if (!a || !b) return false;
    return (
        a.state === b.state &&
        a.percent === b.percent &&
        a.bytesReceived === b.bytesReceived &&
        a.totalBytes === b.totalBytes &&
        a.filesDownloaded === b.filesDownloaded &&
        a.totalFiles === b.totalFiles &&
        a.currentFile === b.currentFile &&
        a.error === b.error
    );
};

// ─── Context ─────────────────────────────────────────────────────────────────

const DataContext = createContext<DataContextType | undefined>(undefined);

export const DataProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [accounts,       setAccounts]       = useState<Account[]>([]);
    const [activeAccount,  setActiveAccount]  = useState<Account | null>(null);
    const [installations,  setInstallations]  = useState<ManagedItem[]>([]);
    const [selectedInstallationId, setSelectedInstallationId] = useState<string | null>(null);
    const [servers,        setServers]        = useState<ManagedItem[]>([]);
    const [selectedServerId, setSelectedServerId] = useState<string | null>(null);
    const [versions,       setVersions]       = useState<Version[]>([]);
    const [selectedVersion, setSelectedVersion] = useState<Version | null>(null);
    const [isLoaded,       setIsLoaded]       = useState(false);
    const [isVersionsLoading, setIsVersionsLoading] = useState(false);
    const [downloadStatuses, setDownloadStatuses] = useState<Record<string, DownloadStatus>>({});
    const [pinnedSessions,   setPinnedSessions]   = useState<PlaySession[]>([]);
    const [lastPlayedSession, setLastPlayedSession] = useState<PlaySession | null>(null);
    const [playTimeByInstallationMs, setPlayTimeByInstallationMs] = useState<Record<string, number>>({});
    const [totalInstallPlayTimeMs, setTotalInstallPlayTimeMs] = useState(0);

    // ── Load from store on mount ─────────────────────────────────────────────

    useEffect(() => {
        if (!hasStore()) { setIsLoaded(true); return; }

        Promise.all([
            window.launcher.store.get(SK_ACCOUNTS),
            window.launcher.store.get(SK_ACTIVE_ACCOUNT_ID),
            window.launcher.store.get(SK_INSTALLATIONS),
            window.launcher.store.get(SK_SELECTED_INSTALLATION_ID),
            window.launcher.store.get(SK_SERVERS),
            window.launcher.store.get(SK_SELECTED_SERVER_ID),
            window.launcher.store.get(SK_SELECTED_VER_ID),
            window.launcher.store.get(SK_PINNED_SESSIONS),
            window.launcher.store.get(SK_LAST_PLAYED),
        ]).then(([
            storedAccounts,
            storedActiveAccountId,
            storedInstallations,
            storedSelectedInstallationId,
            storedServers,
            storedSelectedServerId,
            storedSelectedVersionId,
            storedPinnedSessions,
            storedLastPlayed,
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

            if (typeof storedSelectedInstallationId === 'string') {
                setSelectedInstallationId(storedSelectedInstallationId);
            }

            // Load servers
            if (Array.isArray(storedServers)) {
                setServers(storedServers as ManagedItem[]);
            }

            if (typeof storedSelectedServerId === 'string') {
                setSelectedServerId(storedSelectedServerId);
            }

            // Selected version ID (we'll resolve it after fetching versions)
            if (typeof storedSelectedVersionId === 'string') {
                // Store for later use after versions are fetched
                setSelectedVersion({ id: storedSelectedVersionId } as Version);
            }

            // Load pinned sessions
            if (Array.isArray(storedPinnedSessions)) {
                setPinnedSessions(storedPinnedSessions as PlaySession[]);
            }

            // Load last played session
            if (storedLastPlayed && typeof storedLastPlayed === 'object' && !Array.isArray(storedLastPlayed)) {
                setLastPlayedSession(storedLastPlayed as PlaySession);
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

    const refreshPlayTime = useCallback(async (): Promise<void> => {
        if (!hasGame() || !window.launcher.game.getPlayTimeTotals) return;

        try {
            const installationIds = installations.map(installation => installation.id);
            const payload = await window.launcher.game.getPlayTimeTotals(installationIds) as PlayTimeTotals;
            setPlayTimeByInstallationMs(payload?.byInstallationId ?? {});
            setTotalInstallPlayTimeMs(payload?.totalMs ?? 0);
        } catch (err) {
            console.warn('[DataContext] Could not refresh play-time totals:', err);
        }
    }, [installations]);

    useEffect(() => {
        if (!isLoaded) return;
        void refreshPlayTime();

        const interval = setInterval(() => {
            void refreshPlayTime();
        }, 15_000);

        return () => clearInterval(interval);
    }, [isLoaded, refreshPlayTime]);

    // ── Subscribe to download events ─────────────────────────────────────────

    useEffect(() => {
        if (!hasDownload()) return;

        const removeProgress = window.launcher.download.onProgress((progress: DownloadProgress) => {
            const nextStatus: DownloadStatus = {
                state:           progress.phase,
                percent:         progress.percent,
                bytesReceived:   progress.bytesReceived,
                totalBytes:      progress.totalBytes,
                filesDownloaded: progress.filesDownloaded,
                totalFiles:      progress.totalFiles,
                currentFile:     progress.currentFile,
            };

            setDownloadStatuses(prev => {
                const current = prev[progress.installationId];
                if (areDownloadStatusesEqual(current, nextStatus)) {
                    return prev;
                }
                return {
                    ...prev,
                    [progress.installationId]: nextStatus,
                };
            });
        });

        const removeComplete = window.launcher.download.onComplete(({ installationId }) => {
            const nextStatus: DownloadStatus = {
                state: 'complete', percent: 100,
                bytesReceived: 0, totalBytes: 0,
                filesDownloaded: 0, totalFiles: 0,
                currentFile: 'Download complete',
            };

            setDownloadStatuses(prev => {
                const current = prev[installationId];
                if (areDownloadStatusesEqual(current, nextStatus)) {
                    return prev;
                }
                return {
                    ...prev,
                    [installationId]: nextStatus,
                };
            });
            // Persist the installed flag so "Play" is shown after restart
            setInstallations(prev =>
                prev.map(i => i.id === installationId ? { ...i, installed: true } : i)
            );
            setServers(prev =>
                prev.map(s => s.id === installationId ? { ...s, installed: true } : s)
            );
        });

        const removeError = window.launcher.download.onError(({ installationId, error }) => {
            const nextStatus: DownloadStatus = {
                state: 'error', percent: 0,
                bytesReceived: 0, totalBytes: 0,
                filesDownloaded: 0, totalFiles: 0,
                currentFile: '', error,
            };

            setDownloadStatuses(prev => {
                const current = prev[installationId];
                if (areDownloadStatusesEqual(current, nextStatus)) {
                    return prev;
                }
                return {
                    ...prev,
                    [installationId]: nextStatus,
                };
            });
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
        if (isLoaded && hasStore()) window.launcher.store.set(SK_SELECTED_INSTALLATION_ID, selectedInstallationId);
    }, [selectedInstallationId, isLoaded]);

    useEffect(() => {
        if (isLoaded && hasStore()) window.launcher.store.set(SK_SERVERS, servers);
    }, [servers, isLoaded]);

    useEffect(() => {
        if (isLoaded && hasStore()) window.launcher.store.set(SK_SELECTED_SERVER_ID, selectedServerId);
    }, [selectedServerId, isLoaded]);


    useEffect(() => {
        if (isLoaded && hasStore()) window.launcher.store.set(SK_SELECTED_VER_ID, selectedVersion?.id ?? null);
    }, [selectedVersion, isLoaded]);

    useEffect(() => {
        if (isLoaded && hasStore()) window.launcher.store.set(SK_PINNED_SESSIONS, pinnedSessions);
    }, [pinnedSessions, isLoaded]);

    useEffect(() => {
        if (isLoaded && hasStore()) window.launcher.store.set(SK_LAST_PLAYED, lastPlayedSession);
    }, [lastPlayedSession, isLoaded]);

    // Keep the selected server id valid as the server list changes.
    useEffect(() => {
        if (!isLoaded) return;
        setSelectedServerId(prev => {
            if (prev && servers.some(server => server.id === prev)) {
                return prev;
            }
            return servers[0]?.id ?? null;
        });
    }, [servers, isLoaded]);

    // Keep the selected installation id valid as the installation list changes.
    useEffect(() => {
        if (!isLoaded) return;
        setSelectedInstallationId(prev => {
            const installedInstallations = installations.filter(installation => installation.installed !== false);

            if (prev && installedInstallations.some(installation => installation.id === prev)) {
                return prev;
            }

            const lastPlayedInstallationId = lastPlayedSession?.installationId;
            if (lastPlayedInstallationId && installedInstallations.some(installation => installation.id === lastPlayedInstallationId)) {
                return lastPlayedInstallationId;
            }

            return installedInstallations[0]?.id ?? null;
        });
    }, [installations, isLoaded, lastPlayedSession]);

    // ── Mutations ────────────────────────────────────────────────────────────

    const addInstallation    = (item: ManagedItem) => setInstallations(prev => [item, ...prev]);
    const updateInstallation = (item: ManagedItem) => setInstallations(prev => prev.map(i => i.id === item.id ? item : i));
    const deleteInstallation = (id: string)        => setInstallations(prev => prev.filter(i => i.id !== id));

    const addServer    = (item: ManagedItem) => setServers(prev => [item, ...prev]);
    const updateServer = (item: ManagedItem) => setServers(prev => prev.map(s => s.id === item.id ? item : s));
    const deleteServer = (id: string)        => setServers(prev => prev.filter(s => s.id !== id));

    const getInstallationDefaults = () => ({ ...DEFAULT_INSTALLATION, id: Date.now().toString() });
    const getServerDefaults       = () => ({ ...DEFAULT_SERVER,       id: Date.now().toString() });

    const selectedServer = selectedServerId
        ? (servers.find(server => server.id === selectedServerId) ?? null)
        : (servers[0] ?? null);

    // ── Download actions ──────────────────────────────────────────────────────

    const downloadVersion = useCallback((itemId: string) => {
        if (!hasDownload()) {
            console.warn('[DataContext] Download API not available (not running in Electron).');
            return;
        }

        const nextStartStatus: DownloadStatus = {
            state: 'checksums', percent: 0,
            bytesReceived: 0, totalBytes: 0,
            filesDownloaded: 0, totalFiles: 0,
            currentFile: 'Starting…',
        };
        setDownloadStatuses(prev => {
            const current = prev[itemId];
            if (areDownloadStatusesEqual(current, nextStartStatus)) {
                return prev;
            }
            return {
                ...prev,
                [itemId]: nextStartStatus,
            };
        });

        // Helper: resolve buildPath and start the download for the given item
        const beginDownload = (item: ManagedItem) => {
            let buildPath = item.buildPath;
            if (!buildPath) {
                setVersions(vPrev => {
                    const v = vPrev.find(v => v.id === item.version && v.type === item.type);
                    buildPath = v?.buildPath;
                    return vPrev;
                });
            }

            if (!buildPath) {
                const nextErrorStatus: DownloadStatus = {
                    state: 'error', percent: 0,
                    bytesReceived: 0, totalBytes: 0,
                    filesDownloaded: 0, totalFiles: 0,
                    currentFile: '',
                    error: 'Version not available for download — build path unknown.',
                };
                setDownloadStatuses(ds => {
                    const current = ds[itemId];
                    if (areDownloadStatusesEqual(current, nextErrorStatus)) {
                        return ds;
                    }
                    return {
                        ...ds,
                        [itemId]: nextErrorStatus,
                    };
                });
                return;
            }

            window.launcher.download.start(itemId, buildPath, item.path)
                .catch((err: unknown) => console.error('[DataContext] download.start failed:', err));
        };

        // Search installations first, then servers; stop at first match
        let started = false;

        setInstallations(prev => {
            const item = prev.find(i => i.id === itemId);
            if (item && !started) { started = true; beginDownload(item); }
            return prev;
        });

        setServers(prev => {
            const item = prev.find(s => s.id === itemId);
            if (item && !started) { started = true; beginDownload(item); }
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
            const nextStatus: DownloadStatus = { ...entry, state: 'cancelled' };
            if (areDownloadStatusesEqual(entry, nextStatus)) {
                return prev;
            }
            return { ...prev, [installationId]: nextStatus };
        });
    }, []);

    // ── Session actions ───────────────────────────────────────────────────────

    const pinSession = useCallback((session: PlaySession) => {
        setPinnedSessions(prev => {
            // Remove existing entry for the same session id, then prepend (max 4).
            const filtered = prev.filter(s => s.id !== session.id);
            return [session, ...filtered].slice(0, 4);
        });
    }, []);

    const unpinSession = useCallback((sessionId: string) => {
        setPinnedSessions(prev => prev.filter(s => s.id !== sessionId));
    }, []);

    const recordSession = useCallback((session: PlaySession) => {
        setLastPlayedSession(session);
        // If this session target is already pinned, refresh its timestamp so
        // the card shows the correct "time ago" on the next render.
        setPinnedSessions(prev =>
            prev.map(s => s.id === session.id ? { ...s, timestamp: session.timestamp } : s)
        );
    }, []);

    // ── Auth actions ─────────────────────────────────────────────────────────

    const loginAccount = useCallback(async (username: string, password: string, displayName?: string): Promise<LoginResult> => {
        if (!hasAuth()) return { success: false, error: 'Auth API not available.' };

        const raw = await window.launcher.auth.login(username, password);
        if (raw.success && raw.accountId && raw.username) {
            const newAccount: Account = {
                id:   raw.accountId,
                name: raw.username,
                uuid: raw.uuid,
                ...(displayName?.trim() ? { displayName: displayName.trim() } : {}),
            };
            setAccounts(prev => {
                // Replace if already exists (re-login), otherwise prepend
                if (prev.some(a => a.id === newAccount.id)) {
                    return prev.map(a => a.id === newAccount.id ? newAccount : a);
                }
                return [newAccount, ...prev];
            });
            setActiveAccount(newAccount);
            return { success: true, accountId: raw.accountId, username: raw.username, uuid: raw.uuid, expiresIn: raw.expiresIn ?? 3600 };
        }
        return { success: false, error: raw.error ?? 'Login failed.' };
    }, []);

    const logoutAccount = useCallback(async (accountId: string): Promise<void> => {
        if (hasAuth()) {
            await window.launcher.auth.logout(accountId).catch(() => {});
        }
        setAccounts(prev => prev.filter(a => a.id !== accountId));
        setActiveAccount(prev => (prev?.id === accountId ? null : prev));
    }, []);

    const registerAccount = useCallback(async (
        username: string,
        email: string,
        password: string,
        subscribeToNewsletter: boolean,
    ): Promise<RegisterResult> => {
        if (!hasAuth()) return { success: false, error: 'Auth API not available.' };
        return window.launcher.auth.register(username, email, password, subscribeToNewsletter);
    }, []);

    const addGuestAccount = useCallback((playerName: string): void => {
        const trimmed = playerName.trim();
        if (!trimmed) return;
        const guestAccount: Account = {
            id:      `offline-${Date.now()}`,
            name:    trimmed,
            isGuest: true,
        };
        setAccounts(prev => [guestAccount, ...prev]);
        setActiveAccount(guestAccount);
    }, []);

    const value: DataContextType = {
        accounts,
        activeAccount,
        installations,
        servers,
        selectedInstallationId,
        selectedServerId,
        selectedServer,
        versions,
        selectedVersion,
        downloadStatuses,
        isVersionsLoading,
        setActiveAccount,
        setAccounts,
        loginAccount,
        logoutAccount,
        registerAccount,
        addGuestAccount,
        setSelectedVersion,
        addInstallation,
        updateInstallation,
        deleteInstallation,
        addServer,
        updateServer,
        deleteServer,
        setSelectedInstallationId,
        setSelectedServerId,
        getInstallationDefaults,
        getServerDefaults,
        downloadVersion,
        cancelDownload,
        refreshVersions: () => refreshVersions(true),
        lastPlayedSession,
        pinnedSessions,
        playTimeByInstallationMs,
        totalInstallPlayTimeMs,
        pinSession,
        unpinSession,
        recordSession,
        refreshPlayTime,
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


