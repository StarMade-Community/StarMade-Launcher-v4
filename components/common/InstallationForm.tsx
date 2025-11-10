import React, { useState, useEffect } from 'react';
import { FolderIcon, MonitorIcon, ChevronDownIcon, CloseIcon, PencilIcon } from './icons';
import type { ManagedItem, ItemType } from '../../types';
import { getIconComponent } from '../../utils/getIconComponent';
import CustomDropdown from './CustomDropdown';
import MemorySlider from './MemorySlider';

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

const resolutions = ["1280x720", "1920x1080", "2560x1440", "3840x2160"];

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

interface IconPickerModalProps {
    onSelect: (icon: string) => void;
    onClose: () => void;
}

const IconPickerModal: React.FC<IconPickerModalProps> = ({ onSelect, onClose }) => {
    return (
        <div 
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center"
            onClick={onClose}
        >
            <div 
                className="bg-slate-900/90 border border-slate-700 rounded-lg shadow-xl p-6 w-full max-w-2xl relative animate-fade-in-scale"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex justify-between items-center mb-6">
                    <h2 className="font-display text-2xl font-bold uppercase text-white tracking-wider">Choose an Icon</h2>
                    <button onClick={onClose} className="p-1.5 rounded-md hover:bg-starmade-danger/20 transition-colors">
                        <CloseIcon className="w-5 h-5 text-gray-400 hover:text-starmade-danger-light" />
                    </button>
                </div>
                <div className="grid grid-cols-4 gap-4">
                    {availableIcons.map(({ icon, name }) => (
                        <button 
                            key={icon} 
                            onClick={() => {
                                onSelect(icon);
                                onClose();
                            }}
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
    );
};

const InstallationForm: React.FC<InstallationFormProps> = ({ item, isNew, onSave, onCancel, itemTypeName }) => {
  const [name, setName] = useState(item.name);
  const [port, setPort] = useState(item.port ?? '4242');
  const [icon, setIcon] = useState(item.icon);
  const [type, setType] = useState<ItemType>(item.type === 'latest' ? 'release' : item.type);
  const [version, setVersion] = useState(item.version);
  const [gameDir, setGameDir] = useState(item.path);
  const [resolution, setResolution] = useState('1920x1080');
  const [javaMemory, setJavaMemory] = useState(4096);
  const [javaPath, setJavaPath] = useState('C:\\Program Files\\Java\\jdk-17\\bin\\javaw.exe');
  const [jvmArgs, setJvmArgs] = useState('-Xms4G -Xmx4G');
  const [showMoreOptions, setShowMoreOptions] = useState(false);
  const [isIconPickerOpen, setIconPickerOpen] = useState(false);

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

  const handleSaveClick = () => {
    onSave({
        ...item,
        name,
        type,
        icon,
        version,
        path: gameDir,
        ...(itemTypeName === 'Server' && { port }),
    });
  }

  const title = isNew ? `New ${itemTypeName}` : `Edit ${itemTypeName}`;
  const saveButtonText = isNew ? 'Create' : 'Save';

  const versions = [
    { value: '0.203.175', label: '0.203.175' },
    { value: '24w14a', label: '24w14a' },
    { value: '1.0', label: '1.0' },
  ];
  const resolutionOptions = resolutions.map(res => ({ value: res, label: res }));

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
                onChange={(v) => setType(v as ItemType)}
              />
            </FormField>
            <FormField label="Version" htmlFor="itemVersion">
              <CustomDropdown
                options={versions}
                value={version}
                onChange={setVersion}
              />
            </FormField>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-8 gap-y-6">
          <FormField label="Game Directory" htmlFor="gameDir">
            <div className="flex">
              <input id="gameDir" type="text" value={gameDir} onChange={e => setGameDir(e.target.value)} className="flex-1 bg-slate-900/80 border border-slate-700 rounded-l-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-starmade-accent" />
              <button className="bg-slate-800/80 border-t border-b border-r border-slate-700 px-4 rounded-r-md hover:bg-slate-700/80"><FolderIcon className="w-5 h-5 text-gray-400" /></button>
            </div>
          </FormField>
          <FormField label="Resolution" htmlFor="resolution">
            <CustomDropdown
                options={resolutionOptions}
                value={resolution}
                onChange={setResolution}
                icon={<MonitorIcon className="w-5 h-5 text-gray-400" />}
            />
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
                            <button className="bg-slate-800/80 border-t border-b border-r border-slate-700 px-4 rounded-r-md hover:bg-slate-700/80"><FolderIcon className="w-5 h-5 text-gray-400" /></button>
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
