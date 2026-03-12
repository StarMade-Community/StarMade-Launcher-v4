import React, { useState, useEffect } from 'react';
import CustomDropdown from '../../common/CustomDropdown';

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
    const [isLoaded, setIsLoaded] = useState(false);
    const [settings, setSettings] = useState<LauncherSettingsData>(DEFAULT_SETTINGS);
    const [javaRuntimes, setJavaRuntimes] = useState<{
        bundled: Array<{ version: string; path: string; source: string }>;
        system: Array<{ version: string; path: string; source: string }>;
    }>({ bundled: [], system: [] });
    const [isLoadingJava, setIsLoadingJava] = useState(false);
    const [javaDownloadProgress, setJavaDownloadProgress] = useState<Record<string, string>>({});

    const languageOptions = [
        { value: 'English (US)', label: 'English (US)' },
        { value: 'Deutsch', label: 'Deutsch' },
        { value: 'Français', label: 'Français' },
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

    return (
        <div className="h-full flex flex-col">
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
                            <button className="px-4 py-2 rounded-md bg-slate-700 hover:bg-slate-600 transition-colors text-sm font-semibold uppercase tracking-wider">
                                Check Now
                            </button>
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
            </div>
        </div>
    );
};

export default LauncherSettings;