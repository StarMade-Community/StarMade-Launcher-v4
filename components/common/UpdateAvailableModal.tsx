import React from 'react';
import { CloseIcon } from './icons';

interface UpdateInfo {
    available: boolean;
    latestVersion: string;
    currentVersion: string;
    releaseNotes: string;
    downloadUrl: string;
}

interface UpdateAvailableModalProps {
    isOpen: boolean;
    updateInfo: UpdateInfo | null;
    onDownload: () => void;
    onDismiss: () => void;
}

/** Icon: arrow pointing down into a tray (represents a download / update). */
const UpdateIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        aria-hidden="true"
    >
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
);

const UpdateAvailableModal: React.FC<UpdateAvailableModalProps> = ({
    isOpen,
    updateInfo,
    onDownload,
    onDismiss,
}) => {
    if (!isOpen || !updateInfo) return null;

    return (
        <div
            className="fixed inset-0 bg-black/70 backdrop-blur-md z-50 flex items-center justify-center"
            aria-modal="true"
            role="dialog"
            aria-labelledby="update-modal-title"
        >
            <div className="relative bg-starmade-bg/90 border border-starmade-accent/30 rounded-xl shadow-2xl shadow-starmade-accent/10 w-full max-w-lg p-8 animate-fade-in-scale">
                {/* Close button */}
                <button
                    onClick={onDismiss}
                    className="absolute top-3 right-4 p-2 rounded-full hover:bg-white/10 transition-colors"
                    aria-label="Dismiss update notification"
                >
                    <CloseIcon className="w-5 h-5 text-gray-400 hover:text-white" />
                </button>

                {/* Header */}
                <div className="flex flex-col items-center text-center">
                    <div className="mb-4 flex-shrink-0 w-16 h-16 flex items-center justify-center rounded-full bg-starmade-accent/20 border-2 border-starmade-accent/50">
                        <UpdateIcon className="w-8 h-8 text-starmade-accent" />
                    </div>

                    <h2
                        id="update-modal-title"
                        className="font-display text-2xl font-bold uppercase text-white tracking-wider"
                    >
                        Update Available
                    </h2>

                    <p className="mt-2 text-gray-300 leading-relaxed">
                        A new version of StarMade Launcher is available.
                    </p>

                    {/* Version badge */}
                    <div className="mt-4 flex items-center gap-3 text-sm">
                        <span className="px-3 py-1 rounded-full bg-white/10 text-gray-400 font-mono">
                            v{updateInfo.currentVersion}
                        </span>
                        <span className="text-gray-500">→</span>
                        <span className="px-3 py-1 rounded-full bg-starmade-accent/20 border border-starmade-accent/40 text-starmade-accent font-mono font-semibold">
                            v{updateInfo.latestVersion}
                        </span>
                    </div>
                </div>

                {/* Release notes */}
                {updateInfo.releaseNotes && (
                    <div className="mt-6 bg-black/30 rounded-lg p-4 border border-white/10 max-h-40 overflow-y-auto">
                        <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">
                            Release Notes
                        </h3>
                        <p className="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed">
                            {updateInfo.releaseNotes}
                        </p>
                    </div>
                )}

                {/* Actions */}
                <div className="mt-6 flex justify-center items-center gap-4">
                    <button
                        onClick={onDismiss}
                        className="px-6 py-2 rounded-md bg-slate-700 hover:bg-slate-600 border border-slate-600 hover:border-slate-500 transition-colors text-sm font-semibold uppercase tracking-wider"
                    >
                        Later
                    </button>
                    <button
                        onClick={onDownload}
                        className="px-6 py-2 rounded-md bg-starmade-accent hover:bg-starmade-accent/80 transition-colors text-sm font-bold uppercase tracking-wider shadow-lg"
                    >
                        Download Update
                    </button>
                </div>
            </div>
        </div>
    );
};

export default UpdateAvailableModal;
