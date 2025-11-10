import React, { useState, useRef, useEffect } from 'react';
import { ChevronDownIcon, CheckIcon, BugIcon, ArchiveIcon, ChevronRightIcon, DiscordIcon } from '../common/icons';
import useOnClickOutside from '../hooks/useOnClickOutside';
import type { Version } from '../../types';
import { useApp } from '../../contexts/AppContext';
import { useData } from '../../contexts/DataContext';

const DiscordButton: React.FC = () => {
    const [onlineCount, setOnlineCount] = useState<number | null>(null);
    const [inviteUrl, setInviteUrl] = useState<string>('https://discord.gg/starmade');

    useEffect(() => {
        fetch('https://discordapp.com/api/guilds/100173352475303936/widget.json')
            .then(response => {
                if (!response.ok) {
                    throw new Error('Network response was not ok');
                }
                return response.json();
            })
            .then(data => {
                if (data?.presence_count) {
                    setOnlineCount(data.presence_count);
                }
                if (data?.instant_invite) {
                    setInviteUrl(data.instant_invite);
                }
            })
            .catch(error => {
                console.error('Failed to fetch Discord widget data:', error);
            });
    }, []);

    return (
        <a 
            href={inviteUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 px-4 py-2 bg-black/20 rounded-md hover:bg-black/40 transition-colors border border-white/10 group"
        >
            <DiscordIcon className="w-6 text-gray-400 group-hover:text-white transition-colors" />
            <div className="text-left">
                <p className="text-sm font-medium text-white">Join Discord</p>
                {onlineCount !== null ? (
                    <p className="text-xs text-gray-400 flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse"></span>
                        {onlineCount.toLocaleString()} Online
                    </p>
                ) : (
                    <p className="text-xs text-gray-400">Loading members...</p>
                )}
            </div>
        </a>
    );
};

const VersionSelector: React.FC = () => {
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);
    useOnClickOutside(dropdownRef, () => setIsOpen(false));
    const { versions, selectedVersion, setSelectedVersion } = useData();

    const getIconForType = (type: Version['type']) => {
        switch(type) {
            case 'latest': return <CheckIcon className="w-5 h-5 text-green-400" />;
            case 'release': return <CheckIcon className="w-5 h-5 text-green-400" />;
            case 'dev': return <BugIcon className="w-5 h-5 text-orange-400" />;
            case 'archive': return <ArchiveIcon className="w-5 h-5 text-gray-400" />;
            default: return null;
        }
    }

    if (!selectedVersion) {
        return null;
    }

  return (
    <div className="relative" ref={dropdownRef}>
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-3 pl-4 pr-3 py-2 bg-black/20 rounded-md hover:bg-black/40 transition-colors border border-white/10"
      >
        <div className="flex items-center gap-2">
            {getIconForType(selectedVersion.type)}
            <div className="text-left">
                <p className="text-sm font-medium text-white">{selectedVersion.name.split(' ').slice(0, 2).join(' ')}</p>
                <p className="text-xs text-gray-400">{selectedVersion.name.split(' ').slice(2).join(' ')}</p>
            </div>
        </div>
        <ChevronDownIcon className={`w-5 h-5 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

        {isOpen && (
            <div className="absolute bottom-full mb-2 w-full bg-slate-900/90 backdrop-blur-sm border border-slate-700 rounded-md shadow-lg overflow-hidden z-20">
                <ul>
                    {versions.map(version => (
                        <li key={version.id}>
                            <button 
                                onClick={() => {
                                    setSelectedVersion(version);
                                    setIsOpen(false);
                                }}
                                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-700/50 transition-colors"
                            >
                               {getIconForType(version.type)}
                               <span className="text-sm text-white">{version.name}</span>
                            </button>
                        </li>
                    ))}
                </ul>
            </div>
        )}
    </div>
  );
};

interface SciFiPlayButtonProps {
    isUpdating: boolean;
    onClick: () => void;
    onUpdateComplete: () => void;
}

const SciFiPlayButton: React.FC<SciFiPlayButtonProps> = ({ isUpdating, onClick, onUpdateComplete }) => {
    const [progress, setProgress] = useState(0);

    useEffect(() => {
        if (isUpdating) {
            setProgress(0);
            const interval = setInterval(() => {
                setProgress(prev => {
                    const next = prev + 1;
                    if (next >= 100) {
                        clearInterval(interval);
                        setTimeout(() => {
                            onUpdateComplete();
                        }, 1000);
                        return 100;
                    }
                    return next;
                });
            }, 40);

            return () => {
                clearInterval(interval);
            }
        } else {
            setProgress(0);
        }
    }, [isUpdating, onUpdateComplete]);

    const buttonClipPathId = "scifi-button-clip-path";

    return (
        <button
            onClick={onClick}
            disabled={isUpdating}
            className="
                group relative font-display text-xl font-bold uppercase tracking-wider text-white
                h-[60px] w-[260px]
                transition-all duration-300 ease-in-out
                transform active:scale-95
                disabled:cursor-not-allowed
            "
        >
            <svg width="0" height="0" className="absolute">
                <defs>
                    <clipPath id={buttonClipPathId} clipPathUnits="objectBoundingBox">
                       <polygon points="0 0, 1 0, 1 1, 0.95 1, 0 1" />
                    </clipPath>
                </defs>
            </svg>

            <div
                className="
                    absolute inset-0 bg-slate-900/60 border border-slate-700/80
                    transition-all duration-300
                    group-hover:bg-slate-800/80 group-hover:border-slate-600
                    disabled:group-hover:bg-slate-900/60 disabled:group-hover:border-slate-700/80
                "
                style={{ clipPath: `url(#${buttonClipPathId})` }}
            ></div>

            <div
                className="
                    absolute top-0 left-0 h-full bg-starmade-accent
                    shadow-[0_0_8px_0px_#227b86,0_0_15px_0px_#227b8655]
                "
                style={{
                    clipPath: `url(#${buttonClipPathId})`,
                    width: `${progress}%`,
                    opacity: isUpdating ? 1 : 0,
                    transition: progress > 1 ? 'width 0.05s linear' : 'opacity 0.5s ease-out',
                }}
            ></div>

            <div className="relative z-10 flex items-center justify-center h-full w-full">
                <span className="text-2xl">
                    {isUpdating ? `Updating... ${Math.floor(progress)}%` : 'Launch'}
                </span>
            </div>
        </button>
    );
};


const Footer: React.FC = () => {
  const { navigate, isLaunching, openLaunchModal, completeLaunching } = useApp();

  return (
    <footer className="relative z-20 px-6 py-4 bg-black/20 backdrop-blur-sm border-t border-white/5">
      <div className="flex items-center justify-between">
        <div className="flex-1 flex justify-start">
            <DiscordButton />
        </div>
        
        <div className="flex items-center justify-center gap-6">
            <VersionSelector />

            <SciFiPlayButton 
                isUpdating={isLaunching}
                onClick={openLaunchModal}
                onUpdateComplete={completeLaunching}
            />

            <button 
                onClick={() => navigate('Installations', { initialTab: 'servers' })}
                className="flex items-center gap-2 text-gray-300 hover:text-white transition-colors text-sm font-semibold uppercase tracking-wider">
                <span>Start Server</span>
                <ChevronRightIcon className="w-4 h-4" />
            </button>
        </div>

        <div className="flex-1 flex justify-end">
            {/* This space is intentionally left blank to balance the layout */}
        </div>
      </div>
    </footer>
  );
};

export default Footer;
