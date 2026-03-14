import React, { useState } from 'react';
import { BackupIcon, CloseIcon } from './icons';

interface BackupConfirmModalProps {
    isOpen: boolean;
    installationName: string;
    fromVersion: string;
    toVersion: string;
    onBackupAndContinue: () => Promise<void>;
    onSkipBackup: () => void;
    onCancel: () => void;
}

type Phase = 'prompt' | 'backing-up' | 'error';

const BackupConfirmModal: React.FC<BackupConfirmModalProps> = ({
    isOpen,
    installationName,
    fromVersion,
    toVersion,
    onBackupAndContinue,
    onSkipBackup,
    onCancel,
}) => {
    const [phase, setPhase] = useState<Phase>('prompt');
    const [errorMsg, setErrorMsg] = useState('');

    // Reset when the modal opens
    React.useEffect(() => {
        if (isOpen) {
            setPhase('prompt');
            setErrorMsg('');
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const handleBackupAndContinue = async () => {
        setPhase('backing-up');
        setErrorMsg('');
        try {
            await onBackupAndContinue();
        } catch (err) {
            setErrorMsg(String(err));
            setPhase('error');
        }
    };

    return (
        <div
            className="fixed inset-0 bg-black/70 backdrop-blur-md z-50 flex items-center justify-center"
            aria-modal="true"
            role="dialog"
            aria-labelledby="backup-modal-title"
        >
            <div className="relative bg-starmade-bg/90 border border-starmade-accent/30 rounded-xl shadow-2xl shadow-starmade-accent/10 w-full max-w-lg p-8 animate-fade-in-scale">
                {/* Close button — only when not mid-backup */}
                {phase !== 'backing-up' && (
                    <button
                        onClick={onCancel}
                        className="absolute top-3 right-4 p-2 rounded-full hover:bg-white/10 transition-colors"
                        aria-label="Cancel"
                    >
                        <CloseIcon className="w-5 h-5 text-gray-400 hover:text-white" />
                    </button>
                )}

                <div className="flex flex-col items-center text-center">
                    <div className="mb-4 w-16 h-16 flex items-center justify-center rounded-full bg-starmade-accent/20 border-2 border-starmade-accent/50">
                        <BackupIcon className="w-8 h-8 text-starmade-accent" />
                    </div>
                    <h2
                        id="backup-modal-title"
                        className="font-display text-2xl font-bold uppercase text-white tracking-wider"
                    >
                        Back Up Before Changing Version?
                    </h2>
                    <p className="mt-3 text-gray-300 max-w-sm mx-auto leading-relaxed">
                        You are changing the version of{' '}
                        <span className="font-semibold text-white">{installationName}</span>{' '}
                        from{' '}
                        <span className="font-mono text-starmade-accent">{fromVersion}</span>{' '}
                        to{' '}
                        <span className="font-mono text-starmade-accent">{toVersion}</span>.
                    </p>
                    <p className="mt-2 text-sm text-gray-400 max-w-sm mx-auto leading-relaxed">
                        Would you like to create a compressed backup of the current game files first?
                        You can restore from it later if needed.
                    </p>
                </div>

                {/* ── Backing up phase ── */}
                {phase === 'backing-up' && (
                    <div className="mt-6 bg-starmade-accent/10 border border-starmade-accent/30 rounded-lg p-4 text-center">
                        <div className="flex items-center justify-center gap-2 text-starmade-accent">
                            <span aria-hidden="true" className="h-2.5 w-2.5 animate-pulse rounded-full bg-current" />
                            <span className="text-sm font-semibold">Creating backup…</span>
                        </div>
                        <p className="text-xs text-gray-400 mt-1">
                            This may take a moment depending on the installation size.
                        </p>
                    </div>
                )}

                {/* ── Error phase ── */}
                {phase === 'error' && (
                    <div className="mt-6 bg-red-900/20 border border-red-500/30 rounded-lg p-4">
                        <p className="text-sm text-red-400 font-semibold">Backup failed</p>
                        <p className="text-xs text-gray-400 mt-1 break-all">{errorMsg}</p>
                        <p className="text-xs text-gray-400 mt-2">
                            You can still continue without a backup, or cancel to try again.
                        </p>
                    </div>
                )}

                {/* ── Actions ── */}
                {(phase === 'prompt' || phase === 'error') && (
                    <div className="mt-8 flex justify-center items-center gap-4 flex-wrap">
                        <button
                            onClick={onCancel}
                            className="px-5 py-2 rounded-md bg-slate-700 hover:bg-slate-600 border border-slate-600 hover:border-slate-500 transition-colors text-sm font-semibold uppercase tracking-wider"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={onSkipBackup}
                            className="px-5 py-2 rounded-md bg-slate-600 hover:bg-slate-500 border border-slate-500 hover:border-slate-400 transition-colors text-sm font-semibold uppercase tracking-wider"
                        >
                            Skip Backup
                        </button>
                        <button
                            onClick={handleBackupAndContinue}
                            className="px-5 py-2 rounded-md bg-starmade-accent hover:bg-starmade-accent/80 transition-colors text-sm font-bold uppercase tracking-wider shadow-lg"
                        >
                            Backup & Continue
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default BackupConfirmModal;
