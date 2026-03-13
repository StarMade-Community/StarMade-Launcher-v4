import React, { useState, useEffect } from 'react';
import Header from './components/layout/Header';
import Footer from './components/layout/Footer';
import News from './components/pages/News';
import Installations from './components/pages/Installations';
import Play from './components/pages/Play';
import Settings from './components/pages/Settings';
import ServerPanel from './components/pages/ServerPanel';
import LaunchConfirmModal from './components/common/LaunchConfirmModal';
import GameLogViewer from './components/common/GameLogViewer';
import UpdateAvailableModal from './components/common/UpdateAvailableModal';
import LastPlayedWidget from './components/common/LastPlayedWidget';
import { useApp } from './contexts/AppContext';
import useRandomBackground from './components/hooks/useRandomBackground';

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
  } = useApp();

  const { url: bgUrl, loaded: bgLoaded } = useRandomBackground();

  // ─── Auto-update state ────────────────────────────────────────────────────

  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [isUpdateModalOpen, setIsUpdateModalOpen] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.launcher?.updater) return;

    const cleanup = window.launcher.updater.onUpdateAvailable((info) => {
      setUpdateInfo(info);
      setIsUpdateModalOpen(true);
    });

    return cleanup;
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleViewportResize = () => {
      setIsShortViewport(window.innerHeight < 720);
    };

    handleViewportResize();
    window.addEventListener('resize', handleViewportResize);
    return () => window.removeEventListener('resize', handleViewportResize);
  }, []);


  const handleDismissUpdate = () => {
    setIsUpdateModalOpen(false);
  };

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
    <div className={`bg-starmade-bg text-gray-200 font-sans h-screen w-screen flex flex-col antialiased overflow-x-hidden ${isShortViewport ? 'overflow-y-auto' : 'overflow-y-hidden'}`}>
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
