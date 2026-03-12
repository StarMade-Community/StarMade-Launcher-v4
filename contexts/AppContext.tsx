import React, { createContext, useContext, useState, ReactNode } from 'react';
import type { AppContextType, Page, PageProps, ManagedItem } from '../types';
import { useData } from './DataContext';

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const { activeAccount } = useData();
    const [activePage, setActivePage] = useState<Page>('Play');
    const [pageProps, setPageProps] = useState<PageProps>({});
    const [isLaunchModalOpen, setIsLaunchModalOpen] = useState(false);
    const [isLaunching, setIsLaunching] = useState(false);
    const [launchError, setLaunchError] = useState<string | null>(null);
    const [launchStatus, setLaunchStatus] = useState<string | null>(null);
    const [pendingLaunchInstallation, setPendingLaunchInstallation] = useState<ManagedItem | null>(null);
    const [logViewerOpen, setLogViewerOpen] = useState(false);
    const [logViewerInstallation, setLogViewerInstallation] = useState<ManagedItem | null>(null);

    const navigate = (page: Page, props: PageProps = {}) => {
        setActivePage(page);
        setPageProps(props);
    };

    const openLaunchModal = (installation?: ManagedItem) => {
        if (!isLaunching) {
            setPendingLaunchInstallation(installation || null);
            setIsLaunchModalOpen(true);
        }
    };
    const closeLaunchModal = () => {
        setIsLaunchModalOpen(false);
        setLaunchError(null);
        setPendingLaunchInstallation(null);
    };

    const startLaunching = async () => {
        const installation = pendingLaunchInstallation;
        
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

        // ── Pre-launch: ensure the required Java version is available ────────
        const requiredJava = installation.requiredJavaVersion;
        if (requiredJava && window.launcher.java) {
            try {
                const runtimes = await window.launcher.java.list();
                const allRuntimes = [...runtimes.bundled, ...runtimes.system];
                const hasJava = allRuntimes.some(j => {
                    const v = parseInt(j.version, 10);
                    return requiredJava === 8 ? (v >= 8 && v < 9) : (v >= requiredJava);
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
            });

            if (result.success) {
                console.log(`Game launched successfully with PID ${result.pid}`);
                
                // Check if we should open log viewer automatically
                if (typeof window !== 'undefined' && window.launcher?.store) {
                    window.launcher.store.get('launcherSettings').then((settings: any) => {
                        if (settings?.showLog) {
                            setLogViewerInstallation(installation);
                            setLogViewerOpen(true);
                        }
                    }).catch(() => {});
                }
                
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
    };
    
    const completeLaunching = () => {
        console.log("Launch sequence complete.");
        setIsLaunching(false);
        setLaunchError(null);
    };

    const openLogViewer = (installation: ManagedItem) => {
        setLogViewerInstallation(installation);
        setLogViewerOpen(true);
    };

    const closeLogViewer = () => {
        setLogViewerOpen(false);
    };

    const value: AppContextType = {
        activePage,
        pageProps,
        isLaunchModalOpen,
        isLaunching,
        launchError,
        launchStatus,
        logViewerOpen,
        logViewerInstallation,
        navigate,
        openLaunchModal,
        closeLaunchModal,
        startLaunching,
        completeLaunching,
        openLogViewer,
        closeLogViewer,
    };

    return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export const useApp = (): AppContextType => {
    const context = useContext(AppContext);
    if (context === undefined) {
        throw new Error('useApp must be used within an AppProvider');
    }
    return context;
}
