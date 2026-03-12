import React, { useState, useEffect } from 'react';
import Header from './components/layout/Header';
import Footer from './components/layout/Footer';
import News from './components/pages/News';
import Installations from './components/pages/Installations';
import Play from './components/pages/Play';
import Settings from './components/pages/Settings';
import LaunchConfirmModal from './components/common/LaunchConfirmModal';
import GameLogViewer from './components/common/GameLogViewer';
import UpdateAvailableModal from './components/common/UpdateAvailableModal';
import { useApp } from './contexts/AppContext';
import useRandomBackground from './components/hooks/useRandomBackground';

interface UpdateInfo {
  available: boolean;
  latestVersion: string;
  currentVersion: string;
  releaseNotes: string;
  downloadUrl: string;
}

const App: React.FC = () => {
  const { 
    activePage, 
    pageProps, 
    isLaunchModalOpen, 
    closeLaunchModal, 
    startLaunching,
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

  const handleDownloadUpdate = () => {
    if (updateInfo?.downloadUrl) {
      // Open the GitHub releases page in the default browser
      window.open(updateInfo.downloadUrl, '_blank');
    }
    setIsUpdateModalOpen(false);
  };

  const handleDismissUpdate = () => {
    setIsUpdateModalOpen(false);
  };

  // ─── Page rendering ───────────────────────────────────────────────────────

  const renderContent = () => {
    switch (activePage) {
      case 'Installations':
        return <Installations {...pageProps} />;
      case 'News':
        return <News />;
      case 'Settings':
        return <Settings {...pageProps} />;
      case 'Play':
      default:
        return <Play />;
    }
  };

  return (
    <div className="bg-starmade-bg text-gray-200 font-sans h-screen w-screen flex flex-col antialiased">
      <LaunchConfirmModal
        isOpen={isLaunchModalOpen}
        onConfirm={startLaunching}
        onLaunchAnyway={startLaunching}
        onCancel={closeLaunchModal}
      />

      <UpdateAvailableModal
        isOpen={isUpdateModalOpen}
        updateInfo={updateInfo}
        onDownload={handleDownloadUpdate}
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
      </div>
    </div>
  );
};

export default App;
