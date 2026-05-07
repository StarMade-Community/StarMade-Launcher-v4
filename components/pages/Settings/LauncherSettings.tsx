import React, { useState, useEffect } from 'react';
import CustomDropdown from '../../common/CustomDropdown';
import { FolderIcon } from '../../common/icons';
import useLegacyInstallImporter from '../../hooks/useLegacyInstallImporter';
import type { LauncherCloseBehavior, LauncherSettingsData } from '@/types';
import UpdateAvailableModal from '../../common/UpdateAvailableModal';
import {
    LEGACY_IMPORT_PROMPT_STORE_KEY,
    dedupeLegacyInstallPaths,
    parseLegacyImportPromptState,
} from '@/utils/legacyImport';

// ─── Types ───────────────────────────────────────────────────────────────────

interface UpdateInfo {
    available: boolean;
    latestVersion: string;
    currentVersion: string;
    releaseNotes: string;
    downloadUrl: string;
    assetUrl?: string;
    assetName?: string;
    isPreRelease?: boolean;
}

// ─── Store key ───────────────────────────────────────────────────────────────

const STORE_KEY = 'launcherSettings';

const DEFAULT_SETTINGS: LauncherSettingsData = {
    checkForUpdates: true,
    useBetaChannel: false,
    showLog: false,
    language: 'English (US)',
    closeBehavior: 'Close launcher',
};

// ─── Sub-components ──────────────────────────────────────────────────────────

const SettingRow: React.FC<{ title: string; description: string; children: React.ReactNode }> = ({ title, description, children }) => (
    <div className="flex justify-between items-center bg-black/20 p-4 rounded-lg border border-white/10">
        <div>
            <h3 className="font-semibold text-white">{title}</h3>
            <p className="text-sm text-gray-400">{description}</p>
        </div>
        <div>
            {children}
        </div>
    </div>
);

const ToggleSwitch: React.FC<{ checked: boolean; onChange: (checked: boolean) => void }> = ({ checked, onChange }) => (
    <button
        onClick={() => onChange(!checked)}
        className={`relative inline-flex items-center h-6 rounded-full w-11 transition-colors ${checked ? 'bg-starmade-accent' : 'bg-slate-600'}`}
        role="switch"
        aria-checked={checked}
    >
        <span className={`inline-block w-4 h-4 transform bg-white rounded-full transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
    </button>
);

// ─── Main component ──────────────────────────────────────────────────────────

const LauncherSettings: React.FC = () => {
    const { isKnownPath, importInstallation } = useLegacyInstallImporter();
    const [isLoaded, setIsLoaded] = useState(false);
    const [settings, setSettings] = useState<LauncherSettingsData>(DEFAULT_SETTINGS);
    const [userDataPath, setUserDataPath] = useState<string>('');
    const [javaRuntimes, setJavaRuntimes] = useState<{
        bundled: Array<{ version: string; path: string; source: string }>;
        system: Array<{ version: string; path: string; source: string }>;
    }>({ bundled: [], system: [] });
    const [isLoadingJava, setIsLoadingJava] = useState(false);
    const [javaDownloadProgress, setJavaDownloadProgress] = useState<Record<string, string>>({});
    const [legacyFound, setLegacyFound] = useState<string[]>([]);
    const [isScanning, setIsScanning] = useState(false);
    const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
    const [updateCheckResult, setUpdateCheckResult] = useState<string | null>(null);
    const [updateModalInfo, setUpdateModalInfo] = useState<UpdateInfo | null>(null);
    const [isUpdateModalOpen, setIsUpdateModalOpen] = useState(false);

    // ── Beta channel confirmation dialog state ────────────────────────────────
    const [betaConfirmOpen, setBetaConfirmOpen] = useState(false);
    const [pendingBetaValue, setPendingBetaValue] = useState<boolean>(false);

    // ── Clear all data confirmation state ────────────────────────────────────
    const [clearDataConfirmOpen, setClearDataConfirmOpen] = useState(false);
    const [isClearingData, setIsClearingData] = useState(false);

    // ── Backup state ─────────────────────────────────────────────────────────
    const [isCreatingBackup, setIsCreatingBackup] = useState(false);
    const [backupResult, setBackupResult] = useState<string | null>(null);
    const [backupList, setBackupList] = useState<Array<{ name: string; path: string; date: string }>>([]);
    const [isLoadingBackups, setIsLoadingBackups] = useState(false);
    const [isRestoringBackup, setIsRestoringBackup] = useState(false);

    const languageOptions = [
        { value: 'English', label: 'English' }, //Todo: Support other languages, and maybe have this set the game's language if possible
    ];
    
    const closeBehaviorOptions: Array<{ value: LauncherCloseBehavior; label: string }> = [
        { value: 'Close launcher', label: 'Close launcher' },
        { value: 'Hide launcher', label: 'Hide launcher' },
        { value: 'Keep the launcher open', label: 'Keep the launcher open' },
    ];

    // Load persisted settings on mount
    useEffect(() => {
        if (typeof window === 'undefined' || !window.launcher?.store) {
            setIsLoaded(true);
            return;
        }

        window.launcher.store.get(LEGACY_IMPORT_PROMPT_STORE_KEY)
            .then((stored) => {
                const promptState = parseLegacyImportPromptState(stored);
                if (promptState?.status === 'pending' && promptState.paths.length > 0) {
                    setLegacyFound(prev => dedupeLegacyInstallPaths([...prev, ...promptState.paths]));
                }
            })
            .catch(() => {});

        window.launcher.store.get(STORE_KEY).then((stored) => {
            if (stored && typeof stored === 'object') {
                setSettings({ ...DEFAULT_SETTINGS, ...(stored as Partial<LauncherSettingsData>) });
            }
            setIsLoaded(true);
        }).catch(() => setIsLoaded(true));

        // Get userData path for display
        if (window.launcher?.app) {
            window.launcher.app.getUserDataPath()
                .then(p => setUserDataPath(p))
                .catch(() => {});
        }
        
        // Load Java runtimes
        loadJavaRuntimes();

        // Load backup list
        loadBackups();
    }, []);

    // Listen for first-startup legacy scan results pushed from the main process
    useEffect(() => {
        if (typeof window === 'undefined' || !window.launcher?.legacy?.onScanResult) return;
        const cleanup = window.launcher.legacy.onScanResult((paths) => {
            setLegacyFound(prev => dedupeLegacyInstallPaths([...prev, ...paths]));
        });
        return cleanup;
    }, []);

    const loadJavaRuntimes = async () => {
        if (typeof window === 'undefined' || !window.launcher?.java) {
            return;
        }
        try {
            const runtimes = await window.launcher.java.list();
            setJavaRuntimes(runtimes);
        } catch (error) {
            console.error('Failed to load Java runtimes:', error);
        }
    };

    const handleDetectJava = async () => {
        if (typeof window === 'undefined' || !window.launcher?.java) {
            return;
        }
        setIsLoadingJava(true);
        try {
            await window.launcher.java.detect();
            await loadJavaRuntimes();
        } catch (error) {
            console.error('Failed to detect Java:', error);
        } finally {
            setIsLoadingJava(false);
        }
    };

    const handleDownloadJava = async (version: 8 | 21) => {
        if (typeof window === 'undefined' || !window.launcher?.java) {
            return;
        }
        setJavaDownloadProgress(prev => ({ ...prev, [version]: 'Downloading...' }));
        try {
            const result = await window.launcher.java.download(version);
            if (result.success) {
                setJavaDownloadProgress(prev => ({ ...prev, [version]: 'Installed!' }));
                await loadJavaRuntimes();
                setTimeout(() => {
                    setJavaDownloadProgress(prev => {
                        const next = { ...prev };
                        delete next[version];
                        return next;
                    });
                }, 3000);
            } else {
                setJavaDownloadProgress(prev => ({ ...prev, [version]: `Error: ${result.error}` }));
            }
        } catch (error) {
            setJavaDownloadProgress(prev => ({ ...prev, [version]: `Error: ${String(error)}` }));
        }
    };

    // Persist whenever settings change (skip the initial default render)
    useEffect(() => {
        if (isLoaded && typeof window !== 'undefined' && window.launcher?.store) {
            window.launcher.store.set(STORE_KEY, settings);
        }
    }, [settings, isLoaded]);

    const update = <K extends keyof LauncherSettingsData>(key: K, value: LauncherSettingsData[K]) => {
        setSettings(prev => ({ ...prev, [key]: value }));
    };

    // ── Legacy installation detection ────────────────────────────────────────

    const handleAutoDetect = async () => {
        if (typeof window === 'undefined' || !window.launcher?.legacy) return;
        setIsScanning(true);
        try {
            const found = await window.launcher.legacy.scan();
            setLegacyFound(dedupeLegacyInstallPaths(found));
        } catch (error) {
            console.error('Failed to scan for legacy installs:', error);
        } finally {
            setIsScanning(false);
        }
    };

    const handleScanFolder = async () => {
        if (typeof window === 'undefined' || !window.launcher?.legacy || !window.launcher?.dialog) return;
        const folder = await window.launcher.dialog.openFolder();
        if (!folder) return;
        setIsScanning(true);
        try {
            const found = await window.launcher.legacy.scanFolder(folder);
            setLegacyFound(prev => dedupeLegacyInstallPaths([...prev, ...found]));
        } catch (error) {
            console.error('Failed to scan folder for legacy installs:', error);
        } finally {
            setIsScanning(false);
        }
    };

    const handleImport = async (installPath: string) => {
        await importInstallation(installPath);
    };

    const handleCheckForUpdates = async () => {
        if (typeof window === 'undefined' || !window.launcher?.updater) return;
        setIsCheckingUpdate(true);
        setUpdateCheckResult(null);
        try {
            const info = await window.launcher.updater.checkForUpdates({
                includePreReleases: settings.useBetaChannel,
            });
            if (info.available) {
                setUpdateModalInfo(info);
                setIsUpdateModalOpen(true);
                setUpdateCheckResult(`Update available: v${info.latestVersion}`);
            } else {
                setUpdateCheckResult(`You're up to date! (v${info.currentVersion})`);
            }
        } catch (error) {
            console.error('Failed to check for launcher updates:', error);
            setUpdateCheckResult('Failed to check for updates. Please try again later.');
        } finally {
            setIsCheckingUpdate(false);
            const UPDATE_MESSAGE_DISPLAY_DURATION_MS = 6_000;
            setTimeout(() => setUpdateCheckResult(null), UPDATE_MESSAGE_DISPLAY_DURATION_MS);
        }
    };

    // ── Beta channel handlers ─────────────────────────────────────────────────

    /** Called when the user clicks the beta channel toggle. */
    const handleBetaChannelToggle = (newValue: boolean) => {
        setPendingBetaValue(newValue);
        setBetaConfirmOpen(true);
    };

    /** Confirm the beta channel switch (optionally with backup). */
    const confirmBetaSwitch = async (withBackup: boolean) => {
        setBetaConfirmOpen(false);
        if (withBackup) {
            await handleCreateBackup();
        }
        update('useBetaChannel', pendingBetaValue);
    };

    // ── Backup handlers ───────────────────────────────────────────────────────

    const loadBackups = async () => {
        if (typeof window === 'undefined' || !window.launcher?.backup) return;
        setIsLoadingBackups(true);
        try {
            const list = await window.launcher.backup.list();
            setBackupList(list);
        } catch (error) {
            console.error('Failed to load backups:', error);
        } finally {
            setIsLoadingBackups(false);
        }
    };

    const handleCreateBackup = async () => {
        if (typeof window === 'undefined' || !window.launcher?.backup) return;
        setIsCreatingBackup(true);
        setBackupResult(null);
        try {
            const result = await window.launcher.backup.create();
            if (result.success) {
                setBackupResult('Backup created successfully.');
                await loadBackups();
            } else {
                setBackupResult(`Backup failed: ${result.error}`);
            }
        } catch (error) {
            setBackupResult(`Backup failed: ${String(error)}`);
        } finally {
            setIsCreatingBackup(false);
            const RESULT_DISPLAY_DURATION_MS = 6_000;
            setTimeout(() => setBackupResult(null), RESULT_DISPLAY_DURATION_MS);
        }
    };

    const handleRestoreBackup = async (backupPath: string) => {
        if (typeof window === 'undefined' || !window.launcher?.backup) return;
        setIsRestoringBackup(true);
        try {
            const result = await window.launcher.backup.restore(backupPath);
            if (!result.success) {
                alert(`Restore failed: ${result.error}`);
            }
            // On success the app relaunches; no further UI update needed.
        } catch (error) {
            alert(`Restore failed: ${String(error)}`);
        } finally {
            setIsRestoringBackup(false);
        }
    };

    const handleClearAllData = async () => {
        if (typeof window === 'undefined' || !window.launcher?.store) return;
        setIsClearingData(true);
        try {
            await window.launcher.store.clearAll();
            // The main process will relaunch; nothing more to do here.
        } catch (error) {
            alert(`Failed to clear data: ${String(error)}`);
            setIsClearingData(false);
        }
    };

    return (
        <div className="h-full flex flex-col">
            <UpdateAvailableModal
                isOpen={isUpdateModalOpen}
                updateInfo={updateModalInfo}
                onDismiss={() => setIsUpdateModalOpen(false)}
            />

            {/* ── Clear-all-data confirmation dialog ──────────────────────────────── */}
            {clearDataConfirmOpen && (
                <div
                    className="fixed inset-0 bg-black/70 backdrop-blur-md z-50 flex items-center justify-center"
                    aria-modal="true"
                    role="dialog"
                    aria-labelledby="reset-launcher-confirm-title"
                >
                    <div className="relative bg-starmade-bg/90 border border-red-500/40 rounded-xl shadow-2xl w-full max-w-md p-8">
                        <h2
                            id="reset-launcher-confirm-title"
                            className="font-display text-xl font-bold uppercase text-red-400 tracking-wider mb-3"
                        >
                            Reset Launcher?
                        </h2>
                        <p className="text-sm text-gray-300 mb-2">
                            This will reset all launcher settings, accounts, sessions, and pinned items. <span className="text-white font-semibold">Installed game files on disk will not be deleted</span> and can be reimported.
                        </p>
                        <p className="text-sm text-gray-400 mb-6">
                            The launcher will restart with a fresh configuration.
                        </p>
                        <div className="flex flex-col gap-3">
                            <button
                                onClick={() => { setClearDataConfirmOpen(false); void handleClearAllData(); }}
                                disabled={isClearingData}
                                className="w-full px-4 py-2 rounded-md bg-red-600 hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-bold uppercase tracking-wider"
                            >
                                {isClearingData ? 'Resetting…' : 'Yes, Reset & Restart'}
                            </button>
                            <button
                                onClick={() => setClearDataConfirmOpen(false)}
                                disabled={isClearingData}
                                className="w-full px-4 py-2 rounded-md bg-transparent hover:bg-white/10 border border-white/10 transition-colors text-sm font-semibold uppercase tracking-wider text-gray-400"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Beta channel confirmation dialog ─────────────────────────────── */}
            {betaConfirmOpen && (
                <div
                    className="fixed inset-0 bg-black/70 backdrop-blur-md z-50 flex items-center justify-center"
                    aria-modal="true"
                    role="dialog"
                    aria-labelledby="beta-confirm-title"
                >
                    <div className="relative bg-starmade-bg/90 border border-starmade-accent/30 rounded-xl shadow-2xl w-full max-w-md p-8">
                        <h2
                            id="beta-confirm-title"
                            className="font-display text-xl font-bold uppercase text-white tracking-wider mb-3"
                        >
                            {pendingBetaValue ? 'Switch to Beta Channel' : 'Switch to Stable Channel'}
                        </h2>
                        <p className="text-sm text-gray-300 mb-2">
                            {pendingBetaValue
                                ? 'You are switching to the beta channel. Beta releases may be unstable and include experimental features.'
                                : 'You are switching back to the stable channel.'}
                        </p>
                        <p className="text-sm text-gray-400 mb-6">
                            Would you like to create a backup of your launcher settings and data before switching?
                        </p>
                        <div className="flex flex-col gap-3">
                            <button
                                onClick={() => confirmBetaSwitch(true)}
                                className="w-full px-4 py-2 rounded-md bg-starmade-accent hover:bg-starmade-accent/80 transition-colors text-sm font-bold uppercase tracking-wider"
                            >
                                Create Backup &amp; Switch
                            </button>
                            <button
                                onClick={() => confirmBetaSwitch(false)}
                                className="w-full px-4 py-2 rounded-md bg-slate-700 hover:bg-slate-600 transition-colors text-sm font-semibold uppercase tracking-wider"
                            >
                                Switch Without Backup
                            </button>
                            <button
                                onClick={() => setBetaConfirmOpen(false)}
                                className="w-full px-4 py-2 rounded-md bg-transparent hover:bg-white/10 border border-white/10 transition-colors text-sm font-semibold uppercase tracking-wider text-gray-400"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}
            <h2 className="flex-shrink-0 font-display text-xl font-bold uppercase tracking-wider text-white mb-4 pb-2 border-b-2 border-white/10">
                General
            </h2>

            <div className="flex-grow overflow-y-auto pr-4">
                <div className="space-y-4">
                    <SettingRow title="Language" description="Choose the language for the launcher UI.">
                        <CustomDropdown 
                            className="w-64"
                            options={languageOptions} 
                            value={settings.language} 
                            onChange={(v) => update('language', v)} 
                        />
                    </SettingRow>
                    <SettingRow title="After Launching Game" description="Control what happens to the launcher after the game starts.">
                         <CustomDropdown 
                            className="w-64"
                            options={closeBehaviorOptions} 
                            value={settings.closeBehavior} 
                            onChange={(v) => update('closeBehavior', v)} 
                        />
                    </SettingRow>
                </div>

                <div className="mt-8">
                    <h2 className="font-display text-xl font-bold uppercase tracking-wider text-white mb-4 pb-2 border-b-2 border-white/10">
                        Updates & Java
                    </h2>
                    <div className="space-y-4">
                        <SettingRow title="Check for launcher updates" description="Automatically check for updates when the launcher starts.">
                            <ToggleSwitch checked={settings.checkForUpdates} onChange={(v) => update('checkForUpdates', v)} />
                        </SettingRow>
                        <SettingRow
                            title="Use Beta Channel"
                            description="Receive pre-release launcher updates. Beta builds may be unstable. You will be prompted to create a backup when switching channels."
                        >
                            <ToggleSwitch checked={settings.useBetaChannel} onChange={handleBetaChannelToggle} />
                        </SettingRow>
                         <SettingRow title="Check for updates now" description="Manually check for a new version of the launcher.">
                            <div className="flex flex-col items-end gap-1">
                                <button
                                    onClick={handleCheckForUpdates}
                                    disabled={isCheckingUpdate}
                                    className="px-4 py-2 rounded-md bg-slate-700 hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-semibold uppercase tracking-wider"
                                >
                                    {isCheckingUpdate ? 'Checking…' : 'Check Now'}
                                </button>
                                {updateCheckResult && (
                                    <span className="text-xs text-gray-400">{updateCheckResult}</span>
                                )}
                            </div>
                        </SettingRow>
                    </div>
                </div>

                <div className="mt-8">
                    <h2 className="font-display text-xl font-bold uppercase tracking-wider text-white mb-4 pb-2 border-b-2 border-white/10">
                        Manage Java
                    </h2>
                    
                    {/* Java Runtime List */}
                    <div className="space-y-2 mb-4">
                        {javaRuntimes.bundled.length === 0 && javaRuntimes.system.length === 0 && (
                            <div className="text-gray-400 text-sm italic p-3 bg-black/20 rounded-md">
                                No Java runtimes detected. Download Java 8 or Java 21 below.
                            </div>
                        )}
                        
                        {javaRuntimes.bundled.map((jre, i) => (
                            <div key={`bundled-${i}`} className="flex items-center justify-between p-3 bg-black/20 rounded-md border border-starmade-accent/30">
                                <div>
                                    <span className="font-semibold text-white">Java {jre.version}</span>
                                    <span className="text-sm text-starmade-accent ml-2">(bundled)</span>
                                </div>
                                <span className="text-xs text-gray-500 font-mono truncate max-w-md">{jre.path}</span>
                            </div>
                        ))}
                        
                        {javaRuntimes.system.map((jre, i) => (
                            <div key={`system-${i}`} className="flex items-center justify-between p-3 bg-black/20 rounded-md border border-white/10">
                                <div>
                                    <span className="font-semibold text-white">Java {jre.version}</span>
                                    <span className="text-sm text-gray-400 ml-2">(system)</span>
                                </div>
                                <span className="text-xs text-gray-500 font-mono truncate max-w-md">{jre.path}</span>
                            </div>
                        ))}
                    </div>
                    
                    {/* Action Buttons */}
                    <div className="flex flex-wrap gap-3">
                        <button 
                            onClick={handleDetectJava} 
                            disabled={isLoadingJava}
                            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 disabled:bg-slate-800 disabled:text-gray-500 rounded-md text-sm font-semibold uppercase tracking-wider transition-colors"
                        >
                            {isLoadingJava ? 'Detecting...' : 'Detect Java'}
                        </button>
                        
                        <button 
                            onClick={() => handleDownloadJava(8)} 
                            disabled={!!javaDownloadProgress[8]}
                            className="px-4 py-2 bg-starmade-accent hover:bg-starmade-accent/80 disabled:bg-starmade-accent/50 rounded-md text-sm font-semibold uppercase tracking-wider transition-colors"
                        >
                            {javaDownloadProgress[8] || 'Download Java 8'}
                        </button>
                        
                        <button
                            onClick={() => handleDownloadJava(21)}
                            disabled={!!javaDownloadProgress[21]}
                            className="px-4 py-2 bg-starmade-accent hover:bg-starmade-accent/80 disabled:bg-starmade-accent/50 rounded-md text-sm font-semibold uppercase tracking-wider transition-colors"
                        >
                            {javaDownloadProgress[21] || 'Download Java 21'}
                        </button>
                    </div>

                    <p className="text-xs text-gray-400 mt-3">
                        StarMade versions &lt; 0.3.x require Java 8. Versions ≥ 0.3.x require Java 21.
                    </p>
                </div>

                <div className="mt-8">
                    <h2 className="font-display text-xl font-bold uppercase tracking-wider text-white mb-4 pb-2 border-b-2 border-white/10">
                        Game Log
                    </h2>
                    <div className="space-y-4">
                        <SettingRow title="Show StarMade Log" description="Shows a window that streams the log after the game has started.">
                            <ToggleSwitch checked={settings.showLog} onChange={(v) => update('showLog', v)} />
                        </SettingRow>
                    </div>
                </div>

                <div className="mt-8">
                    <h2 className="font-display text-xl font-bold uppercase tracking-wider text-white mb-4 pb-2 border-b-2 border-white/10">
                        Data Folder
                    </h2>
                    <div className="space-y-4">
                        <SettingRow
                            title="User Data Directory"
                            description="Stores launcher config, backgrounds, and icons. Drop images into the backgrounds/ and icons/ subfolders."
                        >
                            <div className="flex items-center gap-2 min-w-0">
                                {userDataPath && (
                                    <span className="text-xs text-gray-400 font-mono truncate max-w-[260px]" title={userDataPath}>
                                        {userDataPath}
                                    </span>
                                )}
                                <button
                                    onClick={() => {
                                        if (userDataPath && window.launcher?.shell) {
                                            window.launcher.shell.openPath(userDataPath);
                                        }
                                    }}
                                    disabled={!userDataPath}
                                    className="flex items-center gap-2 px-4 py-2 rounded-md bg-slate-700 hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-semibold uppercase tracking-wider flex-shrink-0"
                                >
                                    <FolderIcon className="w-4 h-4" />
                                    Open Folder
                                </button>
                            </div>
                        </SettingRow>
                    </div>
                </div>

                <div className="mt-8">
                    <h2 className="font-display text-xl font-bold uppercase tracking-wider text-white mb-4 pb-2 border-b-2 border-white/10">
                        Backups
                    </h2>
                    <p className="text-sm text-gray-400 mb-4">
                        Back up and restore your launcher settings and user data (accounts, installations, backgrounds, icons).
                    </p>

                    <div className="flex flex-wrap gap-3 mb-4">
                        <button
                            onClick={handleCreateBackup}
                            disabled={isCreatingBackup}
                            className="px-4 py-2 bg-starmade-accent hover:bg-starmade-accent/80 disabled:bg-starmade-accent/50 rounded-md text-sm font-semibold uppercase tracking-wider transition-colors"
                        >
                            {isCreatingBackup ? 'Creating Backup…' : 'Create Backup Now'}
                        </button>
                    </div>

                    {backupResult && (
                        <p className="text-sm text-gray-300 mb-4">{backupResult}</p>
                    )}

                    {/* Backup list */}
                    {isLoadingBackups ? (
                        <div className="text-gray-400 text-sm italic p-3 bg-black/20 rounded-md">
                            Loading backups…
                        </div>
                    ) : backupList.length === 0 ? (
                        <div className="text-gray-400 text-sm italic p-3 bg-black/20 rounded-md">
                            No backups yet. Click <span className="text-white not-italic">Create Backup Now</span> to create one.
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {backupList.map(backup => (
                                <div key={backup.name} className="flex items-center justify-between gap-3 p-3 bg-black/20 rounded-md border border-white/10">
                                    <span className="text-xs text-gray-300 font-mono truncate flex-1 min-w-0" title={backup.path}>
                                        {new Date(backup.date).toLocaleString()}
                                    </span>
                                    <button
                                        onClick={() => handleRestoreBackup(backup.path)}
                                        disabled={isRestoringBackup}
                                        className="flex-shrink-0 px-3 py-1 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-md text-sm font-semibold uppercase tracking-wider transition-colors"
                                    >
                                        {isRestoringBackup ? 'Restoring…' : 'Restore'}
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className="mt-8">
                    <h2 className="font-display text-xl font-bold uppercase tracking-wider text-white mb-1 pb-2 border-b-2 border-white/10">
                        Legacy Installations
                    </h2>
                    <p className="text-sm text-gray-400 mb-4">
                        Import StarMade installations from older (pre-v4) launchers. The launcher will scan for folders containing <span className="font-mono text-gray-300">StarMade.jar</span>.
                    </p>

                    {/* Action buttons */}
                    <div className="flex flex-wrap gap-3 mb-4">
                        <button
                            onClick={handleAutoDetect}
                            disabled={isScanning}
                            className="px-4 py-2 bg-starmade-accent hover:bg-starmade-accent/80 disabled:bg-starmade-accent/50 rounded-md text-sm font-semibold uppercase tracking-wider transition-colors"
                        >
                            {isScanning ? 'Scanning…' : 'Auto-Detect'}
                        </button>
                        <button
                            onClick={handleScanFolder}
                            disabled={isScanning}
                            className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 disabled:bg-slate-800 disabled:text-gray-500 rounded-md text-sm font-semibold uppercase tracking-wider transition-colors"
                        >
                            <FolderIcon className="w-4 h-4" />
                            Add Folder…
                        </button>
                    </div>

                    {/* Results list */}
                    {legacyFound.length === 0 ? (
                        <div className="text-gray-400 text-sm italic p-3 bg-black/20 rounded-md">
                            No legacy installations found yet. Click <span className="text-white not-italic">Auto-Detect</span> to scan automatically or <span className="text-white not-italic">Add Folder…</span> to browse for an old install.
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {legacyFound.map((installPath) => {
                                const alreadyAdded = isKnownPath(installPath);
                                return (
                                    <div key={installPath} className="flex items-center justify-between gap-3 p-3 bg-black/20 rounded-md border border-white/10">
                                        <span className="text-xs text-gray-300 font-mono truncate flex-1 min-w-0" title={installPath}>
                                            {installPath}
                                        </span>
                                        {alreadyAdded ? (
                                            <span className="text-xs text-starmade-accent font-semibold uppercase tracking-wider flex-shrink-0">
                                                Imported
                                            </span>
                                        ) : (
                                            <button
                                                onClick={() => handleImport(installPath)}
                                                className="flex-shrink-0 px-3 py-1 bg-starmade-accent hover:bg-starmade-accent/80 rounded-md text-sm font-semibold uppercase tracking-wider transition-colors"
                                            >
                                                Import
                                            </button>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                <div className="mt-8">
                    <h2 className="font-display text-xl font-bold uppercase tracking-wider text-red-400 mb-4 pb-2 border-b-2 border-red-500/30">
                        Danger Zone
                    </h2>
                    <div className="space-y-4">
                        <SettingRow
                            title="Reset Launcher"
                            description="Reset all launcher settings, accounts, and sessions, then restart. Installed game files on disk are kept and can be reimported."
                        >
                            <button
                                onClick={() => setClearDataConfirmOpen(true)}
                                className="px-4 py-2 rounded-md bg-red-700/60 hover:bg-red-600/80 border border-red-500/40 text-red-200 transition-colors text-sm font-semibold uppercase tracking-wider"
                            >
                                Reset Launcher
                            </button>
                        </SettingRow>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default LauncherSettings;