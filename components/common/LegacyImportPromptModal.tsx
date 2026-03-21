import React from 'react';
import { CloseIcon, FolderIcon } from './icons';

interface LegacyImportPromptModalProps {
  isOpen: boolean;
  installPaths: string[];
  isImporting: boolean;
  errorMessage?: string | null;
  onImportAll: () => void;
  onOpenSettings: () => void;
  onDismiss: () => void;
}

const LegacyImportPromptModal: React.FC<LegacyImportPromptModalProps> = ({
  isOpen,
  installPaths,
  isImporting,
  errorMessage,
  onImportAll,
  onOpenSettings,
  onDismiss,
}) => {
  if (!isOpen || installPaths.length === 0) return null;

  const installLabel = installPaths.length === 1 ? 'installation' : 'installations';

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-md z-50 flex items-center justify-center"
      aria-modal="true"
      role="dialog"
      aria-labelledby="legacy-import-prompt-title"
    >
      <div className="relative bg-starmade-bg/90 border border-starmade-accent/30 rounded-xl shadow-2xl shadow-starmade-accent/10 w-full max-w-2xl p-8 animate-fade-in-scale">
        {!isImporting && (
          <button
            onClick={onDismiss}
            className="absolute top-3 right-4 p-2 rounded-full hover:bg-white/10 transition-colors"
            aria-label="Dismiss legacy import prompt"
          >
            <CloseIcon className="w-5 h-5 text-gray-400 hover:text-white" />
          </button>
        )}

        <div className="flex items-start gap-4">
          <div className="mt-1 w-14 h-14 flex items-center justify-center rounded-full bg-starmade-accent/20 border border-starmade-accent/40 flex-shrink-0">
            <FolderIcon className="w-7 h-7 text-starmade-accent" />
          </div>

          <div className="min-w-0 flex-1">
            <h2
              id="legacy-import-prompt-title"
              className="font-display text-2xl font-bold uppercase text-white tracking-wider"
            >
              Import Old StarMade Installations
            </h2>
            <p className="mt-2 text-sm text-gray-300 leading-relaxed">
              We found {installPaths.length} legacy {installLabel} from an older launcher. You can import them now,
              or review the detected folders in Launcher Settings.
            </p>
            <p className="mt-2 text-xs text-gray-400">
              Legacy installs are detected by finding folders that contain <span className="font-mono text-gray-300">StarMade.jar</span>.
            </p>
          </div>
        </div>

        <div className="mt-6 max-h-64 overflow-y-auto rounded-lg border border-white/10 bg-black/20 divide-y divide-white/5">
          {installPaths.map((installPath) => (
            <div key={installPath} className="px-4 py-3">
              <span className="block text-xs text-gray-300 font-mono break-all">{installPath}</span>
            </div>
          ))}
        </div>

        {errorMessage && (
          <div className="mt-4 rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {errorMessage}
          </div>
        )}

        <div className="mt-6 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-3">
          <button
            onClick={onDismiss}
            disabled={isImporting}
            className="px-4 py-2 rounded-md border border-white/10 text-sm font-semibold uppercase tracking-wider text-gray-400 hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Not Now
          </button>
          <button
            onClick={onOpenSettings}
            disabled={isImporting}
            className="px-4 py-2 rounded-md bg-slate-700 hover:bg-slate-600 text-sm font-semibold uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Review in Settings
          </button>
          <button
            onClick={onImportAll}
            disabled={isImporting}
            className="px-4 py-2 rounded-md bg-starmade-accent hover:bg-starmade-accent/80 text-sm font-bold uppercase tracking-wider disabled:bg-starmade-accent/50 disabled:cursor-not-allowed transition-colors"
          >
            {isImporting ? 'Importing…' : `Import ${installPaths.length === 1 ? 'Installation' : 'All'}`}
          </button>
        </div>
      </div>
    </div>
  );
};

export default LegacyImportPromptModal;

