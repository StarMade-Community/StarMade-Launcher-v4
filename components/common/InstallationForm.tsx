import React, { useState, useEffect } from 'react';
import { FolderIcon, MonitorIcon, ChevronDownIcon, CloseIcon, PencilIcon, WrenchIcon } from './icons';
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
  onRepairInstall?: () => void;
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
    { icon: 'gamepad', name: 'Gamepad' },
    { icon: 'bolt', name: 'Bolt' },
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

    const loadFolderIcons = () => {
        if (typeof window === 'undefined' || !window.launcher?.icons) return;
        window.launcher.icons.list().then(paths => {
            setFolderIcons(paths.map(p => ({
                path: p,
                // Strip directory and extension to use as display name
                name: p.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, ''),
            })));
        }).catch(() => { /* silently ignore if unavailable */ });
    };

    useEffect(() => {
        loadFolderIcons();
    }, []);

    const handleBrowse = async () => {
        if (typeof window === 'undefined' || !window.launcher?.dialog || !window.launcher?.icons) return;
        const filePath = await window.launcher.dialog.openFile(undefined, 'image');
        if (!filePath) return;

        const imported = await window.launcher.icons.import(filePath).catch(() => ({ success: false as const }));
        if (imported.success && imported.path) {
            onSelect(imported.path);
            loadFolderIcons();
            onClose();
            return;
        }

        // Fallback for environments that do not support icon importing yet.
        onSelect(filePath);
        onClose();
    };

    const iconChoices: Array<{ icon: string; name: string; isCustom: boolean }> = [
        ...availableIcons.map((entry) => ({ ...entry, isCustom: false })),
        ...folderIcons.map(({ path, name }) => ({ icon: path, name, isCustom: true })),
    ];

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
                    <div>
                        <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">
                            Icons (Built-in + Custom)
                        </p>
                        <div className="grid grid-cols-4 gap-4">
                            {iconChoices.map(({ icon, name, isCustom }) => (
                                <button
                                    key={icon}
                                    onClick={() => { onSelect(icon); onClose(); }}
                                    className="flex flex-col items-center justify-center gap-3 p-4 bg-black/20 rounded-lg border border-white/10 hover:border-starmade-accent hover:bg-starmade-accent/10 transition-all group"
                                >
                                    <div className="w-20 h-20 flex items-center justify-center">
                                        {getIconComponent(icon, 'large')}
                                    </div>
                                    <div className="w-full text-center">
                                        <span className="block text-sm font-semibold text-gray-300 group-hover:text-white truncate">{name}</span>
                                        {isCustom && (
                                            <span className="text-[10px] uppercase tracking-wider text-gray-500">Custom</span>
                                        )}
                                    </div>
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

/**
 * Resolve the effective Java path for a given required version, merging the
 * item-type-specific defaults with installation defaults as a fallback for
 * java paths when creating a server (which may not yet have its own paths set).
 */
async function resolveJavaPaths(
  itemTypeName: string,
): Promise<{ javaPath8: string; javaPath25: string }> {
  if (typeof window === 'undefined' || !window.launcher?.store) {
    return { javaPath8: '', javaPath25: '' };
  }

  const storeKey = itemTypeName === 'Server' ? 'defaultServerSettings' : 'defaultInstallationSettings';

  const stored = await window.launcher.store.get(storeKey).catch(() => null);
  const defaults = (stored && typeof stored === 'object') ? stored as {
    javaPath8?: string;
    javaPath25?: string;
  } : {};

  // For servers, fall back to installation defaults when server-specific paths are empty
  let installDefaults: { javaPath8?: string; javaPath25?: string } = {};
  if (itemTypeName === 'Server' && !defaults.javaPath8 && !defaults.javaPath25) {
    const instStored = await window.launcher.store.get('defaultInstallationSettings').catch(() => null);
    if (instStored && typeof instStored === 'object') {
      installDefaults = instStored as { javaPath8?: string; javaPath25?: string };
    }
  }

  return {
    javaPath8:  defaults.javaPath8  || installDefaults.javaPath8  || '',
    javaPath25: defaults.javaPath25 || installDefaults.javaPath25 || '',
  };
}

const InstallationForm: React.FC<InstallationFormProps> = ({ item, isNew, onSave, onCancel, onRepairInstall, itemTypeName }) => {
  const { versions: allVersions, isVersionsLoading } = useData();

  const [name, setName] = useState(item.name);
  const [port, setPort] = useState(item.port ?? '4242');
  const [serverIp, setServerIp] = useState(item.serverIp ?? 'localhost');
  const [maxPlayers, setMaxPlayers] = useState(item.maxPlayers ?? 32);
  const [isRemoteServer, setIsRemoteServer] = useState(item.isRemote ?? false);
  const [remoteFileAccessProtocol, setRemoteFileAccessProtocol] = useState<'none' | 'ftp' | 'sftp'>(item.remoteFileAccessProtocol ?? 'none');
  const [remoteFileAccessHost, setRemoteFileAccessHost] = useState(item.remoteFileAccessHost ?? '');
  const [remoteFileAccessPort, setRemoteFileAccessPort] = useState(item.remoteFileAccessPort ?? '');
  const [remoteFileAccessUsername, setRemoteFileAccessUsername] = useState(item.remoteFileAccessUsername ?? '');
  const [remoteFileAccessRootPath, setRemoteFileAccessRootPath] = useState(item.remoteFileAccessRootPath ?? '/');
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
  const [pathError, setPathError] = useState('');

  // Versions filtered to the currently selected branch
  const filteredVersions: Version[] = allVersions.filter(v => v.type === type);
  const versionOptions = filteredVersions.length > 0
    ? filteredVersions.map((v, i) => ({ value: v.id, label: i === 0 ? `${v.id} (latest)` : v.id }))
    : [{ value: version, label: version }]; // fallback while loading

  // Load default settings from store when creating a new installation/server
  useEffect(() => {
    if (!isNew || defaultsLoaded || typeof window === 'undefined' || !window.launcher?.store) {
      return;
    }

    const storeKey = itemTypeName === 'Server' 
      ? 'defaultServerSettings' 
      : 'defaultInstallationSettings';

    window.launcher.store.get(storeKey).then(async (stored) => {
      const defaults = (stored && typeof stored === 'object') ? stored as {
        gameDir?: string;
        port?: string;
        serverIp?: string;
        maxPlayers?: number;
        javaMemory?: number;
        jvmArgs?: string;
        javaPath8?: string;
        javaPath25?: string;
      } : {};

      if (defaults.gameDir) setGameDir(defaults.gameDir);
      if (defaults.port && itemTypeName === 'Server') setPort(defaults.port);
      if (defaults.serverIp && itemTypeName === 'Server') setServerIp(defaults.serverIp);
      if (typeof defaults.maxPlayers === 'number' && itemTypeName === 'Server') setMaxPlayers(Math.max(0, Math.round(defaults.maxPlayers)));
      if (defaults.javaMemory) setJavaMemory(defaults.javaMemory);
      if (defaults.jvmArgs) setJvmArgs(defaults.jvmArgs);

      // Resolve Java paths (with installation-defaults fallback for servers)
      const { javaPath8, javaPath25 } = await resolveJavaPaths(itemTypeName);
      if (requiredJavaVersion === 25 && javaPath25) {
        setJavaPath(javaPath25);
      } else if (javaPath8) {
        setJavaPath(javaPath8);
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

    resolveJavaPaths(itemTypeName).then(({ javaPath8, javaPath25 }) => {
      if (requiredJavaVersion === 25 && javaPath25) {
        setJavaPath(javaPath25);
      } else if (javaPath8) {
        setJavaPath(javaPath8);
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

  const handleJvmArgsChange = (newArgs: string) => {
    setJvmArgs(newArgs);
    // Sync the memory slider when the user manually edits -Xmx
    const xmxMatch = newArgs.match(/-Xmx(\d+)G/i);
    if (xmxMatch && xmxMatch[1]) {
      const memoryInMB = parseInt(xmxMatch[1]) * 1024;
      setJavaMemory(prev => prev !== memoryInMB ? memoryInMB : prev);
    }
  };

  // When creating a new item, the actual install path is baseDir/name.
  // When editing, the user controls the full path directly.
  // Guard against empty gameDir so the hint doesn't show a bare "/name" path.
  const effectivePath = isNew
    ? (gameDir ? `${gameDir}/${toFolderName(name)}` : '')
    : gameDir;

  const handleFolderPicker = async () => {
    if (typeof window === 'undefined' || !window.launcher?.dialog) return;
    const selected = await window.launcher.dialog.openFolder(gameDir || undefined);
    if (selected) setGameDir(selected);
  };

  const handleSaveClick = () => {
    if (itemTypeName === 'Server' && isRemoteServer) {
      if (!serverIp.trim()) {
        setPathError('Please enter a remote server host.');
        return;
      }
      const parsedPort = Number(port);
      if (!Number.isInteger(parsedPort) || parsedPort <= 0 || parsedPort > 65535) {
        setPathError('Please enter a valid port (1-65535).');
        return;
      }
    } else if (!gameDir.trim()) {
      // Require a directory to be set before saving local installs.
      setPathError('Please choose a directory.');
      return;
    }

    setPathError('');

    // Strip -Xms/-Xmx from jvmArgs before saving — the launcher applies those
    // separately via minMemory/maxMemory so we'd otherwise double-apply them.
    const extraJvmArgs = jvmArgs.split(/\s+/).filter(a => !a.startsWith('-Xm')).join(' ').trim();

    const normalizedServerIp = serverIp.trim() || 'localhost';
    const normalizedPort = String(Math.max(1, Math.min(65535, Number.parseInt(port, 10) || 4242)));
    const normalizedRemoteFilePort = remoteFileAccessPort.trim();

    onSave({
        ...item,
        name,
        type,
        icon,
        version,
        path: itemTypeName === 'Server' && isRemoteServer ? '' : effectivePath,
        buildPath: buildPath || undefined,
        requiredJavaVersion: requiredJavaVersion,
        installed: itemTypeName === 'Server' && isRemoteServer ? true : (isNew ? false : item.installed),
        minMemory: itemTypeName === 'Server' && isRemoteServer ? undefined : javaMemory,
        maxMemory: itemTypeName === 'Server' && isRemoteServer ? undefined : javaMemory,
        jvmArgs: itemTypeName === 'Server' && isRemoteServer ? undefined : (extraJvmArgs || undefined),
        customJavaPath: itemTypeName === 'Server' && isRemoteServer ? undefined : (javaPath || undefined),
        ...(itemTypeName === 'Server' && {
          isRemote: isRemoteServer,
          port: normalizedPort,
          serverIp: normalizedServerIp,
          maxPlayers: Math.max(0, Math.round(maxPlayers || 0)),
          remoteFileAccessProtocol: isRemoteServer ? remoteFileAccessProtocol : undefined,
          remoteFileAccessHost: isRemoteServer ? (remoteFileAccessHost.trim() || undefined) : undefined,
          remoteFileAccessPort: isRemoteServer ? (normalizedRemoteFilePort || undefined) : undefined,
          remoteFileAccessUsername: isRemoteServer ? (remoteFileAccessUsername.trim() || undefined) : undefined,
          remoteFileAccessRootPath: isRemoteServer ? (remoteFileAccessRootPath.trim() || undefined) : undefined,
        }),
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
                <FormField label="Name" htmlFor="itemName" className="col-span-2">
                  <input id="itemName" type="text" value={name} onChange={e => setName(e.target.value)} className="bg-slate-900/80 border border-slate-700 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-starmade-accent" />
                </FormField>
                <FormField label="Server Type" htmlFor="serverType">
                  <select
                    id="serverType"
                    value={isRemoteServer ? 'remote' : 'local'}
                    onChange={e => {
                      const nextIsRemote = e.target.value === 'remote';
                      setIsRemoteServer(nextIsRemote);
                      setPathError('');
                    }}
                    className="bg-slate-900/80 border border-slate-700 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-starmade-accent"
                  >
                    <option value="local">Local Install</option>
                    <option value="remote">Remote Registration</option>
                  </select>
                </FormField>
                <FormField label="Port" htmlFor="itemPort">
                  <input id="itemPort" type="text" value={port} onChange={e => setPort(e.target.value)} className="bg-slate-900/80 border border-slate-700 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-starmade-accent" />
                </FormField>
                <FormField label={isRemoteServer ? 'Remote Host' : 'Server IP'} htmlFor="itemServerIp" className="col-span-2">
                  <input id="itemServerIp" type="text" value={serverIp} onChange={e => setServerIp(e.target.value)} className="bg-slate-900/80 border border-slate-700 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-starmade-accent" />
                </FormField>
                {!isRemoteServer && (
                <FormField label="Max Players" htmlFor="itemMaxPlayers">
                  <input
                    id="itemMaxPlayers"
                    type="number"
                    min={0}
                    value={maxPlayers}
                    onChange={e => setMaxPlayers(Math.max(0, Number(e.target.value) || 0))}
                    className="bg-slate-900/80 border border-slate-700 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-starmade-accent"
                  />
                </FormField>
                )}
                {isRemoteServer && (
                  <div className="col-span-2 -mt-1 space-y-1">
                    <p className="text-xs text-gray-400">
                      Remote profiles are used for StarMote connection and monitoring only.
                    </p>
                    {pathError && <p className="text-xs text-red-400">{pathError}</p>}
                  </div>
                )}
                {isRemoteServer && (
                  <>
                    <div className="col-span-2 mt-2 rounded-md border border-cyan-500/20 bg-cyan-500/5 p-3">
                      <p className="text-xs font-semibold uppercase tracking-wider text-cyan-200">Remote File Access</p>
                      <p className="mt-1 text-xs text-gray-400">
                        Optional FTP/SFTP profile metadata for future Files and Configuration tab support. Passwords and keys will be added separately.
                      </p>
                    </div>
                    <FormField label="File Access Protocol" htmlFor="remoteFileAccessProtocol">
                      <select
                        id="remoteFileAccessProtocol"
                        value={remoteFileAccessProtocol}
                        onChange={(event) => {
                          const nextProtocol = event.target.value as 'none' | 'ftp' | 'sftp';
                          setRemoteFileAccessProtocol(nextProtocol);
                          if (!remoteFileAccessPort.trim()) {
                            setRemoteFileAccessPort(nextProtocol === 'sftp' ? '22' : nextProtocol === 'ftp' ? '21' : '');
                          }
                        }}
                        className="bg-slate-900/80 border border-slate-700 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-starmade-accent"
                      >
                        <option value="none">None yet</option>
                        <option value="ftp">FTP</option>
                        <option value="sftp">SFTP</option>
                      </select>
                    </FormField>
                    <FormField label="File Access Host" htmlFor="remoteFileAccessHost">
                      <input
                        id="remoteFileAccessHost"
                        type="text"
                        value={remoteFileAccessHost}
                        onChange={(event) => setRemoteFileAccessHost(event.target.value)}
                        placeholder="Leave blank to reuse remote host"
                        className="bg-slate-900/80 border border-slate-700 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-starmade-accent"
                      />
                    </FormField>
                    <FormField label="File Access Port" htmlFor="remoteFileAccessPort">
                      <input
                        id="remoteFileAccessPort"
                        type="text"
                        value={remoteFileAccessPort}
                        onChange={(event) => setRemoteFileAccessPort(event.target.value)}
                        placeholder={remoteFileAccessProtocol === 'sftp' ? '22' : remoteFileAccessProtocol === 'ftp' ? '21' : 'Optional'}
                        className="bg-slate-900/80 border border-slate-700 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-starmade-accent"
                      />
                    </FormField>
                    <FormField label="File Access Username" htmlFor="remoteFileAccessUsername">
                      <input
                        id="remoteFileAccessUsername"
                        type="text"
                        value={remoteFileAccessUsername}
                        onChange={(event) => setRemoteFileAccessUsername(event.target.value)}
                        placeholder="Optional"
                        className="bg-slate-900/80 border border-slate-700 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-starmade-accent"
                      />
                    </FormField>
                    <FormField label="Remote Root Path" htmlFor="remoteFileAccessRootPath">
                      <input
                        id="remoteFileAccessRootPath"
                        type="text"
                        value={remoteFileAccessRootPath}
                        onChange={(event) => setRemoteFileAccessRootPath(event.target.value)}
                        placeholder="/home/starmade/server"
                        className="bg-slate-900/80 border border-slate-700 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-starmade-accent"
                      />
                    </FormField>
                  </>
                )}
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
          {!(itemTypeName === 'Server' && isRemoteServer) && (
          <FormField label={isNew ? 'Parent Directory' : 'Game Directory'} htmlFor="gameDir">
            <div className="flex">
              <input
                id="gameDir"
                type="text"
                value={isNew ? gameDir : effectivePath}
                onChange={e => { setGameDir(e.target.value); setPathError(''); }}
                placeholder="Click the folder icon to choose…"
                className={`flex-1 bg-slate-900/80 border rounded-l-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-starmade-accent ${pathError ? 'border-red-500' : 'border-slate-700'}`}
              />
              {(() => {
                const hasRepairBtn = !isNew && !!onRepairInstall;
                return (
                  <button
                    onClick={handleFolderPicker}
                    className={`bg-slate-800/80 border-t border-b border-r border-slate-700 px-4 hover:bg-slate-700/80 transition-colors${hasRepairBtn ? '' : ' rounded-r-md'}`}
                    aria-label="Open folder picker"
                  >
                    <FolderIcon className="w-5 h-5 text-gray-400" />
                  </button>
                );
              })()}
              {!isNew && onRepairInstall && (
                <button
                  onClick={onRepairInstall}
                  className="flex items-center gap-2 bg-slate-800/80 border-t border-b border-r border-slate-700 px-4 rounded-r-md hover:bg-slate-700/80 transition-colors"
                  title="Repair Install — re-verify and re-download missing or corrupt files"
                  aria-label="Repair install — re-verify and re-download missing or corrupt files"
                >
                  <WrenchIcon className="w-4 h-4 text-gray-400" />
                  <span className="text-sm text-gray-400 font-semibold">Repair</span>
                </button>
              )}
            </div>
            {pathError && <p className="text-xs text-red-400 mt-1">{pathError}</p>}
            {isNew && (
              <p className="text-xs text-gray-500 mt-1">
                {effectivePath
                  ? <>Will install to: <span className="text-gray-400 font-mono">{effectivePath}</span></>
                  : 'Choose a parent directory — the game will be installed in a subfolder named after this installation.'}
              </p>
            )}
          </FormField>
          )}

            {!(itemTypeName === 'Server' && isRemoteServer) && (
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
                          <textarea id="jvmArgs" value={jvmArgs} onChange={e => handleJvmArgsChange(e.target.value)} rows={2} className="bg-slate-900/80 border border-slate-700 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-starmade-accent font-mono text-sm"></textarea>
                        </FormField>
                    </div>
                )}
            </div>
            )}
        </div>
      </div>
    </div>
  );
};

export default InstallationForm;
