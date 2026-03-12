import React, { useState, useEffect, useRef } from 'react';
import CustomDropdown from '../../common/CustomDropdown';
import { FolderIcon, MonitorIcon } from '../../common/icons';
import MemorySlider from '../../common/MemorySlider';

// ─── Store keys ──────────────────────────────────────────────────────────────

const STORE_KEY_INSTALLATION = 'defaultInstallationSettings';
const STORE_KEY_SERVER       = 'defaultServerSettings';

interface DefaultSettingsData {
    gameDir: string;
    resolution: string;
    port: string;
    javaMemory: number;
    jvmArgs: string;
    javaPath: string;
}

const DEFAULT_INSTALLATION_SETTINGS: DefaultSettingsData = {
    gameDir:    'C:\\Games\\StarMade\\Instances\\default',
    resolution: '1920x1080',
    port:       '4242',
    javaMemory: 4096,
    jvmArgs:    '-Xms4G -Xmx4G',
    javaPath:   'C:\\Program Files\\Java\\jdk-17\\bin\\javaw.exe',
};

const DEFAULT_SERVER_SETTINGS: DefaultSettingsData = {
    gameDir:    'C:\\Games\\StarMade\\Servers\\default',
    resolution: '1920x1080',
    port:       '4242',
    javaMemory: 4096,
    jvmArgs:    '-Xms4G -Xmx4G',
    javaPath:   'C:\\Program Files\\Java\\jdk-17\\bin\\javaw.exe',
};

// ─── Sub-components ──────────────────────────────────────────────────────────

// Component for a consistent setting row layout
const SettingRow: React.FC<{ title: string; description: string; children: React.ReactNode }> = ({ title, description, children }) => (
    <div className="flex justify-between items-center bg-black/20 p-4 rounded-lg border border-white/10">
        <div>
            <h3 className="font-semibold text-white">{title}</h3>
            <p className="text-sm text-gray-400 max-w-sm">{description}</p>
        </div>
        <div className="min-w-[300px] flex justify-end">
            {children}
        </div>
    </div>
);

const resolutions = ["1280x720", "1920x1080", "2560x1440", "3840x2160"];
const resolutionOptions = resolutions.map(res => ({ value: res, label: res }));

// ─── Form component ──────────────────────────────────────────────────────────

const DefaultSettingsForm: React.FC<{ isServer: boolean }> = ({ isServer }) => {
    const storeKey = isServer ? STORE_KEY_SERVER : STORE_KEY_INSTALLATION;
    const defaults = isServer ? DEFAULT_SERVER_SETTINGS : DEFAULT_INSTALLATION_SETTINGS;

    const [settings, setSettings] = useState<DefaultSettingsData>(defaults);

    /**
     * `loadedKeyRef` tracks which storeKey was last successfully loaded.
     * Persistence is suppressed until the current storeKey has been loaded,
     * which prevents overwriting persisted data during an async load and avoids
     * a race condition when the user switches tabs before the previous load
     * has finished.
     */
    const loadedKeyRef = useRef<string | null>(null);

    // Load persisted settings on mount and when the tab switches
    useEffect(() => {
        if (typeof window === 'undefined' || !window.launcher?.store) {
            setSettings(defaults);
            loadedKeyRef.current = storeKey;
            return;
        }
        window.launcher.store.get(storeKey).then((stored) => {
            setSettings(stored && typeof stored === 'object'
                ? { ...defaults, ...(stored as Partial<DefaultSettingsData>) }
                : defaults);
            loadedKeyRef.current = storeKey;
        }).catch(() => {
            setSettings(defaults);
            loadedKeyRef.current = storeKey;
        });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [storeKey]);

    // Persist whenever settings change, but only after the current key is loaded
    useEffect(() => {
        if (loadedKeyRef.current === storeKey && typeof window !== 'undefined' && window.launcher?.store) {
            window.launcher.store.set(storeKey, settings);
        }
    }, [settings, storeKey]);

    /**
     * Update the memory slider and keep the -Xms/-Xmx flags in JVM args in
     * sync in a single state update to avoid two separate persistence writes.
     */
    const handleMemoryChange = (newMemory: number) => {
        setSettings(prev => {
            const gb = newMemory / 1024;
            const otherArgs = prev.jvmArgs.split(' ').filter(a => !a.startsWith('-Xm')).join(' ');
            return {
                ...prev,
                javaMemory: newMemory,
                jvmArgs: `-Xms${gb}G -Xmx${gb}G ${otherArgs}`.trim(),
            };
        });
    };

    /**
     * Update JVM args and keep the memory slider in sync in a single state
     * update to avoid two separate persistence writes.
     */
    const handleJvmArgsChange = (newArgs: string) => {
        setSettings(prev => {
            const xmxMatch = newArgs.match(/-Xmx(\d+)G/i);
            const memoryInMB = xmxMatch ? parseInt(xmxMatch[1]) * 1024 : prev.javaMemory;
            return { ...prev, jvmArgs: newArgs, javaMemory: memoryInMB };
        });
    };

    const update = <K extends keyof DefaultSettingsData>(key: K, value: DefaultSettingsData[K]) => {
        setSettings(prev => ({ ...prev, [key]: value }));
    };

    return (
        <div className="space-y-4">
            <SettingRow title="Game Directory" description="The default folder where new installations will be created.">
                <div className="flex w-full">
                  <input type="text" value={settings.gameDir} onChange={e => update('gameDir', e.target.value)} className="flex-1 bg-slate-900/80 border border-slate-700 rounded-l-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-starmade-accent" />
                  <button className="bg-slate-800/80 border-t border-b border-r border-slate-700 px-4 rounded-r-md hover:bg-slate-700/80"><FolderIcon className="w-5 h-5 text-gray-400" /></button>
                </div>
            </SettingRow>

            {!isServer && (
                <SettingRow title="Resolution" description="The default screen resolution for new installations.">
                    <CustomDropdown
                        className="w-full"
                        options={resolutionOptions}
                        value={settings.resolution}
                        onChange={(v) => update('resolution', v)}
                        icon={<MonitorIcon className="w-5 h-5 text-gray-400" />}
                    />
                </SettingRow>
            )}

            {isServer && (
                 <SettingRow title="Port" description="The default network port for new servers.">
                    <input type="text" value={settings.port} onChange={e => update('port', e.target.value)} className="w-full bg-slate-900/80 border border-slate-700 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-starmade-accent" />
                </SettingRow>
            )}

            <SettingRow title="Java Memory Allocation" description="Set the default RAM allocated to new instances.">
                <MemorySlider value={settings.javaMemory} onChange={handleMemoryChange} />
            </SettingRow>

            <SettingRow title="JVM Arguments" description="Java arguments for advanced users. Memory is managed above.">
                <textarea value={settings.jvmArgs} onChange={e => handleJvmArgsChange(e.target.value)} rows={2} className="w-full bg-slate-900/80 border border-slate-700 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-starmade-accent font-mono text-sm"></textarea>
            </SettingRow>

            <SettingRow title="Java Executable Path" description="The default Java executable used for new instances.">
                 <div className="flex w-full">
                  <input type="text" value={settings.javaPath} onChange={e => update('javaPath', e.target.value)} className="flex-1 bg-slate-900/80 border border-slate-700 rounded-l-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-starmade-accent" />
                  <button className="bg-slate-800/80 border-t border-b border-r border-slate-700 px-4 rounded-r-md hover:bg-slate-700/80"><FolderIcon className="w-5 h-5 text-gray-400" /></button>
                </div>
            </SettingRow>
        </div>
    );
}

// ─── Tab button ──────────────────────────────────────────────────────────────

// Tab button component, localized for this page
const TabButton: React.FC<{ isActive: boolean; onClick: () => void; children: React.ReactNode }> = ({ isActive, onClick, children }) => (
    <button
        onClick={onClick}
        className={`
            font-display text-lg font-bold uppercase tracking-wider transition-colors duration-200 relative pb-2 px-1
            ${isActive ? 'text-white' : 'text-gray-500 hover:text-gray-300'}
        `}
    >
        {children}
        {isActive && (
            <div className="absolute bottom-0 left-0 w-full h-1 bg-starmade-accent rounded-full shadow-[0_0_8px_0px_#227b86]"></div>
        )}
    </button>
);

// ─── Main component ──────────────────────────────────────────────────────────

// Main component for the "Default Settings" page
const DefaultSettings: React.FC = () => {
    const [activeTab, setActiveTab] = useState<'installations' | 'servers'>('installations');

    return (
        <div className="h-full flex flex-col">
            <div className="flex justify-between items-center mb-6 pb-2 border-b-2 border-white/10 flex-shrink-0">
                <h2 className="font-display text-xl font-bold uppercase tracking-wider text-white">
                    Default Settings
                </h2>
                <p className="text-sm text-gray-400">Configure default values for new installations and servers.</p>
            </div>
            <div className="flex items-center gap-6 mb-6 flex-shrink-0">
                <TabButton isActive={activeTab === 'installations'} onClick={() => setActiveTab('installations')}>
                    Installations
                </TabButton>
                <TabButton isActive={activeTab === 'servers'} onClick={() => setActiveTab('servers')}>
                    Servers
                </TabButton>
            </div>
            <div className="flex-grow overflow-y-auto pr-4 -mr-4">
               {activeTab === 'installations' ? <DefaultSettingsForm isServer={false} /> : <DefaultSettingsForm isServer={true} />}
            </div>
        </div>
    );
};


export default DefaultSettings;
