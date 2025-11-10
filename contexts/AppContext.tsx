import React, { createContext, useContext, useState, ReactNode } from 'react';
import type { AppContextType, Page, PageProps } from '../types';

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [activePage, setActivePage] = useState<Page>('Play');
    const [pageProps, setPageProps] = useState<PageProps>({});
    const [isLaunchModalOpen, setIsLaunchModalOpen] = useState(false);
    const [isLaunching, setIsLaunching] = useState(false);

    const navigate = (page: Page, props: PageProps = {}) => {
        setActivePage(page);
        setPageProps(props);
    };

    const openLaunchModal = () => {
        if (!isLaunching) {
            setIsLaunchModalOpen(true);
        }
    };
    const closeLaunchModal = () => setIsLaunchModalOpen(false);

    const startLaunching = () => {
        console.log("Launch sequence started.");
        setIsLaunchModalOpen(false);
        setIsLaunching(true);
    };
    
    const completeLaunching = () => {
        console.log("Launch sequence complete.");
        setIsLaunching(false);
    };

    const value: AppContextType = {
        activePage,
        pageProps,
        isLaunchModalOpen,
        isLaunching,
        navigate,
        openLaunchModal,
        closeLaunchModal,
        startLaunching,
        completeLaunching,
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
