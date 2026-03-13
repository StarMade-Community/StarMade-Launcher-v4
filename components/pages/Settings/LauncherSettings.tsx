import React, { useState, useEffect } from 'react';
import CustomDropdown from '../../common/CustomDropdown';
import { FolderIcon } from '../../common/icons';
import { useData } from '@/contexts/DataContext';
import UpdateAvailableModal from '../../common/UpdateAvailableModal';

// ─── Types ───────────────────────────────────────────────────────────────────

interface UpdateInfo {
    available: boolean;
    latestVersion: string;
    currentVersion: string;
    releaseNotes: string;
    downloadUrl: string;
    assetUrl?: string;
    assetName?: string;
}

// ─── Store key ───────────────────────────────────────────────────────────────

const STORE_KEY = 'launcherSettings';

interface LauncherSettingsData {
    checkForUpdates: boolean;
    showLog: boolean;
    language: string;
    closeBehavior: string;
}

const DEFAULT_SETTINGS: LauncherSettingsData = {
    checkForUpdates: true,
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
    const { installations, addInstallation } = useData();
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
    const [importedPaths, setImportedPaths] = useState<Set<string>>(new Set());
    const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
    const [updateCheckResult, setUpdateCheckResult] = useState<string | null>(null);
    const [updateModalInfo, setUpdateModalInfo] = useState<UpdateInfo | null>(null);
    const [isUpdateModalOpen, setIsUpdateModalOpen] = useState(false);

    const languageOptions = [
        { value: 'English', label: 'English' }, //Todo: Support other languages, and maybe have this set the game's language if possible
    ];
    
    const closeBehaviorOptions = [
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

    const handleDownloadJava = async (version: 8 | 25) => {
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

    /** Paths already present in the installations list */
    const existingPaths = new Set(installations.map(i => i.path));

    const handleAutoDetect = async () => {
        if (typeof window === 'undefined' || !window.launcher?.legacy) return;
        setIsScanning(true);
        try {
            const found = await window.launcher.legacy.scan();
            setLegacyFound(found);
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
            // Merge with existing results, avoiding duplicates
            setLegacyFound(prev => Array.from(new Set([...prev, ...found])));
        } catch (error) {
            console.error('Failed to scan folder for legacy installs:', error);
        } finally {
            setIsScanning(false);
        }
    };

    const handleImport = async (installPath: string) => {
        // Guard against duplicate imports (e.g. rapid double-click before re-render)
        if (existingPaths.has(installPath) || importedPaths.has(installPath)) return;

        // Read user-configured default memory settings so they are applied to the imported item
        let maxMemory: number | undefined;
        let extraJvmArgs: string | undefined;

        if (typeof window !== 'undefined' && window.launcher?.store) {
            try {
                const stored = await window.launcher.store.get('defaultInstallationSettings');
                if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
                    const raw = stored as Record<string, unknown>;
                    if (typeof raw.javaMemory === 'number' && raw.javaMemory > 0) {
                        maxMemory = raw.javaMemory;
                    }
                    if (typeof raw.jvmArgs === 'string' && raw.jvmArgs) {
                        // Strip -Xms/-Xmx: those are applied via minMemory/maxMemory
                        const extra = raw.jvmArgs.split(/\s+/).filter(a => !/^-Xm[sx]\d+[kKmMgGtT]?$/i.test(a)).join(' ').trim();
                        if (extra) extraJvmArgs = extra;
                    }
                }
            } catch (error) {
                console.error('Failed to load defaults for legacy import:', error);
            }
        }
        // Try to read the version from version.txt inside the install directory
        let version = 'unknown';
        if (window.launcher?.legacy?.readVersion) {
            const parsed = await window.launcher.legacy.readVersion(installPath);
            if (parsed) version = parsed;
        }

        // Extract the last path segment as a display name (works on both / and \ separators)
        const folderName = installPath.replace(/[/\\]+$/, '').split(/[/\\]/).pop() ?? 'legacy-install';
        const newItem = {
            id: Date.now().toString(),
            name: folderName,
            version,
            // 'archive' is the closest built-in type for pre-existing installs not sourced from the CDN
            type: 'archive' as const,
            icon: 'release',
            path: installPath,
            lastPlayed: 'Never',
            installed: true,
            ...(maxMemory !== undefined && { minMemory: maxMemory, maxMemory }),
            ...(extraJvmArgs && { jvmArgs: extraJvmArgs }),
        };
        setImportedPaths(prev => {
            if (prev.has(installPath)) return prev;
            addInstallation(newItem);
            return new Set([...prev, installPath]);
        });
    };

    const handleCheckForUpdates = async () => {
        if (typeof window === 'undefined' || !window.launcher?.updater) return;
        setIsCheckingUpdate(true);
        setUpdateCheckResult(null);
        try {
            const info = await window.launcher.updater.checkForUpdates();
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

    return (
        <div className="h-full flex flex-col">
            <UpdateAvailableModal
                isOpen={isUpdateModalOpen}
                updateInfo={updateModalInfo}
                onDismiss={() => setIsUpdateModalOpen(false)}
            />
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
                                No Java runtimes detected. Download Java 8 or Java 25 below.
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
                            onClick={() => handleDownloadJava(25)} 
                            disabled={!!javaDownloadProgress[25]}
                            className="px-4 py-2 bg-starmade-accent hover:bg-starmade-accent/80 disabled:bg-starmade-accent/50 rounded-md text-sm font-semibold uppercase tracking-wider transition-colors"
                        >
                            {javaDownloadProgress[25] || 'Download Java 25'}
                        </button>
                    </div>
                    
                    <p className="text-xs text-gray-400 mt-3">
                        StarMade versions &lt; 0.3.x require Java 8. Versions ≥ 0.3.x require Java 25.
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
                                const alreadyAdded = existingPaths.has(installPath) || importedPaths.has(installPath);
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
            </div>
        </div>
    );
};

export default LauncherSettings;