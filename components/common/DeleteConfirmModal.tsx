import React from 'react';
import { TrashIcon, CloseIcon } from './icons';

interface DeleteConfirmModalProps {
    isOpen: boolean;
    itemName: string;
    itemTypeName: string;
    error?: string | null;
    onConfirm: () => void;
    onCancel: () => void;
}

const DeleteConfirmModal: React.FC<DeleteConfirmModalProps> = ({
    isOpen,
    itemName,
    itemTypeName,
    error,
    onConfirm,
    onCancel,
}) => {
    if (!isOpen) {
        return null;
    }

    return (
        <div
            className="fixed inset-0 bg-black/70 backdrop-blur-md z-50 flex items-center justify-center"
            aria-modal="true"
            role="dialog"
        >
            <div className="relative bg-starmade-bg/90 border border-starmade-danger/30 rounded-xl shadow-2xl shadow-starmade-danger/10 w-full max-w-lg p-8 animate-fade-in-scale">
                <div className="flex flex-col items-center text-center">
                    <div className="mb-4 flex-shrink-0 w-16 h-16 flex items-center justify-center rounded-full bg-starmade-danger-dark/50 border-2 border-starmade-danger/50">
                        <TrashIcon className="w-8 h-8 text-starmade-danger-light" />
                    </div>

                    <h2 className="font-display text-2xl font-bold uppercase text-white tracking-wider">
                        Delete {itemTypeName}?
                    </h2>
                    <p className="mt-3 text-gray-300 max-w-sm mx-auto leading-relaxed">
                        Are you sure you want to delete{' '}
                        <span className="font-semibold text-white">{itemName}</span>?
                    </p>
                    <p className="mt-2 text-sm text-red-400 max-w-sm mx-auto leading-relaxed">
                        This will permanently delete all game files on disk. This action cannot be undone.
                    </p>

                    {error && (
                        <div className="mt-4 w-full text-xs text-red-300 bg-red-900/20 border border-red-900/40 rounded-md px-3 py-2 text-left break-words">
                            <span className="font-semibold">Error: </span>{error}
                        </div>
                    )}
                </div>

                <div className="mt-8 flex justify-center items-center gap-4 flex-wrap">
                    <button
                        onClick={onCancel}
                        className="px-6 py-2 rounded-md bg-slate-700 hover:bg-slate-600 border border-slate-600 hover:border-slate-500 transition-colors text-sm font-semibold uppercase tracking-wider"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={onConfirm}
                        className="px-6 py-2 rounded-md bg-starmade-danger hover:bg-starmade-danger-hover transition-colors text-sm font-bold uppercase tracking-wider shadow-danger hover:shadow-danger-hover"
                    >
                        Delete Files
                    </button>
                </div>

                <button
                    onClick={onCancel}
                    className="absolute top-3 right-4 p-2 rounded-full hover:bg-starmade-danger/20 transition-colors"
                    aria-label="Close"
                >
                    <CloseIcon className="w-6 h-6 text-gray-400 hover:text-starmade-danger-light" />
                </button>
            </div>
        </div>
    );
};

export default DeleteConfirmModal;
