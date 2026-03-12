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
    }, []);

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
                        <SettingRow title="Manage Bundled Java Runtimes" description="View and manage the Java runtimes used by the launcher.">
                            <button className="px-4 py-2 rounded-md bg-slate-700 hover:bg-slate-600 transition-colors text-sm font-semibold uppercase tracking-wider">
                                Manage Java
                            </button>
                        </SettingRow>
                    </div>
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