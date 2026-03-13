import React, { useState, useEffect, useRef } from 'react';
import { CloseIcon } from './icons';

interface UpdateInfo {
    available: boolean;
    latestVersion: string;
    currentVersion: string;
    releaseNotes: string;
    downloadUrl: string;
    assetUrl?: string;
    assetName?: string;
}

interface UpdateAvailableModalProps {
    isOpen: boolean;
    updateInfo: UpdateInfo | null;
    onDismiss: () => void;
}

/** Download arrow icon */
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

type Phase = 'idle' | 'downloading' | 'ready' | 'error';

const UpdateAvailableModal: React.FC<UpdateAvailableModalProps> = ({
    isOpen,
    updateInfo,
    onDismiss,
}) => {
    const [phase, setPhase] = useState<Phase>('idle');
    const [percent, setPercent] = useState(0);
    const [bytesReceived, setBytesReceived] = useState(0);
    const [totalBytes, setTotalBytes] = useState(0);
    const [errorMsg, setErrorMsg] = useState('');
    const [installerPath, setInstallerPath] = useState('');
    const cleanupRef = useRef<(() => void) | null>(null);

    // Reset state whenever the modal opens with fresh info
    useEffect(() => {
        if (isOpen) {
            setPhase('idle');
            setPercent(0);
            setBytesReceived(0);
            setTotalBytes(0);
            setErrorMsg('');
            setInstallerPath('');
        }
        return () => {
            cleanupRef.current?.();
            cleanupRef.current = null;
        };
    }, [isOpen]);

    if (!isOpen || !updateInfo) return null;

    const canSilentInstall = Boolean(updateInfo.assetUrl);

    const formatBytes = (b: number) => {
        if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
        return `${(b / (1024 * 1024)).toFixed(1)} MB`;
    };

    const handleDownload = async () => {
        if (!updateInfo.assetUrl || !updateInfo.assetName) {
            handleOpenBrowser();
            return;
        }

        setPhase('downloading');
        setPercent(0);

        // Subscribe to progress
        if (window.launcher?.updater?.onDownloadProgress) {
            cleanupRef.current?.();
            const unsub = window.launcher.updater.onDownloadProgress((prog) => {
                setPercent(prog.percent);
                setBytesReceived(prog.bytesReceived);
                setTotalBytes(prog.totalBytes);
            });
            cleanupRef.current = unsub;
        }

        try {
            const result = await window.launcher.updater.downloadUpdate(
                updateInfo.assetUrl!,
                updateInfo.assetName!,
            );

            cleanupRef.current?.();
            cleanupRef.current = null;

            if (result.success && result.installerPath) {
                setInstallerPath(result.installerPath);
                setPercent(100);
                setPhase('ready');
            } else {
                setErrorMsg(result.error ?? 'Download failed for an unknown reason.');
                setPhase('error');
            }
        } catch (err) {
            cleanupRef.current?.();
            cleanupRef.current = null;
            setErrorMsg(String(err));
            setPhase('error');
        }
    };

    const handleInstall = async () => {
        if (!installerPath) return;
        await window.launcher.updater.installUpdate(installerPath);
        // App will quit; if it doesn't (fallback) just dismiss.
        onDismiss();
    };

    const handleOpenBrowser = () => {
        if (window.launcher?.updater?.openReleasesPage) {
            window.launcher.updater.openReleasesPage();
        } else {
            window.open(updateInfo.downloadUrl, '_blank');
        }
        onDismiss();
    };

    return (
        <div
            className="fixed inset-0 bg-black/70 backdrop-blur-md z-50 flex items-center justify-center"
            aria-modal="true"
            role="dialog"
            aria-labelledby="update-modal-title"
        >
            <div className="relative bg-starmade-bg/90 border border-starmade-accent/30 rounded-xl shadow-2xl shadow-starmade-accent/10 w-full max-w-lg p-8 animate-fade-in-scale">
                {/* Close button — only when not mid-download */}
                {phase !== 'downloading' && (
                    <button
                        onClick={onDismiss}
                        className="absolute top-3 right-4 p-2 rounded-full hover:bg-white/10 transition-colors"
                        aria-label="Dismiss update notification"
                    >
                        <CloseIcon className="w-5 h-5 text-gray-400 hover:text-white" />
                    </button>
                )}

                {/* Header */}
                <div className="flex flex-col items-center text-center">
                    <div className="mb-4 w-16 h-16 flex items-center justify-center rounded-full bg-starmade-accent/20 border-2 border-starmade-accent/50">
                        <UpdateIcon className="w-8 h-8 text-starmade-accent" />
                    </div>
                    <h2
                        id="update-modal-title"
                        className="font-display text-2xl font-bold uppercase text-white tracking-wider"
                    >
                        Update Available
                    </h2>
                    <p className="mt-2 text-gray-300 leading-relaxed">
                        A new version of the StarMade Launcher is available.
                    </p>
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
                {updateInfo.releaseNotes && phase === 'idle' && (
                    <div className="mt-6 bg-black/30 rounded-lg p-4 border border-white/10 max-h-40 overflow-y-auto">
                        <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">
                            Release Notes
                        </h3>
                        <p className="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed">
                            {updateInfo.releaseNotes}
                        </p>
                    </div>
                )}

                {/* ── Downloading phase ── */}
                {phase === 'downloading' && (
                    <div className="mt-6">
                        <div className="flex justify-between text-xs text-gray-400 mb-1">
                            <span>Downloading update…</span>
                            <span>{percent}%</span>
                        </div>
                        <div className="w-full h-3 bg-black/40 rounded-full overflow-hidden border border-white/10">
                            <div
                                className="h-full bg-starmade-accent transition-all duration-200 rounded-full"
                                style={{ width: `${percent}%` }}
                            />
                        </div>
                        {totalBytes > 0 && (
                            <p className="text-xs text-gray-500 mt-1 text-right">
                                {formatBytes(bytesReceived)} / {formatBytes(totalBytes)}
                            </p>
                        )}
                    </div>
                )}

                {/* ── Ready to install phase ── */}
                {phase === 'ready' && (
                    <div className="mt-6 bg-green-900/20 border border-green-500/30 rounded-lg p-4 text-center">
                        <p className="text-sm text-green-400 font-semibold">
                            Download complete! Ready to install.
                        </p>
                        <p className="text-xs text-gray-400 mt-1">
                            The launcher will close and the installer will run automatically.
                        </p>
                    </div>
                )}

                {/* ── Error phase ── */}
                {phase === 'error' && (
                    <div className="mt-6 bg-red-900/20 border border-red-500/30 rounded-lg p-4">
                        <p className="text-sm text-red-400 font-semibold">Download failed</p>
                        <p className="text-xs text-gray-400 mt-1 break-all">{errorMsg}</p>
                        <p className="text-xs text-gray-400 mt-2">
                            You can download the update manually from the releases page.
                        </p>
                    </div>
                )}

                {/* ── Actions ── */}
                <div className="mt-6 flex justify-center items-center gap-4">
                    {phase === 'idle' && (
                        <>
                            <button
                                onClick={onDismiss}
                                className="px-6 py-2 rounded-md bg-slate-700 hover:bg-slate-600 border border-slate-600 transition-colors text-sm font-semibold uppercase tracking-wider"
                            >
                                Later
                            </button>
                            {canSilentInstall ? (
                                <button
                                    onClick={handleDownload}
                                    className="px-6 py-2 rounded-md bg-starmade-accent hover:bg-starmade-accent/80 transition-colors text-sm font-bold uppercase tracking-wider shadow-lg"
                                >
                                    Download &amp; Install
                                </button>
                            ) : (
                                <button
                                    onClick={handleOpenBrowser}
                                    className="px-6 py-2 rounded-md bg-starmade-accent hover:bg-starmade-accent/80 transition-colors text-sm font-bold uppercase tracking-wider shadow-lg"
                                >
                                    Open in Browser
                                </button>
                            )}
                        </>
                    )}

                    {phase === 'downloading' && (
                        <p className="text-sm text-gray-400 italic">Please wait…</p>
                    )}

                    {phase === 'ready' && (
                        <>
                            <button
                                onClick={handleOpenBrowser}
                                className="px-6 py-2 rounded-md bg-slate-700 hover:bg-slate-600 border border-slate-600 transition-colors text-sm font-semibold uppercase tracking-wider"
                            >
                                Open in Browser
                            </button>
                            <button
                                onClick={handleInstall}
                                className="px-6 py-2 rounded-md bg-starmade-accent hover:bg-starmade-accent/80 transition-colors text-sm font-bold uppercase tracking-wider shadow-lg"
                            >
                                Install Now
                            </button>
                        </>
                    )}

                    {phase === 'error' && (
                        <>
                            <button
                                onClick={onDismiss}
                                className="px-6 py-2 rounded-md bg-slate-700 hover:bg-slate-600 border border-slate-600 transition-colors text-sm font-semibold uppercase tracking-wider"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleOpenBrowser}
                                className="px-6 py-2 rounded-md bg-starmade-accent hover:bg-starmade-accent/80 transition-colors text-sm font-bold uppercase tracking-wider shadow-lg"
                            >
                                Open in Browser
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};

export default UpdateAvailableModal;
