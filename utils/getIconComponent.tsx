import React from 'react';
import { 
    CheckIcon, BugIcon, ArchiveIcon, DevIcon, RocketIcon, 
    PlanetIcon, StarIcon, ServerIcon, CodeBracketIcon, BoltIcon, 
    BeakerIcon, CubeIcon, GamepadIcon 
} from '../components/common/icons';

export const getIconComponent = (icon: string, size: 'large' | 'small' = 'small') => {
    const sizeClass = size === 'large' ? "w-16 h-16" : "w-6 h-6";

    // Custom image: absolute path or already a file:// URL
    if (icon.startsWith('file://') || icon.startsWith('/') || /^[A-Za-z]:[\\\/]/.test(icon)) {
        const src = icon.startsWith('file://') ? icon : `file://${icon}`;
        return <img src={src} className={`${sizeClass} object-contain rounded`} alt="Custom icon" />;
    }

    switch(icon) {
        case 'latest': return <CheckIcon className={`${sizeClass} text-green-400`} />;
        case 'release': return <CheckIcon className={`${sizeClass} text-green-400`} />;
        case 'dev': return <CodeBracketIcon className={`${sizeClass} text-orange-400`} />;
        case 'pre': return <DevIcon className={`${sizeClass} text-yellow-400`} />;
        case 'archive': return <ArchiveIcon className={`${sizeClass} text-gray-400`} />;
        case 'rocket': return <RocketIcon className={`${sizeClass} text-indigo-400`} />;
        case 'planet': return <PlanetIcon className={`${sizeClass} text-cyan-400`} />;
        case 'star': return <StarIcon className={`${sizeClass} text-yellow-300`} />;
        case 'server': return <ServerIcon className={`${sizeClass} text-slate-400`} />;
        case 'code': return <CodeBracketIcon className={`${sizeClass} text-sky-400`} />;
        case 'bolt': return <BoltIcon className={`${sizeClass} text-amber-400`} />;
        case 'beaker': return <BeakerIcon className={`${sizeClass} text-emerald-400`} />;
        case 'cube': return <CubeIcon className={`${sizeClass} text-rose-400`} />;
        default: return <GamepadIcon className={`${sizeClass} text-gray-400`} />;
    }
}
