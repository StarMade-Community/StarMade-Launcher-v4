import React, { useState, useEffect, useCallback } from 'react';
import { RestoreIcon, CloseIcon, TrashIcon } from './icons';

interface BackupEntry {
    name: string;
    path: string;
    createdAt: string;
    sizeBytes: number;
}

interface RestoreBackupModalProps {
    isOpen: boolean;
    installation: { id: string; name: string; path: string } | null;
    onClose: () => void;
    /** Called after a successful restore so the parent can mark the installation as installed. */
    onRestored: () => void;
}

type Phase = 'list' | 'confirm' | 'restoring' | 'success' | 'error';

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
    try {
        return new Date(iso).toLocaleString();
    } catch {
        return iso;
    }
}

const RestoreBackupModal: React.FC<RestoreBackupModalProps> = ({
    isOpen,
    installation,
    onClose,
    onRestored,
}) => {
    const [phase, setPhase] = useState<Phase>('list');
    const [backups, setBackups] = useState<BackupEntry[]>([]);
    const [loading, setLoading] = useState(false);
    const [selectedBackup, setSelectedBackup] = useState<BackupEntry | null>(null);
    const [errorMsg, setErrorMsg] = useState('');

    const loadBackups = useCallback(async () => {
        if (!installation || typeof window === 'undefined' || !window.launcher?.installation) return;
        setLoading(true);
        try {
            const result = await window.launcher.installation.listBackups(installation.id);
            setBackups(result);
        } catch (err) {
            console.error('[RestoreBackupModal] Failed to list backups:', err);
            setBackups([]);
        } finally {
            setLoading(false);
        }
    }, [installation]);

    useEffect(() => {
        if (!isOpen || !installation) return;
        setPhase('list');
        setSelectedBackup(null);
        setErrorMsg('');
        loadBackups();
    }, [isOpen, installation, loadBackups]);

    const handleSelectBackup = (backup: BackupEntry) => {
        setSelectedBackup(backup);
        setPhase('confirm');
        setErrorMsg('');
    };

    const handleConfirmRestore = async () => {
        if (!selectedBackup || !installation) return;
        setPhase('restoring');
        setErrorMsg('');
        try {
            const result = await window.launcher.installation.restore(
                selectedBackup.path,
                installation.path,
            );
            if (result.success) {
                setPhase('success');
            } else {
                setErrorMsg(result.error ?? 'Restore failed for an unknown reason.');
                setPhase('error');
            }
        } catch (err) {
            setErrorMsg(String(err));
            setPhase('error');
        }
    };

    const handleSuccess = () => {
        onRestored();
        onClose();
    };

    if (!isOpen || !installation) return null;

    return (
        <div
            className="fixed inset-0 bg-black/70 backdrop-blur-md z-50 flex items-center justify-center"
            aria-modal="true"
            role="dialog"
            aria-labelledby="restore-modal-title"
        >
            <div className="relative bg-starmade-bg/90 border border-starmade-accent/30 rounded-xl shadow-2xl shadow-starmade-accent/10 w-full max-w-lg p-8 animate-fade-in-scale">
                {/* Close button — not during active restore */}
                {phase !== 'restoring' && (
                    <button
                        onClick={onClose}
                        className="absolute top-3 right-4 p-2 rounded-full hover:bg-white/10 transition-colors"
                        aria-label="Close"
                    >
                        <CloseIcon className="w-5 h-5 text-gray-400 hover:text-white" />
                    </button>
                )}

                {/* Header */}
                <div className="flex flex-col items-center text-center">
                    <div className="mb-4 w-16 h-16 flex items-center justify-center rounded-full bg-starmade-accent/20 border-2 border-starmade-accent/50">
                        <RestoreIcon className="w-8 h-8 text-starmade-accent" />
                    </div>
                    <h2
                        id="restore-modal-title"
                        className="font-display text-2xl font-bold uppercase text-white tracking-wider"
                    >
                        Restore from Backup
                    </h2>
                    <p className="mt-2 text-gray-300 text-sm leading-relaxed">
                        Restore{' '}
                        <span className="font-semibold text-white">{installation.name}</span>{' '}
                        from a previously created backup.
                    </p>
                </div>

                {/* ── List phase ── */}
                {phase === 'list' && (
                    <div className="mt-6">
                        {loading ? (
                            <div className="flex items-center justify-center gap-2 text-gray-400 py-6">
                                <span aria-hidden="true" className="h-2.5 w-2.5 animate-pulse rounded-full bg-current" />
                                <span className="text-sm">Loading backups…</span>
                            </div>
                        ) : backups.length === 0 ? (
                            <div className="text-center py-6">
                                <p className="text-gray-400 text-sm">No backups found for this installation.</p>
                                <p className="text-gray-500 text-xs mt-1">
                                    Backups are created when you change the version of an installation.
                                </p>
                            </div>
                        ) : (
                            <ul className="space-y-2 max-h-64 overflow-y-auto pr-1">
                                {backups.map((backup) => (
                                    <li key={backup.path}>
                                        <button
                                            onClick={() => handleSelectBackup(backup)}
                                            className="w-full text-left px-4 py-3 rounded-lg bg-black/30 border border-white/10 hover:border-starmade-accent/50 hover:bg-starmade-accent/10 transition-colors group"
                                        >
                                            <div className="flex items-start justify-between gap-2">
                                                <div className="min-w-0">
                                                    <p className="text-sm font-medium text-white truncate group-hover:text-starmade-accent transition-colors">
                                                        {backup.name}
                                                    </p>
                                                    <p className="text-xs text-gray-400 mt-0.5">
                                                        {formatDate(backup.createdAt)}
                                                    </p>
                                                </div>
                                                <span className="text-xs text-gray-500 whitespace-nowrap pt-0.5 flex-shrink-0">
                                                    {formatBytes(backup.sizeBytes)}
                                                </span>
                                            </div>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}
                        <div className="mt-6 flex justify-center">
                            <button
                                onClick={onClose}
                                className="px-6 py-2 rounded-md bg-slate-700 hover:bg-slate-600 border border-slate-600 transition-colors text-sm font-semibold uppercase tracking-wider"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                )}

                {/* ── Confirm phase ── */}
                {phase === 'confirm' && selectedBackup && (
                    <div className="mt-6">
                        <div className="bg-yellow-900/20 border border-yellow-500/30 rounded-lg p-4">
                            <div className="flex items-start gap-2">
                                <TrashIcon className="w-4 h-4 text-yellow-400 mt-0.5 flex-shrink-0" />
                                <div>
                                    <p className="text-sm text-yellow-300 font-semibold">Warning: This will overwrite current game files</p>
                                    <p className="text-xs text-gray-400 mt-1">
                                        The current contents of the installation directory will be permanently
                                        replaced with the backup. This action cannot be undone.
                                    </p>
                                </div>
                            </div>
                        </div>
                        <div className="mt-4 bg-black/30 rounded-lg border border-white/10 p-3">
                            <p className="text-xs text-gray-400 mb-1">Restoring from:</p>
                            <p className="text-sm text-white font-medium truncate">{selectedBackup.name}</p>
                            <p className="text-xs text-gray-500 mt-0.5">{formatDate(selectedBackup.createdAt)} · {formatBytes(selectedBackup.sizeBytes)}</p>
                        </div>
                        <div className="mt-6 flex justify-center items-center gap-4">
                            <button
                                onClick={() => setPhase('list')}
                                className="px-5 py-2 rounded-md bg-slate-700 hover:bg-slate-600 border border-slate-600 transition-colors text-sm font-semibold uppercase tracking-wider"
                            >
                                Back
                            </button>
                            <button
                                onClick={handleConfirmRestore}
                                className="px-5 py-2 rounded-md bg-starmade-accent hover:bg-starmade-accent/80 transition-colors text-sm font-bold uppercase tracking-wider shadow-lg"
                            >
                                Restore
                            </button>
                        </div>
                    </div>
                )}

                {/* ── Restoring phase ── */}
                {phase === 'restoring' && (
                    <div className="mt-6 bg-starmade-accent/10 border border-starmade-accent/30 rounded-lg p-4 text-center">
                        <div className="flex items-center justify-center gap-2 text-starmade-accent">
                            <span aria-hidden="true" className="h-2.5 w-2.5 animate-pulse rounded-full bg-current" />
                            <span className="text-sm font-semibold">Restoring…</span>
                        </div>
                        <p className="text-xs text-gray-400 mt-1">
                            Extracting backup files. Please wait.
                        </p>
                    </div>
                )}

                {/* ── Success phase ── */}
                {phase === 'success' && (
                    <div className="mt-6">
                        <div className="bg-green-900/20 border border-green-500/30 rounded-lg p-4 text-center">
                            <p className="text-sm text-green-400 font-semibold">Restore successful!</p>
                            <p className="text-xs text-gray-400 mt-1">
                                The installation has been restored from the backup.
                            </p>
                        </div>
                        <div className="mt-6 flex justify-center">
                            <button
                                onClick={handleSuccess}
                                className="px-6 py-2 rounded-md bg-starmade-accent hover:bg-starmade-accent/80 transition-colors text-sm font-bold uppercase tracking-wider shadow-lg"
                            >
                                Done
                            </button>
                        </div>
                    </div>
                )}

                {/* ── Error phase ── */}
                {phase === 'error' && (
                    <div className="mt-6">
                        <div className="bg-red-900/20 border border-red-500/30 rounded-lg p-4">
                            <p className="text-sm text-red-400 font-semibold">Restore failed</p>
                            <p className="text-xs text-gray-400 mt-1 break-all">{errorMsg}</p>
                        </div>
                        <div className="mt-6 flex justify-center items-center gap-4">
                            <button
                                onClick={() => setPhase('list')}
                                className="px-5 py-2 rounded-md bg-slate-700 hover:bg-slate-600 border border-slate-600 transition-colors text-sm font-semibold uppercase tracking-wider"
                            >
                                Back
                            </button>
                            <button
                                onClick={onClose}
                                className="px-5 py-2 rounded-md bg-slate-600 hover:bg-slate-500 border border-slate-500 transition-colors text-sm font-semibold uppercase tracking-wider"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default RestoreBackupModal;
