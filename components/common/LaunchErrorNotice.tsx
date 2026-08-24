import React from 'react';
import { useApp } from '../../contexts/AppContext';
import { ExclamationTriangleIcon, CloseIcon } from './icons';

/**
 * Surfaces a failed launch.
 *
 * Every launch failure already set `launchError`, but nothing rendered it, so
 * clicking Play (or a quick-play card) that could not start the game looked
 * exactly like nothing happening. Sits above the update notice: a launch the
 * user just asked for and did not get is the more urgent of the two.
 */
const LaunchErrorNotice: React.FC = () => {
    const { launchError, dismissLaunchError } = useApp();

    if (!launchError) return null;

    return (
        <div
            className="fixed top-16 right-6 z-50 max-w-md animate-fade-in-scale"
            role="alert"
        >
            <div className="flex items-start gap-3 px-4 py-3 rounded-lg bg-slate-900/95 backdrop-blur-sm border border-starmade-danger/40 shadow-lg shadow-black/40">
                <ExclamationTriangleIcon className="w-5 h-5 flex-shrink-0 mt-px text-starmade-danger-light" />
                <div className="min-w-0">
                    <p className="text-sm font-bold uppercase tracking-wider text-starmade-danger-light">
                        Launch failed
                    </p>
                    <p className="mt-1 text-sm text-gray-300 break-words">{launchError}</p>
                </div>
                <button
                    onClick={dismissLaunchError}
                    className="flex-shrink-0 p-1 rounded hover:bg-white/10 transition-colors"
                    aria-label="Dismiss launch error"
                >
                    <CloseIcon className="w-4 h-4 text-gray-400 hover:text-white" />
                </button>
            </div>
        </div>
    );
};

export default LaunchErrorNotice;
