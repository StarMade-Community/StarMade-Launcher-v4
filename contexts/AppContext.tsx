import React, { createContext, useContext, useState, useCallback, useMemo, useEffect, useRef, ReactNode } from 'react';
import type { AppContextType, Page, PageProps, ManagedItem, PlaySession, SessionLaunchArgs, LauncherSettingsData } from '../types';
import { useData } from './DataContext';
import { makeSessionId } from '../utils/playSession';

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
    const { activeAccount, installations, servers, versions, isLoaded: isDataLoaded, recordSession, updateInstallation } = useData();
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
        // Prefer the requirement from the live version manifest over the value
        // stored on the installation.  An install updated from a Java 8 build
        // (< 0.3) to a Java 21 build (>= 0.3) may still carry a stale
        // requiredJavaVersion of 8; trusting it here would skip the Java 21
        // download and the launch would then fail to find a Java 21 runtime.
        const manifestEntry = versions?.find(v => v.id === installation.version);
        const requiredJava = manifestEntry?.requiredJavaVersion ?? installation.requiredJavaVersion;

        // Java path the game will launch with. Defaults to the install's stored
        // override; replaced below with whatever `java.ensure` resolves (which is
        // verified to be the right major version and 64-bit), so a stale stored path
        // never reaches the launcher.
        let javaPathForLaunch = installation.customJavaPath;

        if (requiredJava && window.launcher.java?.ensure) {
            try {
                setLaunchStatus(`Checking Java ${requiredJava}…`);
                // Resolve-or-download in one authoritative step. Passing the install's
                // current path as the preferred candidate keeps a valid user override.
                const ensure = await window.launcher.java.ensure(requiredJava, installation.customJavaPath);
                if (!ensure.success || !ensure.path) {
                    setLaunchError(`Java ${requiredJava} is required but could not be prepared: ${ensure.error ?? 'unknown error'}`);
                    setIsLaunching(false);
                    setLaunchStatus(null);
                    return;
                }

                javaPathForLaunch = ensure.path;

                // Persist the resolved runtime unless the install already pointed at a
                // valid Java (usedPreferred). This refreshes installs whose stored path
                // went stale after a Java 8 → 21 game update, and keeps the default
                // settings' javaPath8/21 in sync — without clobbering a user override.
                if (!ensure.usedPreferred && !installation.isRemote) {
                    updateInstallation({ ...installation, customJavaPath: ensure.path });
                    try {
                        const storeKey = 'defaultInstallationSettings';
                        const current = (await window.launcher.store?.get(storeKey)) as Record<string, unknown> | undefined;
                        const fieldKey = requiredJava === 21 ? 'javaPath21' : 'javaPath8';
                        await window.launcher.store?.set(storeKey, { ...(current ?? {}), [fieldKey]: ensure.path });
                    } catch (persistErr) {
                        console.warn('[AppContext] Failed to persist default Java path:', persistErr);
                    }
                }
            } catch (err) {
                // Non-fatal — proceed and let the launcher handle Java resolution.
                console.warn('[AppContext] Java ensure failed:', err);
            } finally {
                setLaunchStatus(null);
            }
        }

        try {
            // Resolved once and reused for both the launch and the session
            // record, so a replay of that record produces an identical launch.
            // `undefined` means "no -uplink at all", which is how singleplayer
            // launches — it is not the same as connecting to localhost.
            const uplink     = sessionArgs?.uplink ?? installation.serverIp;
            const uplinkPort = sessionArgs?.uplinkPort
                ?? (installation.port ? parseInt(installation.port, 10) : undefined);

            const result = await window.launcher.game.launch({
                installationId: installation.id,
                installationPath: installation.path,
                starMadeVersion: installation.version,
                minMemory: installation.minMemory ?? 1024,
                maxMemory: installation.maxMemory ?? 8192,
                jvmArgs: installation.jvmArgs ?? '',
                customJavaPath: javaPathForLaunch,
                isServer: false,
                // Pass the active account id so the main process can inject the
                // registry auth token as a -auth <token> argument to the game.
                activeAccountId: activeAccount?.id,
                // Direct-connect args: prefer session-specific overrides, fall back
                // to the installation's own serverIp/port (for server entries).
                uplink,
                uplinkPort,
                modIds: sessionArgs?.modIds,
            });

            if (result.success) {
                console.log(`Game launched successfully with PID ${result.pid}`);

                // Record this as the last-played session, keyed by a stable id
                // derived from the launch target so repeated launches update the
                // existing record rather than piling up duplicates that break
                // pin identity.
                const modIds = sessionArgs?.modIds;
                const session: PlaySession = {
                    id: makeSessionId(installation.id, uplink, uplinkPort, modIds),
                    installationId: installation.id,
                    installationName: installation.name,
                    installationPath: installation.path,
                    installationVersion: installation.version,
                    sessionType: uplink ? 'multiplayer' : 'singleplayer',
                    ...(uplink ? { serverAddress: uplink, serverPort: uplinkPort ?? 4242 } : {}),
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
    }, [activeAccount, applyPostLaunchBehavior, getLauncherSettings, recordSession, versions]);

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
    
    /** Dismiss a launch failure notice without starting another launch. */
    const dismissLaunchError = useCallback(() => setLaunchError(null), []);

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
            // The installation was deleted after the session was recorded.
            // Surface it rather than making the click a silent no-op.
            setLaunchError(`"${session.installationName}" is no longer installed.`);
            return;
        }
        // `sessionType` is the authority, not `serverAddress`: records written
        // by older launcher versions still carry a placeholder localhost
        // address on singleplayer sessions.
        const isMultiplayer = session.sessionType === 'multiplayer';
        openLaunchModal(installation, {
            uplink:     isMultiplayer ? session.serverAddress : undefined,
            uplinkPort: isMultiplayer ? session.serverPort    : undefined,
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
        dismissLaunchError,
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
        dismissLaunchError,
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
