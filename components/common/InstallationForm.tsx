import React, { useState, useEffect } from 'react';
import { FolderIcon, MonitorIcon, ChevronDownIcon, CloseIcon, PencilIcon } from './icons';
import type { ManagedItem, ItemType, Version } from '../../types';
import { getIconComponent } from '../../utils/getIconComponent';
import CustomDropdown from './CustomDropdown';
import MemorySlider from './MemorySlider';
import { useData } from '../../contexts/DataContext';

interface InstallationFormProps {
  item: ManagedItem;
  isNew: boolean;
  onSave: (data: ManagedItem) => void;
  onCancel: () => void;
  itemTypeName: string;
}

const FormField: React.FC<{ label: string; htmlFor: string; children: React.ReactNode, className?: string }> = ({ label, htmlFor, children, className }) => (
  <div className={`flex flex-col gap-2 ${className}`}>
    <label htmlFor={htmlFor} className="text-sm font-semibold text-gray-300 uppercase tracking-wider">{label}</label>
    {children}
  </div>
);

const branches: { value: ItemType, label: string }[] = [
  { value: 'release', label: 'Release' },
  { value: 'dev', label: 'Dev' },
  { value: 'pre', label: 'Pre-Release' },
  { value: 'archive', label: 'Archive' },
];

const availableIcons: { icon: string; name: string }[] = [
    { icon: 'release', name: 'Release' },
    { icon: 'dev', name: 'Dev Build' },
    { icon: 'pre', name: 'Pre-release' },
    { icon: 'archive', name: 'Archive' },
    { icon: 'rocket', name: 'Rocket' },
    { icon: 'planet', name: 'Planet' },
    { icon: 'star', name: 'Star' },
    { icon: 'server', name: 'Server' },
    { icon: 'code', name: 'Code' },
    { icon: 'bolt', name: 'Bolt' },
    { icon: 'beaker', name: 'Beaker' },
    { icon: 'cube', name: 'Cube' },
];

/**
 * Strip characters that are illegal in directory names across platforms,
 * then collapse whitespace. Falls back to 'new-installation' if the
 * result is empty.
 */
const toFolderName = (name: string): string => {
    const sanitized = name.trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim();
    return sanitized || 'new-installation';
};

interface IconPickerModalProps {
    onSelect: (icon: string) => void;
    onClose: () => void;
}

const IconPickerModal: React.FC<IconPickerModalProps> = ({ onSelect, onClose }) => {
    const [folderIcons, setFolderIcons] = useState<{ path: string; name: string }[]>([]);

    useEffect(() => {
        if (typeof window === 'undefined' || !window.launcher?.icons) return;
        window.launcher.icons.list().then(paths => {
            setFolderIcons(paths.map(p => ({
                path: p,
                // Strip directory and extension to use as display name
                name: p.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, ''),
            })));
        }).catch(() => { /* silently ignore if unavailable */ });
    }, []);

    const handleBrowse = async () => {
        if (typeof window === 'undefined' || !window.launcher?.dialog) return;
        const filePath = await window.launcher.dialog.openFile(undefined, 'image');
        if (filePath) {
            onSelect(filePath);
            onClose();
        }
    };

    return (
        <div 
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center"
            onClick={onClose}
        >
            <div 
                className="bg-slate-900/90 border border-slate-700 rounded-lg shadow-xl p-6 w-full max-w-2xl relative animate-fade-in-scale max-h-[85vh] flex flex-col"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex justify-between items-center mb-6 flex-shrink-0">
                    <h2 className="font-display text-2xl font-bold uppercase text-white tracking-wider">Choose an Icon</h2>
                    <button onClick={onClose} className="p-1.5 rounded-md hover:bg-starmade-danger/20 transition-colors">
                        <CloseIcon className="w-5 h-5 text-gray-400 hover:text-starmade-danger-light" />
                    </button>
                </div>

                <div className="overflow-y-auto flex-grow space-y-6 pr-1">
                    {/* ── Icons from folder ── */}
                    {folderIcons.length > 0 && (
                        <div>
                            <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">From Icons Folder</p>
                            <div className="grid grid-cols-4 gap-4">
                                {folderIcons.map(({ path: iconPath, name }) => (
                                    <button
                                        key={iconPath}
                                        onClick={() => { onSelect(iconPath); onClose(); }}
                                        className="flex flex-col items-center justify-center gap-3 p-4 bg-black/20 rounded-lg border border-white/10 hover:border-starmade-accent hover:bg-starmade-accent/10 transition-all group"
                                    >
                                        <div className="w-20 h-20 flex items-center justify-center">
                                            {getIconComponent(iconPath, 'large')}
                                        </div>
                                        <span className="text-sm font-semibold text-gray-300 group-hover:text-white truncate w-full text-center">{name}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* ── Built-in icons ── */}
                    <div>
                        {folderIcons.length > 0 && (
                            <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">Built-in</p>
                        )}
                        <div className="grid grid-cols-4 gap-4">
                            {availableIcons.map(({ icon, name }) => (
                                <button 
                                    key={icon} 
                                    onClick={() => { onSelect(icon); onClose(); }}
                                    className="flex flex-col items-center justify-center gap-3 p-4 bg-black/20 rounded-lg border border-white/10 hover:border-starmade-accent hover:bg-starmade-accent/10 transition-all group"
                                >
                                    <div className="w-20 h-20 flex items-center justify-center">
                                        {getIconComponent(icon, 'large')}
                                    </div>
                                    <span className="text-sm font-semibold text-gray-300 group-hover:text-white">{name}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="mt-6 pt-4 border-t border-white/10 flex-shrink-0">
                    <button
                        onClick={handleBrowse}
                        className="flex items-center gap-3 w-full px-4 py-3 bg-black/20 rounded-lg border border-white/10 hover:border-starmade-accent hover:bg-starmade-accent/10 transition-all group"
                    >
                        <FolderIcon className="w-5 h-5 text-gray-400 group-hover:text-starmade-accent flex-shrink-0" />
                        <span className="text-sm font-semibold text-gray-300 group-hover:text-white uppercase tracking-wider">Browse for custom image…</span>
                    </button>
                </div>
            </div>
        </div>
    );
};

const InstallationForm: React.FC<InstallationFormProps> = ({ item, isNew, onSave, onCancel, itemTypeName }) => {
  const { versions: allVersions, isVersionsLoading } = useData();

  const [name, setName] = useState(item.name);
  const [port, setPort] = useState(item.port ?? '4242');
  const [icon, setIcon] = useState(item.icon);
  const [type, setType] = useState<ItemType>(item.type === 'latest' ? 'release' : item.type);
  const [version, setVersion] = useState(item.version);
  const [buildPath, setBuildPath] = useState(item.buildPath ?? '');
  const [requiredJavaVersion, setRequiredJavaVersion] = useState<8 | 25 | undefined>(item.requiredJavaVersion);
  const [gameDir, setGameDir] = useState(item.path);
  const [javaMemory, setJavaMemory] = useState(item.maxMemory ?? 8192);
  const [javaPath, setJavaPath] = useState(item.customJavaPath ?? '');
  const [jvmArgs, setJvmArgs] = useState(item.jvmArgs ?? '-Xms4G -Xmx8G');
  const [showMoreOptions, setShowMoreOptions] = useState(false);
  const [isIconPickerOpen, setIconPickerOpen] = useState(false);
  const [defaultsLoaded, setDefaultsLoaded] = useState(false);

  // Versions filtered to the currently selected branch
  const filteredVersions: Version[] = allVersions.filter(v => v.type === type);
  const versionOptions = filteredVersions.length > 0
    ? filteredVersions.map(v => ({ value: v.id, label: v.id }))
    : [{ value: version, label: version }]; // fallback while loading

  // Load default settings from store when creating a new installation/server
  useEffect(() => {
    if (!isNew || defaultsLoaded || typeof window === 'undefined' || !window.launcher?.store) {
      return;
    }

    const storeKey = itemTypeName === 'Server' 
      ? 'defaultServerSettings' 
      : 'defaultInstallationSettings';

    window.launcher.store.get(storeKey).then((stored) => {
      if (stored && typeof stored === 'object') {
        const defaults = stored as {
          gameDir?: string;
          port?: string;
          javaMemory?: number;
          jvmArgs?: string;
          javaPath8?: string;
          javaPath25?: string;
        };

        if (defaults.gameDir) setGameDir(defaults.gameDir);
        if (defaults.port && itemTypeName === 'Server') setPort(defaults.port);
        if (defaults.javaMemory) setJavaMemory(defaults.javaMemory);
        if (defaults.jvmArgs) setJvmArgs(defaults.jvmArgs);
        
        // Set the appropriate Java path based on required version
        if (requiredJavaVersion === 8 && defaults.javaPath8) {
          setJavaPath(defaults.javaPath8);
        } else if (requiredJavaVersion === 25 && defaults.javaPath25) {
          setJavaPath(defaults.javaPath25);
        } else if (requiredJavaVersion === 8 && defaults.javaPath8) {
          setJavaPath(defaults.javaPath8);
        } else if (defaults.javaPath8) {
          // Fallback to Java 8 path if no specific version is required yet
          setJavaPath(defaults.javaPath8);
        }
      }
      setDefaultsLoaded(true);
    }).catch((error) => {
      console.error('Failed to load default settings:', error);
      setDefaultsLoaded(true);
    });
  }, [isNew, itemTypeName, requiredJavaVersion, defaultsLoaded]);

  // When branch changes, auto-select the first available version in that branch
  const handleTypeChange = (newType: string) => {
    const t = newType as ItemType;
    setType(t);
    const first = allVersions.find(v => v.type === t);
    if (first) {
      setVersion(first.id);
      setBuildPath(first.buildPath ?? '');
      setRequiredJavaVersion(first.requiredJavaVersion);
    }
  };

  // When version changes, also carry the buildPath forward
  const handleVersionChange = (newVersionId: string) => {
    setVersion(newVersionId);
    const entry = filteredVersions.find(v => v.id === newVersionId);
    setBuildPath(entry?.buildPath ?? '');
    setRequiredJavaVersion(entry?.requiredJavaVersion);
  };

  // When live versions arrive (or change), sync the buildPath for the current selection
  useEffect(() => {
    if (allVersions.length === 0) return;
    const entry = allVersions.find(v => v.id === version && v.type === type);
    if (entry?.buildPath) setBuildPath(entry.buildPath);
    if (entry?.requiredJavaVersion !== undefined) setRequiredJavaVersion(entry.requiredJavaVersion);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allVersions]);

  // Update Java path when required Java version changes
  useEffect(() => {
    if (!isNew || !defaultsLoaded || typeof window === 'undefined' || !window.launcher?.store) {
      return;
    }

    const storeKey = itemTypeName === 'Server' 
      ? 'defaultServerSettings' 
      : 'defaultInstallationSettings';

    window.launcher.store.get(storeKey).then((stored) => {
      if (stored && typeof stored === 'object') {
        const defaults = stored as {
          javaPath8?: string;
          javaPath25?: string;
        };

        // Update Java path based on the new required version
        if (requiredJavaVersion === 8 && defaults.javaPath8) {
          setJavaPath(defaults.javaPath8);
        } else if (requiredJavaVersion === 25 && defaults.javaPath25) {
          setJavaPath(defaults.javaPath25);
        }
      }
    }).catch((error) => {
      console.error('Failed to update Java path:', error);
    });
  }, [requiredJavaVersion, isNew, itemTypeName, defaultsLoaded]);

  useEffect(() => {
    const memoryInGB = javaMemory / 1024;
    setJvmArgs(prevArgs => {
        const otherArgs = prevArgs.split(' ').filter(arg => !arg.startsWith('-Xm')).join(' ');
        return `-Xms${memoryInGB}G -Xmx${memoryInGB}G ${otherArgs}`.trim();
    });
  }, [javaMemory]);

  useEffect(() => {
    const xmxMatch = jvmArgs.match(/-Xmx(\d+)G/i);
    if (xmxMatch && xmxMatch[1]) {
        const memoryInGB = parseInt(xmxMatch[1]);
        const memoryInMB = memoryInGB * 1024;
        setJavaMemory(prev => (prev !== memoryInMB ? memoryInMB : prev));
    }
  }, [jvmArgs]);

  // When creating a new item, the actual install path is baseDir/name.
  // When editing, the user controls the full path directly.
  const effectivePath = isNew
    ? `${gameDir}/${toFolderName(name)}`
    : gameDir;

  const handleFolderPicker = async () => {
    if (typeof window === 'undefined' || !window.launcher?.dialog) return;
    const selected = await window.launcher.dialog.openFolder(gameDir);
    if (selected) setGameDir(selected);
  };

  const handleSaveClick = () => {
    // Strip -Xms/-Xmx from jvmArgs before saving — the launcher applies those
    // separately via minMemory/maxMemory so we'd otherwise double-apply them.
    const extraJvmArgs = jvmArgs.split(/\s+/).filter(a => !a.startsWith('-Xm')).join(' ').trim();

    onSave({
        ...item,
        name,
        type,
        icon,
        version,
        path: effectivePath,
        buildPath: buildPath || undefined,
        requiredJavaVersion: requiredJavaVersion,
        installed: isNew ? false : item.installed,
        minMemory: javaMemory,
        maxMemory: javaMemory,
        jvmArgs: extraJvmArgs || undefined,
        customJavaPath: javaPath || undefined,
        ...(itemTypeName === 'Server' && { port }),
    });
  };

  const title = isNew ? `New ${itemTypeName}` : `Edit ${itemTypeName}`;
  const saveButtonText = isNew ? 'Create' : 'Save';

  return (
    <div className="h-full flex flex-col text-white">
      {isIconPickerOpen && <IconPickerModal onSelect={setIcon} onClose={() => setIconPickerOpen(false)} />}
      <div className="flex justify-between items-center mb-6 flex-shrink-0 pr-4">
        <h1 className="font-display text-3xl font-bold uppercase tracking-wider">
          {title}
        </h1>
        <div className="flex items-center gap-4">
          <button onClick={onCancel} className="px-4 py-2 rounded-md hover:bg-white/10 transition-colors text-sm font-semibold uppercase tracking-wider">
            Cancel
          </button>
          <button onClick={handleSaveClick} className="px-6 py-2 rounded-md bg-starmade-accent hover:bg-starmade-accent-hover transition-colors text-sm font-bold uppercase tracking-wider">
            {saveButtonText}
          </button>
        </div>
      </div>

      <div className="flex-grow overflow-y-auto pr-4 space-y-8">
        <div className="flex gap-8 items-start">
          <div className="flex flex-col items-center gap-4">
            <button
              onClick={() => setIconPickerOpen(true)}
              className="w-32 h-32 bg-black/30 rounded-lg flex items-center justify-center border border-white/10 hover:border-starmade-accent/80 hover:shadow-[0_0_15px_0px_#227b8644] transition-all group cursor-pointer relative"
              aria-label="Change installation icon"
            >
              {getIconComponent(icon, 'large')}
              <div className="absolute inset-0 bg-black/60 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-1 text-white">
                <PencilIcon className="w-8 h-8" />
                <span className="text-xs uppercase font-bold tracking-wider">Change Icon</span>
              </div>
            </button>
            <p className="text-sm text-gray-400">Click to change icon</p>
          </div>

          <div className="flex-1 grid grid-cols-2 gap-x-6 gap-y-4">
            {itemTypeName === 'Server' ? (
              <>
                <FormField label="Name" htmlFor="itemName">
                  <input id="itemName" type="text" value={name} onChange={e => setName(e.target.value)} className="bg-slate-900/80 border border-slate-700 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-starmade-accent" />
                </FormField>
                <FormField label="Port" htmlFor="itemPort">
                  <input id="itemPort" type="text" value={port} onChange={e => setPort(e.target.value)} className="bg-slate-900/80 border border-slate-700 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-starmade-accent" />
                </FormField>
              </>
            ) : (
              <FormField label="Name" htmlFor="itemName" className="col-span-2">
                <input id="itemName" type="text" value={name} onChange={e => setName(e.target.value)} className="bg-slate-900/80 border border-slate-700 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-starmade-accent" />
              </FormField>
            )}
            <FormField label="Branch" htmlFor="itemBranch">
              <CustomDropdown 
                options={branches}
                value={type}
                onChange={handleTypeChange}
              />
            </FormField>
            <FormField label={isVersionsLoading ? 'Version (loading…)' : 'Version'} htmlFor="itemVersion">
              <CustomDropdown
                options={versionOptions}
                value={version}
                onChange={handleVersionChange}
              />
            </FormField>
            {requiredJavaVersion && (
              <div className="col-span-2 -mt-2">
                <p className="text-xs text-gray-400">
                  <span className="font-semibold">Requires Java {requiredJavaVersion}</span>
                  {requiredJavaVersion === 25}
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-8 gap-y-6">
          <FormField label={isNew ? 'Parent Directory' : 'Game Directory'} htmlFor="gameDir">
            <div className="flex">
              <input id="gameDir" type="text" value={isNew ? gameDir : effectivePath} onChange={e => setGameDir(e.target.value)} className="flex-1 bg-slate-900/80 border border-slate-700 rounded-l-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-starmade-accent" />
              <button onClick={handleFolderPicker} className="bg-slate-800/80 border-t border-b border-r border-slate-700 px-4 rounded-r-md hover:bg-slate-700/80 transition-colors"><FolderIcon className="w-5 h-5 text-gray-400" /></button>
            </div>
            {isNew && (
              <p className="text-xs text-gray-500 mt-1">
                Will install to: <span className="text-gray-400 font-mono">{effectivePath}</span>
              </p>
            )}
          </FormField>

            <div className="col-span-2">
                <hr className="border-slate-800 my-2" />
                <button
                    onClick={() => setShowMoreOptions(!showMoreOptions)}
                    className="w-full flex justify-between items-center p-2 rounded-md hover:bg-white/5 transition-colors"
                    aria-expanded={showMoreOptions}
                    aria-controls="more-options-panel"
                >
                    <span className="text-base font-semibold text-gray-300 uppercase tracking-wider">More Options</span>
                    <ChevronDownIcon className={`w-5 h-5 text-gray-400 transition-transform ${showMoreOptions ? 'rotate-180' : ''}`} />
                </button>

                {showMoreOptions && (
                    <div id="more-options-panel" className="mt-6 grid grid-cols-2 gap-x-8 gap-y-6 animate-fade-in-scale">
                        <FormField label="Java Memory Allocation" htmlFor="javaMemory" className="col-span-2">
                            <MemorySlider value={javaMemory} onChange={setJavaMemory} />
                        </FormField>

                        <FormField label="Java Executable Path" htmlFor="javaPath">
                          <div className="flex">
                            <input id="javaPath" type="text" value={javaPath} onChange={e => setJavaPath(e.target.value)} className="flex-1 bg-slate-900/80 border border-slate-700 rounded-l-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-starmade-accent" />
                            <button
                              onClick={async () => {
                                if (!window.launcher?.dialog) return;
                                const folder = await window.launcher.dialog.openFolder(javaPath || undefined);
                                if (!folder) return;
                                const exe = window.launcher.java?.findExecutable
                                  ? await window.launcher.java.findExecutable(folder)
                                  : folder;
                                setJavaPath(exe);
                              }}
                              className="bg-slate-800/80 border-t border-b border-r border-slate-700 px-4 rounded-r-md hover:bg-slate-700/80 transition-colors"
                            >
                              <FolderIcon className="w-5 h-5 text-gray-400" />
                            </button>
                          </div>
                        </FormField>
                        <FormField label="JVM Arguments" htmlFor="jvmArgs">
                          <textarea id="jvmArgs" value={jvmArgs} onChange={e => setJvmArgs(e.target.value)} rows={2} className="bg-slate-900/80 border border-slate-700 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-starmade-accent font-mono text-sm"></textarea>
                        </FormField>
                    </div>
                )}
            </div>
        </div>
      </div>
    </div>
  );
};

export default InstallationForm;
