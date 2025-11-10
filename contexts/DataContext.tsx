import React, { createContext, useContext, useState, ReactNode } from 'react';
import type { DataContextType, ManagedItem, Account, Version } from '../types';
import { 
    accountsData, 
    versionsData, 
    initialInstallationsData, 
    initialServersData,
    defaultInstallationData,
    defaultServerData
} from '../data/mockData';

const DataContext = createContext<DataContextType | undefined>(undefined);

export const DataProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [accounts, setAccounts] = useState<Account[]>(accountsData);
    const [activeAccount, setActiveAccount] = useState<Account | null>(accountsData[0] || null);
    
    const [installations, setInstallations] = useState<ManagedItem[]>(initialInstallationsData);
    const [servers, setServers] = useState<ManagedItem[]>(initialServersData);
    
    const [versions, setVersions] = useState<Version[]>(versionsData);
    const [selectedVersion, setSelectedVersion] = useState<Version | null>(versionsData[0] || null);

    const addInstallation = (item: ManagedItem) => setInstallations(prev => [item, ...prev]);
    const updateInstallation = (item: ManagedItem) => setInstallations(prev => prev.map(i => i.id === item.id ? item : i));
    const deleteInstallation = (id: string) => setInstallations(prev => prev.filter(i => i.id !== id));
    
    const addServer = (item: ManagedItem) => setServers(prev => [item, ...prev]);
    const updateServer = (item: ManagedItem) => setServers(prev => prev.map(s => s.id === item.id ? item : s));
    const deleteServer = (id: string) => setServers(prev => prev.filter(s => s.id !== id));

    const getInstallationDefaults = () => ({ ...defaultInstallationData, id: Date.now().toString() });
    const getServerDefaults = () => ({ ...defaultServerData, id: Date.now().toString() });

    const value = {
        accounts,
        activeAccount,
        installations,
        servers,
        versions,
        selectedVersion,
        setActiveAccount,
        setSelectedVersion,
        addInstallation,
        updateInstallation,
        deleteInstallation,
        addServer,
        updateServer,
        deleteServer,
        getInstallationDefaults,
        getServerDefaults,
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
