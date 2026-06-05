import React, { createContext, useContext, useState, useCallback, useMemo, useEffect, useRef, ReactNode } from 'react';
import type { AppContextType, Page, PageProps, ManagedItem, PlaySession, SessionLaunchArgs, LauncherSettingsData } from '../types';
import { useData } from './DataContext';

const AppContext = createContext<AppContextType | undefined>(undefined);

const LAUNCHER_SETTINGS_KEY = 'launcherSettings';
const DEFAULT_LAUNCHER_SETTINGS: LauncherSettingsData = {
    checkForUpdates: true,
    useBetaChannel: false,
    showLog: true,
    language: 'English (US)',
    closeBehavior: 'Keep the launcher open',
    enableServerPanel: false,
};
const POST_LAUNCH_CLOSE_DELAY_MS = 250;

export const AppProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const { activeAccount, installations, servers, isLoaded: isDataLoaded, recordSession } = useData();
    const [activePage, setActivePage] = useState<Page>('Play');
    const [pageProps, setPageProps] = useState<PageProps>({});
    const [isLaunchModalOpen, setIsLaunchModalOpen] = useState(false);
    const [isLaunching, setIsLaunching] = useState(false);
    const [launchError, setLaunchError] = useState<string | null>(null);
    const [launchStatus, setLaunchStatus] = useState<string | null>(null);
    const [pendingLaunchInstallation, setPendingLaunchInstallation] = useState<ManagedItem | null>(null);
    const [pendingSessionArgs, setPendingSessionArgs] = useState<SessionLaunchArgs | null>(null);
    const [logViewerOpen, setLogViewerOpen] = useState(false);
    const [logViewerInstallation, setLogViewerInstallation] = useState<ManagedItem | null>(null);
    const [serverPanelEnabled, setServerPanelEnabled] = useState(DEFAULT_LAUNCHER_SETTINGS.enableServerPanel);
    const serverPanelMigratedRef = useRef(false);

    const navigate = useCallback((page: Page, props: PageProps = {}) => {
        setActivePage(page);
        setPageProps(props);
    }, []);

    const clearPageProps = useCallback(() => {
        setPageProps({});
    }, []);

    const closeLaunchModal = useCallback(() => {
        setIsLaunchModalOpen(false);
        setLaunchError(null);
        setPendingLaunchInstallation(null);
        setPendingSessionArgs(null);
    }, []);

    const getLauncherSettings = useCallback(async (): Promise<LauncherSettingsData> => {
        if (typeof window === 'undefined' || !window.launcher?.store) {
            return DEFAULT_LAUNCHER_SETTINGS;
        }

        try {
            const stored = await window.launcher.store.get(LAUNCHER_SETTINGS_KEY);
            if (stored && typeof stored === 'object') {
                return {
                    ...DEFAULT_LAUNCHER_SETTINGS,
                    ...(stored as Partial<LauncherSettingsData>),
                };
            }
        } catch {
            // Ignore store read failures and fall back to defaults.
        }

        return DEFAULT_LAUNCHER_SETTINGS;
    }, []);

    // Hydrate the live server-panel visibility from persisted settings, applying
    // a one-time migration for users upgrading from a version that predates the
    // `enableServerPanel` setting: if they already have server entries, keep the
    // panel visible (it was previously always-on for them); fresh installs and
    // server-less users default to hidden. Runs once, after launcher data has
    // hydrated so `servers` reflects the persisted state.
    useEffect(() => {
        if (serverPanelMigratedRef.current || !isDataLoaded) return;
        if (typeof window === 'undefined' || !window.launcher?.store) {
            serverPanelMigratedRef.current = true;
            return;
        }
        serverPanelMigratedRef.current = true;

        let cancelled = false;
        window.launcher.store.get(LAUNCHER_SETTINGS_KEY).then((stored) => {
            if (cancelled) return;

            const storedSettings = (stored && typeof stored === 'object')
                ? stored as Partial<LauncherSettingsData>
                : {};

            // Already migrated/explicitly set — honour the stored value.
            if (typeof storedSettings.enableServerPanel === 'boolean') {
                setServerPanelEnabled(storedSettings.enableServerPanel);
                return;
            }

            // Migration: grandfather in existing hosts so their panel doesn't vanish.
            const enabled = servers.length > 0;
            setServerPanelEnabled(enabled);
            window.launcher?.store?.set(LAUNCHER_SETTINGS_KEY, {
                ...DEFAULT_LAUNCHER_SETTINGS,
                ...storedSettings,
                enableServerPanel: enabled,
            });
        }).catch(() => {
            if (!cancelled) setServerPanelEnabled(DEFAULT_LAUNCHER_SETTINGS.enableServerPanel);
        });

        return () => { cancelled = true; };
    }, [isDataLoaded, servers]);

    const applyPostLaunchBehavior = useCallback(async (settings: LauncherSettingsData, installation: ManagedItem) => {
        if (typeof window === 'undefined' || !window.launcher?.window) {
            return;
        }

        // Steam Big Picture / Gaming Mode: ignore the user's closeBehavior. Close
        // the launcher window so the game owns the screen, and do NOT open the
        // log-viewer window (a second transparent window fights the gamescope
        // compositor). The main process keeps the app alive (window-all-closed
        // guard) until the game exits, so Steam keeps tracking the session.
        const gamingMode = await window.launcher.app?.isSteamGamingMode?.().catch(() => false) ?? false;
        if (gamingMode) {
            setTimeout(() => window.launcher?.window?.close(), POST_LAUNCH_CLOSE_DELAY_MS);
            return;
        }

        if (settings.closeBehavior === 'Keep the launcher open' && settings.showLog) {
            setLogViewerInstallation(installation);
            setLogViewerOpen(true);
        }

        switch (settings.closeBehavior) {
            case 'Close launcher':
                setTimeout(() => {
                    window.launcher?.window?.close();
                }, POST_LAUNCH_CLOSE_DELAY_MS);
                break;
            case 'Hide launcher':
                window.launcher.window.hide();
                break;
            case 'Keep the launcher open':
            default:
                break;
        }
    }, []);

    /**
     * Core launch logic. Accepts installation and sessionArgs directly so it
     * can be called both from the modal buttons (which read pending state) and
     * from the direct-launch path (no modal).
     *
     * When `terminateRunning` is true, any currently-running game processes are
     * stopped before the new instance is started.
     */
    const performLaunch = useCallback(async (
        installation: ManagedItem | null,
        sessionArgs: SessionLaunchArgs | null,
        terminateRunning: boolean,
    ) => {
        console.log("Launch sequence started.");
        setIsLaunchModalOpen(false);
        setIsLaunching(true);
        setLaunchError(null);
        setLaunchStatus(null);

        if (!installation) {
            console.error("No installation selected to launch");
            setLaunchError("No installation selected");
            setIsLaunching(false);
            return;
        }

        // Check if Electron API is available
        if (typeof window === 'undefined' || !window.launcher?.game) {
            console.error("Game launch API not available");
            setLaunchError("Game launch API not available. Running in browser mode?");
            setIsLaunching(false);
            return;
        }

        // ── Terminate existing instances if requested ────────────────────────
        if (terminateRunning && window.launcher?.game?.listRunning) {
            try {
                const running = await window.launcher.game.listRunning();
                await Promise.all(running.map(p => window.launcher.game.stop(p.installationId)));
            } catch (err) {
                // Non-fatal — proceed with launch even if termination fails
                console.warn('[AppContext] Failed to terminate running instances:', err);
            }
        }

        // ── Pre-launch: ensure the required Java version is available ────────
        const requiredJava = installation.requiredJavaVersion;
        if (requiredJava && window.launcher.java) {
            try {
                const runtimes = await window.launcher.java.list();
                const allRuntimes = [...runtimes.bundled, ...runtimes.system];
                const hasJava = allRuntimes.some(j => {
                    const v = parseInt(j.version, 10);
                    return requiredJava === 8
                        ? (v >= 8 && v < 9)
                        : (v >= requiredJava && v < requiredJava + 1);
                });

                if (!hasJava) {
                    setLaunchStatus(`Downloading Java ${requiredJava}…`);
                    const result = await window.launcher.java.download(requiredJava);
                    if (!result.success) {
                        setLaunchError(`Java ${requiredJava} is required but could not be downloaded: ${result.error ?? 'unknown error'}`);
                        setIsLaunching(false);
                        setLaunchStatus(null);
                        return;
                    }
                }
            } catch (err) {
                // Non-fatal — proceed and let the launcher handle missing Java
                console.warn('[AppContext] Java pre-check failed:', err);
            } finally {
                setLaunchStatus(null);
            }
        }

        try {
            const result = await window.launcher.game.launch({
                installationId: installation.id,
                installationPath: installation.path,
                starMadeVersion: installation.version,
                minMemory: installation.minMemory ?? 1024,
                maxMemory: installation.maxMemory ?? 8192,
                jvmArgs: installation.jvmArgs ?? '',
                customJavaPath: installation.customJavaPath,
                isServer: false,
                // Pass the active account id so the main process can inject the
                // registry auth token as a -auth <token> argument to the game.
                activeAccountId: activeAccount?.id,
                // Direct-connect args: prefer session-specific overrides, fall back
                // to the installation's own serverIp/port (for server entries).
                uplink: sessionArgs?.uplink ?? installation.serverIp,
                uplinkPort: sessionArgs?.uplinkPort ?? (installation.port ? parseInt(installation.port, 10) : undefined),
                modIds: sessionArgs?.modIds,
            });

            if (result.success) {
                console.log(`Game launched successfully with PID ${result.pid}`);

                // Record this as the last-played session.
                // Use a stable, deterministic id derived from the session target
                // (installationId + serverAddress + serverPort + modIds) so that
                // repeated launches of the same target update the existing record
                // rather than creating a new one, preserving pin/unpin identity.
                const serverAddress = sessionArgs?.uplink ?? installation.serverIp ?? 'localhost';
                const serverPort    = sessionArgs?.uplinkPort
                    ?? (installation.port ? parseInt(installation.port, 10) : undefined)
                    ?? 4242;
                const modIds        = sessionArgs?.modIds;
                const isMultiplayer = serverAddress !== 'localhost' && serverAddress !== '';
                const stableId = [
                    installation.id,
                    serverAddress,
                    String(serverPort),
                    (modIds ?? []).slice().sort().join(','),
                ].join('::');
                const session: PlaySession = {
                    id: stableId,
                    installationId: installation.id,
                    installationName: installation.name,
                    installationPath: installation.path,
                    installationVersion: installation.version,
                    sessionType: isMultiplayer ? 'multiplayer' : 'singleplayer',
                    serverAddress,
                    serverPort,
                    modIds,
                    timestamp: new Date().toISOString(),
                };
                recordSession(session);

                const launcherSettings = await getLauncherSettings();
                applyPostLaunchBehavior(launcherSettings, installation);
                
                // Keep isLaunching true for a moment to show progress
                setTimeout(() => {
                    setIsLaunching(false);
                }, 2000);
            } else {
                console.error("Failed to launch game:", result.error);
                setLaunchError(result.error || "Unknown error");
                setIsLaunching(false);
            }
        } catch (error) {
            console.error("Exception during launch:", error);
            setLaunchError(String(error));
            setIsLaunching(false);
        }
    }, [activeAccount, applyPostLaunchBehavior, getLauncherSettings, recordSession]);

    /** Called by the "Launch Anyway" modal button — launches without terminating. */
    const startLaunching = useCallback(async () => {
        await performLaunch(pendingLaunchInstallation, pendingSessionArgs, false);
    }, [pendingLaunchInstallation, pendingSessionArgs, performLaunch]);

    /** Called by the "Terminate & Launch" modal button — stops running games first. */
    const startLaunchingAndTerminate = useCallback(async () => {
        await performLaunch(pendingLaunchInstallation, pendingSessionArgs, true);
    }, [pendingLaunchInstallation, pendingSessionArgs, performLaunch]);

    /**
     * Open the launch flow for a given installation.
     *
     * If a StarMade game instance is already running the "Existing Instance
     * Detected" confirmation modal is shown so the user can decide whether to
     * terminate the old process or launch alongside it.
     *
     * If no game is currently running the launch proceeds immediately without
     * showing the modal.
     */
    const openLaunchModal = useCallback(async (installation?: ManagedItem, sessionArgs?: SessionLaunchArgs) => {
        if (isLaunching) return;

        // Check whether any game instances are already running before deciding
        // whether to show the confirmation modal.
        let hasRunningInstances = false;
        if (typeof window !== 'undefined' && window.launcher?.game?.listRunning) {
            try {
                const running = await window.launcher.game.listRunning();
                hasRunningInstances = running.length > 0;
            } catch {
                // If detection fails, assume no instances are running to avoid
                // false-positive warnings.
                hasRunningInstances = false;
            }
        }

        if (hasRunningInstances) {
            // Existing instance detected — show the confirmation modal.
            setPendingLaunchInstallation(installation || null);
            setPendingSessionArgs(sessionArgs || null);
            setIsLaunchModalOpen(true);
        } else {
            // No running instances — launch directly without the modal.
            await performLaunch(installation || null, sessionArgs || null, false);
        }
    }, [isLaunching, performLaunch]);
    
    const completeLaunching = useCallback(() => {
        console.log("Launch sequence complete.");
        setIsLaunching(false);
        setLaunchError(null);
    }, []);

    const openLogViewer = useCallback((installation: ManagedItem) => {
        setLogViewerInstallation(installation);
        setLogViewerOpen(true);
    }, []);

    const closeLogViewer = useCallback(() => {
        setLogViewerOpen(false);
    }, []);

    /**
     * Launch a previously recorded play session.
     * Finds the matching installation and opens the launch modal pre-loaded
     * with the session's direct-connect arguments.
     */
    const launchSession = useCallback((session: PlaySession) => {
        const installation = installations.find(i => i.id === session.installationId);
        if (!installation) {
            console.warn('[AppContext] launchSession: installation not found for session', session.installationId);
            return;
        }
        openLaunchModal(installation, {
            uplink:     session.serverAddress,
            uplinkPort: session.serverPort,
            modIds:     session.modIds,
        });
    }, [installations, openLaunchModal]);

    const value = useMemo<AppContextType>(() => ({
        activePage,
        pageProps,
        isLaunchModalOpen,
        isLaunching,
        launchError,
        launchStatus,
        logViewerOpen,
        logViewerInstallation,
        serverPanelEnabled,
        setServerPanelEnabled,
        navigate,
        clearPageProps,
        openLaunchModal,
        closeLaunchModal,
        startLaunching,
        startLaunchingAndTerminate,
        completeLaunching,
        openLogViewer,
        closeLogViewer,
        launchSession,
    }), [
        activePage,
        pageProps,
        isLaunchModalOpen,
        isLaunching,
        launchError,
        launchStatus,
        logViewerOpen,
        logViewerInstallation,
        serverPanelEnabled,
        navigate,
        clearPageProps,
        openLaunchModal,
        closeLaunchModal,
        startLaunching,
        startLaunchingAndTerminate,
        completeLaunching,
        openLogViewer,
        closeLogViewer,
        launchSession,
    ]);

    return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export const useApp = (): AppContextType => {
    const context = useContext(AppContext);
    if (context === undefined) {
        throw new Error('useApp must be used within an AppProvider');
    }
    return context;
}
