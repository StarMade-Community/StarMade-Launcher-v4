import React, { useState, useEffect } from 'react';
import { PlusIcon } from '../../common/icons';
import InstallationForm from '../../common/InstallationForm';
import ItemCard from '../../common/ItemCard';
import DeleteConfirmModal from '../../common/DeleteConfirmModal';
import BackupConfirmModal from '../../common/BackupConfirmModal';
import RestoreBackupModal from '../../common/RestoreBackupModal';
import type { ManagedItem, InstallationsTab } from '../../../types';
import PageContainer from '../../common/PageContainer';
import { useData } from '../../../contexts/DataContext';
import { useApp } from '../../../contexts/AppContext';

interface InstallationsProps {
  initialTab?: InstallationsTab;
}

const Installations: React.FC<InstallationsProps> = ({ initialTab }) => {
    const [activeTab, setActiveTab] = useState<InstallationsTab>(initialTab || 'installations');
    
    const [view, setView] = useState<'list' | 'form'>('list');
    const [activeItem, setActiveItem] = useState<ManagedItem | null>(null);
    const [isNew, setIsNew] = useState(false);
const [deleteTarget, setDeleteTarget] = useState<ManagedItem | null>(null);
    const [deleteError, setDeleteError] = useState<string | null>(null);

    // Backup state: pending save data waiting on user's backup decision.
    // `preChangeItem` is a snapshot of the installation *before* the edit,
    // providing the path/id/name for backup creation.
    const [backupPending, setBackupPending] = useState<{
        savedData: ManagedItem;
        fromVersion: string;
        preChangeItem: ManagedItem;
    } | null>(null);

    // Restore state
    const [restoreTarget, setRestoreTarget] = useState<ManagedItem | null>(null);

    const { openLaunchModal, navigate } = useApp();
    const { 
        installations, 
        servers,
        downloadStatuses,
        addInstallation,
        updateInstallation,
        deleteInstallation,
        addServer,
        updateServer,
        deleteServer,
        setSelectedServerId,
        downloadVersion,
        cancelDownload,
        getInstallationDefaults,
        getServerDefaults,
    } = useData();

    useEffect(() => {
        if (initialTab && initialTab !== activeTab) {
            setActiveTab(initialTab);
            setView('list');
            setActiveItem(null);
        }
    }, [initialTab, activeTab]);

    const { items, itemTypeName, cardActionButtonText, cardStatusLabel } = activeTab === 'installations' 
    ? { 
        items: installations, 
        itemTypeName: 'Installation', 
        cardActionButtonText: 'Play', 
        cardStatusLabel: 'Last played' 
      }
    : { 
        items: servers, 
        itemTypeName: 'Server', 
        cardActionButtonText: 'Start', 
        cardStatusLabel: 'Status' 
      };
    
    const handleEdit = (item: ManagedItem) => {
        setActiveItem(item);
        setIsNew(false);
        setView('form');
    };

    const handleCreateNew = () => {
        const newItem = activeTab === 'installations' ? getInstallationDefaults() : getServerDefaults();
        setActiveItem(newItem);
        setIsNew(true);
        setView('form');
    };

    const handleSave = (savedData: ManagedItem) => {
        if (activeTab === 'installations') {
            const versionChanged = !isNew && activeItem !== null && savedData.version !== activeItem.version;
            if (versionChanged && activeItem !== null) {
                // Store a snapshot of the pre-change item so backup uses the
                // correct path/id even if the user also renamed the installation.
                // A shallow copy is sufficient: ManagedItem contains only
                // primitive values and optional arrays (none of which are mutated).
                setBackupPending({ savedData, fromVersion: activeItem.version, preChangeItem: { ...activeItem } });
                return;
            }
            const dataToSave = versionChanged ? { ...savedData, installed: false } : savedData;
            isNew ? addInstallation(dataToSave) : updateInstallation(dataToSave);
            if (versionChanged) {
                downloadVersion(savedData.id);
            }
        } else {
            isNew ? addServer(savedData) : updateServer(savedData);
        }
        setView('list');
        setActiveItem(null);
    };

    /** Apply the pending version-change save after the user decided about backup. */
    const applyVersionChange = (savedData: ManagedItem) => {
        updateInstallation({ ...savedData, installed: false });
        downloadVersion(savedData.id);
        setView('list');
        setActiveItem(null);
        setBackupPending(null);
    };

    const handleBackupAndContinue = async () => {
        if (!backupPending) return;
        const { savedData, preChangeItem } = backupPending;

        // Treat a missing launcher API as an error rather than silently skipping.
        if (typeof window === 'undefined' || !window.launcher?.installation?.backup) {
            throw new Error('Backup API is not available in this environment.');
        }

        const result = await window.launcher.installation.backup(
            preChangeItem.path,
            preChangeItem.id,
            savedData.name,  // use the new name from savedData for the backup filename
        );
        if (!result.success) {
            throw new Error(result.error ?? 'Backup failed');
        }
        applyVersionChange(savedData);
    };

    const handleSkipBackup = () => {
        if (!backupPending) return;
        applyVersionChange(backupPending.savedData);
    };

    const handleCancelBackup = () => {
        setBackupPending(null);
    };

    const handleCancel = () => {
        setView('list');
        setActiveItem(null);
    };

    const handleRepair = () => {
        if (!activeItem) return;
        const itemId = activeItem.id;
        setView('list');
        setActiveItem(null);
        downloadVersion(itemId);
    };

    const handleDelete = (id: string) => {
        const allItems = activeTab === 'installations' ? installations : servers;
        const item = allItems.find(i => i.id === id) ?? null;
        setDeleteError(null);
        setDeleteTarget(item);
    };

    const handleDeleteConfirm = async () => {
        if (!deleteTarget) return;
        const { id, path: itemPath } = deleteTarget;

        // Attempt to delete physical files.  Surface any error to the user
        // before removing the store record so they understand what happened.
        if (itemPath && typeof window !== 'undefined' && window.launcher?.installation) {
            try {
                const result = await window.launcher.installation.deleteFiles(itemPath);
                if (!result.success) {
                    const msg = result.error ?? 'Failed to delete files.';
                    console.error('[Installations] Failed to delete files:', msg);
                    setDeleteError(msg);
                    // Do not close the modal – let the user see the error.
                    return;
                }
            } catch (err: unknown) {
                const msg = String(err);
                console.error('[Installations] Failed to delete files:', msg);
                setDeleteError(msg);
                return;
            }
        }

        if (activeTab === 'installations') deleteInstallation(id);
        else deleteServer(id);

        setDeleteTarget(null);
        setDeleteError(null);
    };

    const handleDeleteCancel = () => {
        setDeleteTarget(null);
        setDeleteError(null);
    };

    const handleRestore = (item: ManagedItem) => {
        setRestoreTarget(item);
    };

    const handleRestored = () => {
        if (restoreTarget) {
            // Mark the installation as installed after a successful restore.
            updateInstallation({ ...restoreTarget, installed: true });
        }
        setRestoreTarget(null);
    };
    
    const handleTabChange = (tab: InstallationsTab) => {
        if (tab !== activeTab) {
            setActiveTab(tab);
            setView('list');
            setActiveItem(null);
        }
    }
    
    const TabButton: React.FC<{ isActive: boolean; onClick: () => void; children: React.ReactNode }> = ({ isActive, onClick, children }) => (
        <button
            onClick={onClick}
            className={`
                font-display text-2xl font-bold uppercase tracking-wider transition-colors duration-200 relative pb-2 px-1
                ${isActive ? 'text-white' : 'text-gray-500 hover:text-gray-300'}
            `}
        >
            {children}
            {isActive && (
                <div className="absolute bottom-0 left-0 w-full h-1 bg-starmade-accent rounded-full shadow-[0_0_8px_0px_#227b86]"></div>
            )}
        </button>
    );

    const renderContent = () => {
        if (view === 'form' && activeItem) {
            return (
                <InstallationForm
                    key={activeItem.id}
                    item={activeItem}
                    isNew={isNew}
                    onSave={handleSave}
                    onCancel={handleCancel}
                    onRepairInstall={!isNew ? handleRepair : undefined}
                    itemTypeName={itemTypeName}
                />
            );
        }

        return (
            <div className="h-full flex flex-col">
                <div className="flex justify-between items-center mb-6 flex-shrink-0 pr-4">
                    <div className="flex items-center gap-6">
                        <TabButton isActive={activeTab === 'installations'} onClick={() => handleTabChange('installations')}>
                            Installations
                        </TabButton>
                        <TabButton isActive={activeTab === 'servers'} onClick={() => handleTabChange('servers')}>
                            Servers
                        </TabButton>
                    </div>
                    <button
                        onClick={handleCreateNew}
                        className="
                        flex items-center gap-2 px-4 py-2 rounded-md border border-white/20
                        text-white font-semibold uppercase tracking-wider text-sm
                        hover:bg-white/10 hover:border-white/30 transition-colors
                    ">
                        <PlusIcon className="w-5 h-5" />
                        <span>New {itemTypeName}</span>
                    </button>
                </div>
                <div className="flex-grow space-y-4 overflow-y-auto pr-4">
                    {items.map((item, index) => (
                        <ItemCard 
                            key={item.id} 
                            item={item} 
                            isFeatured={index === 0} 
                            onEdit={handleEdit}
                            onDelete={handleDelete}
                            actionButtonText={cardActionButtonText}
                            statusLabel={cardStatusLabel}
                            downloadStatus={downloadStatuses[item.id]}
                            onDownload={() => downloadVersion(item.id)}
                            onCancelDownload={() => cancelDownload(item.id)}
                            onAction={activeTab === 'installations'
                                ? (i) => openLaunchModal(i)
                                : (server) => {
                                    setSelectedServerId(server.id);
                                    navigate('ServerPanel', { serverId: server.id, serverName: server.name });
                                }}
                            onOpenFolder={
                                typeof window !== 'undefined' && window.launcher?.shell
                                    ? (path) => window.launcher.shell!.openPath(path)
                                    : undefined
                            }
                            onRestore={activeTab === 'installations' ? handleRestore : undefined}
                        />
                    ))}
                </div>
            </div>
        );
    }
    
    return (
      <PageContainer>
        {renderContent()}
        <DeleteConfirmModal
            isOpen={deleteTarget !== null}
            itemName={deleteTarget?.name ?? ''}
            itemTypeName={itemTypeName}
            error={deleteError}
            onConfirm={handleDeleteConfirm}
            onCancel={handleDeleteCancel}
        />
        <BackupConfirmModal
            isOpen={backupPending !== null}
            installationName={backupPending?.savedData.name ?? ''}
            fromVersion={backupPending?.fromVersion ?? ''}
            toVersion={backupPending?.savedData.version ?? ''}
            onBackupAndContinue={handleBackupAndContinue}
            onSkipBackup={handleSkipBackup}
            onCancel={handleCancelBackup}
        />
        <RestoreBackupModal
            isOpen={restoreTarget !== null}
            installation={restoreTarget
                ? { id: restoreTarget.id, name: restoreTarget.name, path: restoreTarget.path }
                : null}
            onClose={() => setRestoreTarget(null)}
            onRestored={handleRestored}
        />
      </PageContainer>
    );
};

export default Installations;
