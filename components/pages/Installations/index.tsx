import React, { useState, useEffect, useCallback } from 'react';
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
import { formatPlayTime } from '../../../utils/formatPlayTime';
import useLegacyInstallImporter from '../../hooks/useLegacyInstallImporter';
import { dedupeLegacyInstallPaths } from '../../../utils/legacyImport';

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

    const { openLaunchModal, navigate, clearPageProps, serverPanelEnabled } = useApp();
    const { 
        installations, 
        servers,
        downloadStatuses,
        playTimeByInstallationMs,
        totalInstallPlayTimeMs,
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
        if (!initialTab) return;

        // Treat page-provided tab as a one-time navigation hint.
        setActiveTab((current) => (current === initialTab ? current : initialTab));
        setView('list');
        setActiveItem(null);
        clearPageProps();
    }, [initialTab, clearPageProps]);

    const { items, itemTypeName, cardActionButtonText, cardStatusLabel } = activeTab === 'installations' 
    ? { 
        items: installations, 
        itemTypeName: 'Installation', 
        cardActionButtonText: 'Play', 
        cardStatusLabel: 'Play time' 
      }
    : { 
        items: servers, 
        itemTypeName: 'Server', 
        cardActionButtonText: 'Start', 
        cardStatusLabel: 'Status' 
      };
    
    const handleEdit = useCallback((item: ManagedItem) => {
        setActiveItem(item);
        setIsNew(false);
        setView('form');
    }, []);

    const handleCreateNew = useCallback(() => {
        const newItem = activeTab === 'installations' ? getInstallationDefaults() : getServerDefaults();
        setActiveItem(newItem);
        setIsNew(true);
        setView('form');
    }, [activeTab, getInstallationDefaults, getServerDefaults]);

    const handleSave = useCallback((savedData: ManagedItem) => {
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
    }, [activeTab, isNew, activeItem, addInstallation, updateInstallation, downloadVersion, addServer, updateServer]);

    /** Apply the pending version-change save after the user decided about backup. */
    const applyVersionChange = useCallback((savedData: ManagedItem) => {
        updateInstallation({ ...savedData, installed: false });
        downloadVersion(savedData.id);
        setView('list');
        setActiveItem(null);
        setBackupPending(null);
    }, [updateInstallation, downloadVersion]);

    const handleBackupAndContinue = useCallback(async () => {
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
    }, [backupPending, applyVersionChange]);

    const handleSkipBackup = useCallback(() => {
        if (!backupPending) return;
        applyVersionChange(backupPending.savedData);
    }, [backupPending, applyVersionChange]);

    const handleCancelBackup = useCallback(() => {
        setBackupPending(null);
    }, []);

    const handleCancel = useCallback(() => {
        setView('list');
        setActiveItem(null);
    }, []);

    const handleRepair = useCallback(() => {
        if (!activeItem) return;
        const itemId = activeItem.id;
        setView('list');
        setActiveItem(null);
        downloadVersion(itemId);
    }, [activeItem, downloadVersion]);

    const handleDelete = useCallback((id: string) => {
        const allItems = activeTab === 'installations' ? installations : servers;
        const item = allItems.find(i => i.id === id) ?? null;
        setDeleteError(null);
        setDeleteTarget(item);
    }, [activeTab, installations, servers]);

    /** Drop the store record only. Never touches files on disk. */
    const removeRecord = useCallback((id: string) => {
        if (activeTab === 'installations') deleteInstallation(id);
        else deleteServer(id);
        setDeleteTarget(null);
        setDeleteError(null);
    }, [activeTab, deleteInstallation, deleteServer]);

    /** Primary, safe action: unlink from the launcher, leaving files on disk. */
    const handleRemoveFromLauncher = useCallback(() => {
        if (!deleteTarget) return;
        removeRecord(deleteTarget.id);
    }, [deleteTarget, removeRecord]);

    /** Destructive action: move files to the Recycle Bin, then unlink. */
    const handleDeleteFiles = useCallback(async () => {
        if (!deleteTarget) return;
        const { id, path: itemPath } = deleteTarget;

        // Attempt to recycle physical files.  Surface any error to the user
        // before removing the store record so they understand what happened.
        if (!deleteTarget.isRemote && itemPath && typeof window !== 'undefined' && window.launcher?.installation) {
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

        removeRecord(id);
    }, [deleteTarget, removeRecord]);

    const handleDeleteCancel = useCallback(() => {
        setDeleteTarget(null);
        setDeleteError(null);
    }, []);

    // ── Import existing installation (empty-state CTA) ────────────────────────
    const { importInstallations } = useLegacyInstallImporter();
    const [importError, setImportError] = useState<string | null>(null);
    const [isImporting, setIsImporting] = useState(false);

    const handleImportExisting = useCallback(async () => {
        if (typeof window === 'undefined' || !window.launcher?.dialog?.openFolder || !window.launcher?.legacy?.scanFolder) {
            return;
        }
        setImportError(null);
        setIsImporting(true);
        try {
            const folderPath = await window.launcher.dialog.openFolder();
            if (!folderPath) return;

            const found = await window.launcher.legacy.scanFolder(folderPath);
            const deduped = dedupeLegacyInstallPaths(found ?? []);
            if (deduped.length === 0) {
                setImportError('No StarMade installation was found in that folder.');
                return;
            }

            const { imported } = await importInstallations(deduped);
            if (imported.length === 0) {
                setImportError('That installation could not be imported — it may already be added.');
            }
        } catch (err) {
            setImportError(String(err));
        } finally {
            setIsImporting(false);
        }
    }, [importInstallations]);

    const handleRestore = useCallback((item: ManagedItem) => {
        setRestoreTarget(item);
    }, []);

    const handleRestored = useCallback(() => {
        if (restoreTarget) {
            // Mark the installation as installed after a successful restore.
            updateInstallation({ ...restoreTarget, installed: true });
        }
        setRestoreTarget(null);
    }, [restoreTarget, updateInstallation]);
    
    const handleTabChange = useCallback((tab: InstallationsTab) => {
        if (tab !== activeTab) {
            setActiveTab(tab);
            setView('list');
            setActiveItem(null);
        }
    }, [activeTab]);
    
    // If server hosting is disabled, never leave the user stranded on the
    // (now hidden) Servers tab.
    useEffect(() => {
        if (!serverPanelEnabled && activeTab === 'servers') {
            setActiveTab('installations');
        }
    }, [serverPanelEnabled, activeTab]);

    const handleInstallationsTabClick = useCallback(() => handleTabChange('installations'), [handleTabChange]);
    const handleServersTabClick = useCallback(() => handleTabChange('servers'), [handleTabChange]);
    
    // Create memoized handlers for ItemCard to prevent unnecessary re-renders during download updates
    const handleItemDownload = useCallback((itemId: string) => {
        downloadVersion(itemId);
    }, [downloadVersion]);
    
    const handleItemCancelDownload = useCallback((itemId: string) => {
        cancelDownload(itemId);
    }, [cancelDownload]);
    
    const handleItemAction = useCallback((item: ManagedItem) => {
        if (activeTab === 'installations') {
            openLaunchModal(item);
        } else {
            setSelectedServerId(item.id);
            navigate('ServerPanel', { serverId: item.id, serverName: item.name });
        }
    }, [activeTab, openLaunchModal, setSelectedServerId, navigate]);
    
    const handleOpenFolder = useCallback(async (path: string) => {
        if (typeof window === 'undefined' || !window.launcher?.shell) return;
        // Resolve relative/legacy paths to their stable absolute location before
        // opening, so the folder button works even for records created before the
        // path migration (a relative path can't be opened by the OS shell).
        let target = path;
        if (window.launcher.app?.resolveManagedPath) {
            target = (await window.launcher.app.resolveManagedPath(path).catch(() => path)) || path;
        }
        window.launcher.shell.openPath(target);
    }, []);
    
    const TabButton: React.FC<{ isActive: boolean; onClick: () => void; children: React.ReactNode }> = React.memo(({ isActive, onClick, children }) => (
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
    ));

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
                        <TabButton isActive={activeTab === 'installations'} onClick={handleInstallationsTabClick}>
                            Installations
                        </TabButton>
                        {serverPanelEnabled && (
                            <TabButton isActive={activeTab === 'servers'} onClick={handleServersTabClick}>
                                Servers
                            </TabButton>
                        )}
                        {activeTab === 'installations' && (
                            <p className="text-sm text-gray-300 border border-white/10 rounded-md px-3 py-1 bg-black/20">
                                Total play time: <span className="text-white font-semibold">{formatPlayTime(totalInstallPlayTimeMs)}</span>
                            </p>
                        )}
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
                    {items.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-center px-6">
                            <h3 className="font-display text-xl font-bold uppercase tracking-wider text-white">
                                No {itemTypeName.toLowerCase()}s yet
                            </h3>
                            <p className="mt-3 max-w-md text-sm text-gray-400 leading-relaxed">
                                {activeTab === 'installations'
                                    ? 'Create a new installation to download the game, or import an existing StarMade folder you already have on disk.'
                                    : `Create a new ${itemTypeName.toLowerCase()} to get started.`}
                            </p>
                            <div className="mt-6 flex items-center gap-4 flex-wrap justify-center">
                                <button
                                    onClick={handleCreateNew}
                                    className="flex items-center gap-2 px-5 py-2.5 rounded-md bg-starmade-accent hover:brightness-110 transition-colors text-white font-bold uppercase tracking-wider text-sm"
                                >
                                    <PlusIcon className="w-5 h-5" />
                                    <span>Create new {itemTypeName.toLowerCase()}</span>
                                </button>
                                {activeTab === 'installations'
                                    && typeof window !== 'undefined'
                                    && window.launcher?.dialog?.openFolder
                                    && window.launcher?.legacy?.scanFolder && (
                                    <button
                                        onClick={() => { void handleImportExisting(); }}
                                        disabled={isImporting}
                                        className="px-5 py-2.5 rounded-md border border-white/20 text-white font-semibold uppercase tracking-wider text-sm hover:bg-white/10 hover:border-white/30 transition-colors disabled:opacity-60"
                                    >
                                        {isImporting ? 'Importing…' : 'Import existing installation'}
                                    </button>
                                )}
                            </div>
                            {importError && (
                                <p className="mt-4 text-xs text-red-300 bg-red-900/20 border border-red-900/40 rounded-md px-3 py-2 max-w-md">
                                    {importError}
                                </p>
                            )}
                        </div>
                    ) : (
                        items.map((item, index) => (
                            <ItemCard
                                key={item.id}
                                item={item}
                                isFeatured={index === 0}
                                showServerModeBadge={activeTab === 'servers'}
                                onEdit={handleEdit}
                                onDelete={handleDelete}
                                actionButtonText={cardActionButtonText}
                                statusLabel={cardStatusLabel}
                                statusValue={activeTab === 'installations'
                                    ? formatPlayTime(playTimeByInstallationMs[item.id] ?? 0)
                                    : item.lastPlayed}
                                downloadStatus={downloadStatuses[item.id]}
                                onDownload={() => handleItemDownload(item.id)}
                                onCancelDownload={() => handleItemCancelDownload(item.id)}
                                onAction={handleItemAction}
                                onOpenFolder={typeof window !== 'undefined' && window.launcher?.shell ? handleOpenFolder : undefined}
                                onRestore={activeTab === 'installations' ? handleRestore : undefined}
                            />
                        ))
                    )}
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
            itemPath={deleteTarget?.isRemote ? undefined : deleteTarget?.path}
            error={deleteError}
            onRemoveFromLauncher={handleRemoveFromLauncher}
            onDeleteFiles={handleDeleteFiles}
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
