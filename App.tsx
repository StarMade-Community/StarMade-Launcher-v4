import React from 'react';
import Header from './components/layout/Header';
import Footer from './components/layout/Footer';
import News from './components/pages/News';
import Installations from './components/pages/Installations';
import Play from './components/pages/Play';
import Settings from './components/pages/Settings';
import LaunchConfirmModal from './components/common/LaunchConfirmModal';
import { useApp } from './contexts/AppContext';

const App: React.FC = () => {
  const { 
    activePage, 
    pageProps, 
    isLaunchModalOpen, 
    closeLaunchModal, 
    startLaunching 
  } = useApp();

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
      
      <div 
        className="absolute inset-0 bg-cover bg-center z-0" 
        style={{ backgroundImage: "url('https://www.star-made.org/images/bg1.jpg')" }}
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
