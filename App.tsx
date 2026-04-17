import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Header from './components/layout/Header';
import Footer from './components/layout/Footer';
import News from './components/pages/News';
import Screenshots from './components/pages/Screenshots';
import Mods from './components/pages/Mods';
import Installations from './components/pages/Installations';
import Play from './components/pages/Play';
import Settings from './components/pages/Settings';
import ServerPanel from './components/pages/ServerPanel';
import LaunchConfirmModal from './components/common/LaunchConfirmModal';
import GameLogViewer from './components/common/GameLogViewer';
import UpdateAvailableModal from './components/common/UpdateAvailableModal';
import LegacyImportPromptModal from './components/common/LegacyImportPromptModal';
import LastPlayedWidget from './components/common/LastPlayedWidget';
import { useApp } from './contexts/AppContext';
import { useData } from './contexts/DataContext';
import useLegacyInstallImporter from './components/hooks/useLegacyInstallImporter';
import useRandomBackground from './components/hooks/useRandomBackground';
import {
  LEGACY_IMPORT_PROMPT_STORE_KEY,
  createLegacyImportPromptState,
  dedupeLegacyInstallPaths,
  parseLegacyImportPromptState,
} from './utils/legacyImport';

interface UpdateInfo {
  available: boolean;
  latestVersion: string;
  currentVersion: string;
  releaseNotes: string;
  downloadUrl: string;
  assetUrl?: string;
  assetName?: string;
}

const App: React.FC = () => {
  const [isShortViewport, setIsShortViewport] = useState<boolean>(false);
  const [isWindowMaximized, setIsWindowMaximized] = useState<boolean>(false);

  const {
    activePage, 
    pageProps, 
    isLaunchModalOpen, 
    closeLaunchModal, 
    startLaunching,
    startLaunchingAndTerminate,
    logViewerOpen,
    logViewerInstallation,
    closeLogViewer,
    navigate,
  } = useApp();

  const { installations, isLoaded: isDataLoaded } = useData();
  const { importInstallations } = useLegacyInstallImporter();

  const { url: bgUrl, loaded: bgLoaded } = useRandomBackground();

  // ─── Auto-update state ────────────────────────────────────────────────────

  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [isUpdateModalOpen, setIsUpdateModalOpen] = useState(false);
  const [legacyPromptState, setLegacyPromptState] = useState<ReturnType<typeof parseLegacyImportPromptState>>(null);
  const [isLegacyPromptStateLoaded, setIsLegacyPromptStateLoaded] = useState(false);
  const [isLegacyPromptHidden, setIsLegacyPromptHidden] = useState(false);
  const [isLegacyImporting, setIsLegacyImporting] = useState(false);
  const [legacyImportError, setLegacyImportError] = useState<string | null>(null);

  const existingInstallationPaths = useMemo(
    () => new Set(installations.map((installation) => installation.path.trim())),
    [installations],
  );

  const pendingLegacyPromptPaths = useMemo(() => {
    if (legacyPromptState?.status !== 'pending') return [];
    return dedupeLegacyInstallPaths(legacyPromptState.paths).filter(
      (installPath) => !existingInstallationPaths.has(installPath),
    );
  }, [existingInstallationPaths, legacyPromptState]);

  const persistLegacyPromptState = useCallback(async (nextState: ReturnType<typeof parseLegacyImportPromptState>) => {
    setLegacyPromptState(nextState);

    if (typeof window === 'undefined' || !window.launcher?.store) return;

    try {
      if (nextState) {
        await window.launcher.store.set(LEGACY_IMPORT_PROMPT_STORE_KEY, nextState);
      } else {
        await window.launcher.store.delete(LEGACY_IMPORT_PROMPT_STORE_KEY);
      }
    } catch (error) {
      console.error('Failed to persist legacy import prompt state:', error);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.launcher?.updater) return;

    const cleanup = window.launcher.updater.onUpdateAvailable((info) => {
      setUpdateInfo(info);
      setIsUpdateModalOpen(true);
    });

    return cleanup;
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (typeof window === 'undefined' || !window.launcher?.store) {
      setIsLegacyPromptStateLoaded(true);
      return;
    }

    window.launcher.store.get(LEGACY_IMPORT_PROMPT_STORE_KEY)
      .then((stored) => {
        if (cancelled) return;
        const parsed = parseLegacyImportPromptState(stored);
        setLegacyPromptState(prev => prev ?? parsed);
        setIsLegacyPromptStateLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setIsLegacyPromptStateLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.launcher?.legacy?.onScanResult) return;

    const cleanup = window.launcher.legacy.onScanResult((paths) => {
      // Don't overwrite a user's dismiss decision or a completed import.
      if (legacyPromptState?.status === 'dismissed' || legacyPromptState?.status === 'imported') return;

      const dedupedPaths = dedupeLegacyInstallPaths(paths);
      setLegacyImportError(null);

      if (dedupedPaths.length === 0) {
        // Scan found nothing — prompt user to locate an installation manually.
        void persistLegacyPromptState(createLegacyImportPromptState('not-found'));
        return;
      }

      // Installs found — store as pending; the auto-import effect will pick them up.
      const existingPromptPaths = legacyPromptState?.status === 'pending'
        ? legacyPromptState.paths
        : [];

      void persistLegacyPromptState(
        createLegacyImportPromptState('pending', [...existingPromptPaths, ...dedupedPaths]),
      );
    });

    return cleanup;
  }, [legacyPromptState, persistLegacyPromptState]);

  // Tracks whether we've already fired the one-shot auto-import for this session.
  // Keeps the effect from re-triggering after a partial failure updates the state.
  const autoImportAttemptedRef = useRef(false);

  useEffect(() => {
    if (!isDataLoaded || !isLegacyPromptStateLoaded || legacyPromptState?.status !== 'pending') return;

    if (pendingLegacyPromptPaths.length === 0) {
      // All paths already present — nothing left to import.
      void persistLegacyPromptState(createLegacyImportPromptState('imported'));
      return;
    }

    // Auto-import silently on first opportunity.  If it partially or fully fails,
    // show the modal so the user can retry manually.
    if (autoImportAttemptedRef.current) return;
    autoImportAttemptedRef.current = true;

    setIsLegacyPromptHidden(true);
    setIsLegacyImporting(true);

    importInstallations(pendingLegacyPromptPaths)
      .then(({ imported }) => {
        const remainingPaths = pendingLegacyPromptPaths.filter(p => !imported.includes(p));
        if (remainingPaths.length === 0) {
          void persistLegacyPromptState(createLegacyImportPromptState('imported'));
        } else {
          setLegacyImportError('Some installations could not be imported automatically. You can retry below or add them manually in Launcher Settings.');
          setIsLegacyPromptHidden(false);
          void persistLegacyPromptState(createLegacyImportPromptState('pending', remainingPaths));
        }
      })
      .catch(() => {
        setLegacyImportError('Failed to import legacy installations automatically. You can retry below or add them manually in Launcher Settings.');
        setIsLegacyPromptHidden(false);
      })
      .finally(() => {
        setIsLegacyImporting(false);
      });
  }, [
    isDataLoaded,
    isLegacyPromptStateLoaded,
    legacyPromptState,
    pendingLegacyPromptPaths,
    persistLegacyPromptState,
    importInstallations,
  ]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleViewportResize = () => {
      setIsShortViewport(window.innerHeight < 720);
    };

    handleViewportResize();
    window.addEventListener('resize', handleViewportResize);
    return () => window.removeEventListener('resize', handleViewportResize);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const params = new URLSearchParams(window.location.search);
    if (params.get('page') !== 'ServerPanel') return;

    const serverId = params.get('serverId') ?? undefined;
    const serverName = params.get('serverName') ?? undefined;
    navigate('ServerPanel', { serverId, serverName });
  }, [navigate]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return;

    const channel = new BroadcastChannel('starmade-launcher-navigation');
    channel.onmessage = (event: MessageEvent<unknown>) => {
      const payload = event.data as { type?: string; serverId?: string; serverName?: string } | null;
      if (!payload || payload.type !== 'open-server-panel') return;
      navigate('ServerPanel', {
        serverId: payload.serverId,
        serverName: payload.serverName,
      });
      window.focus();
    };

    return () => {
      channel.close();
    };
  }, [navigate]);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.launcher?.window?.onMaximizedChanged) return;
    return window.launcher.window.onMaximizedChanged((value) => setIsWindowMaximized(value));
  }, []);


  const handleDismissUpdate = () => {
    setIsUpdateModalOpen(false);
  };

  const handleDismissLegacyPrompt = useCallback(() => {
    setLegacyImportError(null);
    setIsLegacyPromptHidden(true);
    void persistLegacyPromptState(createLegacyImportPromptState('dismissed'));
  }, [persistLegacyPromptState]);

  const handleBrowseForLegacyInstall = useCallback(async () => {
    if (!window.launcher?.dialog?.openFolder || !window.launcher?.legacy?.scanFolder) return;

    setLegacyImportError(null);
    setIsLegacyImporting(true);

    try {
      const folderPath = await window.launcher.dialog.openFolder();
      if (!folderPath) return;

      const found = await window.launcher.legacy.scanFolder(folderPath);
      const deduped = dedupeLegacyInstallPaths(found ?? []);

      if (deduped.length === 0) {
        setLegacyImportError('No StarMade installation found in that folder. Select the folder that contains StarMade.jar.');
        return;
      }

      const { imported } = await importInstallations(deduped);
      if (imported.length > 0) {
        await persistLegacyPromptState(createLegacyImportPromptState('imported'));
      } else {
        setLegacyImportError('Could not import the installation. You can add it manually in Launcher Settings.');
      }
    } catch {
      setLegacyImportError('Failed to browse for installations.');
    } finally {
      setIsLegacyImporting(false);
    }
  }, [importInstallations, persistLegacyPromptState]);

  const handleOpenLegacyImportSettings = useCallback(() => {
    setLegacyImportError(null);
    setIsLegacyPromptHidden(true);
    navigate('Settings', { initialSection: 'launcher' });
  }, [navigate]);

  const handleImportLegacyInstallations = useCallback(async () => {
    if (pendingLegacyPromptPaths.length === 0) return;

    setIsLegacyImporting(true);
    setLegacyImportError(null);

    try {
      const { imported } = await importInstallations(pendingLegacyPromptPaths);
      const remainingPaths = pendingLegacyPromptPaths.filter(path => !imported.includes(path));

      if (remainingPaths.length === 0) {
        setIsLegacyPromptHidden(true);
        await persistLegacyPromptState(createLegacyImportPromptState('imported'));
      } else {
        await persistLegacyPromptState(createLegacyImportPromptState('pending', remainingPaths));
        setLegacyImportError('Some legacy installations could not be imported automatically. You can review them in Launcher Settings.');
      }
    } catch (error) {
      console.error('Failed to import legacy installations:', error);
      setLegacyImportError('Failed to import legacy installations automatically. You can review them in Launcher Settings.');
    } finally {
      setIsLegacyImporting(false);
    }
  }, [importInstallations, pendingLegacyPromptPaths, persistLegacyPromptState]);

  // ─── Page rendering ───────────────────────────────────────────────────────

  const renderContent = () => {
    const initialSection = 'initialSection' in pageProps ? pageProps.initialSection : undefined;
    const initialTab = 'initialTab' in pageProps ? pageProps.initialTab : undefined;
    const serverId = 'serverId' in pageProps ? pageProps.serverId : undefined;
    const serverName = 'serverName' in pageProps ? pageProps.serverName : undefined;

    switch (activePage) {
      case 'Installations': {
        const installationProps = 'initialTab' in pageProps ? pageProps : {};
        return <Installations {...installationProps} />;
      }
      case 'News':
        return <News />;
      case 'Screenshots':
        return <Screenshots />;
      case 'Mods':
        return <Mods />;
      case 'Settings': {
        const settingsProps = 'initialSection' in pageProps ? pageProps : {};
        return <Settings {...settingsProps} />;
      }
      case 'ServerPanel':
        return <ServerPanel serverId={serverId} serverName={serverName} />;
      case 'Play':
      default:
        return <Play />;
    }
  };

  return (
    <div className={`bg-starmade-bg text-gray-200 font-sans h-screen w-screen flex flex-col antialiased overflow-x-hidden ${
      isShortViewport ? 'overflow-y-auto' : 'overflow-y-hidden'
    } ${isWindowMaximized ? 'rounded-none p-0 border-0 shadow-none' : 'rounded-3xl p-[3px] border border-white/10 shadow-[0_0_0_1px_rgba(0,0,0,0.6),0_24px_64px_rgba(0,0,0,0.8)]'} overflow-hidden`}>
      <LaunchConfirmModal
        isOpen={isLaunchModalOpen}
        onConfirm={startLaunchingAndTerminate}
        onLaunchAnyway={startLaunching}
        onCancel={closeLaunchModal}
      />

      <UpdateAvailableModal
        isOpen={isUpdateModalOpen}
        updateInfo={updateInfo}
        onDismiss={handleDismissUpdate}
      />

      <LegacyImportPromptModal
        isOpen={isDataLoaded && isLegacyPromptStateLoaded && (pendingLegacyPromptPaths.length > 0 || legacyPromptState?.status === 'not-found') && !isLegacyPromptHidden}
        notFound={legacyPromptState?.status === 'not-found'}
        installPaths={pendingLegacyPromptPaths}
        isImporting={isLegacyImporting}
        errorMessage={legacyImportError}
        onImportAll={() => { void handleImportLegacyInstallations(); }}
        onBrowse={() => { void handleBrowseForLegacyInstall(); }}
        onOpenSettings={handleOpenLegacyImportSettings}
        onDismiss={handleDismissLegacyPrompt}
      />

      {logViewerInstallation && (
        <GameLogViewer
          installationId={logViewerInstallation.id}
          installationName={logViewerInstallation.name}
          installationPath={logViewerInstallation.path}
          isOpen={logViewerOpen}
          onClose={closeLogViewer}
        />
      )}
      
      <div 
        className="absolute inset-0 bg-cover bg-center z-0"
        style={{
          backgroundImage: bgUrl ? `url('${bgUrl}')` : undefined,
          opacity: bgLoaded ? 1 : 0,
          transition: 'opacity 1.2s ease-in-out',
        }}
      >
        <div 
          className="absolute inset-0"
          style={{ background: 'radial-gradient(ellipse at center, transparent 30%, black 100%)' }}
        ></div>
      </div>
      
      <div className="relative z-10 flex flex-col flex-grow h-full">
        <Header />
        <main className="flex-grow flex items-center justify-center p-8 overflow-y-auto">
          {renderContent()}
        </main>
        <Footer />
        {/* Quick-play widget — only shown on the Play (home) page */}
        {activePage === 'Play' && <LastPlayedWidget />}
      </div>
    </div>
  );
};

export default App;
