import React, { useState } from 'react';
import { CloseIcon, ExclamationTriangleIcon, DiscordIcon } from './icons';

interface CrashReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  crashReport: string;
  installationName: string;
}

const CrashReportModal: React.FC<CrashReportModalProps> = ({ 
  isOpen, 
  onClose, 
  crashReport,
  installationName 
}) => {
  const [copied, setCopied] = useState(false);

  if (!isOpen) {
    return null;
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(crashReport).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(err => {
      console.error('Failed to copy crash report:', err);
    });
  };

  const handleExport = () => {
    const blob = new Blob([crashReport], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `starmade-crash-${new Date().toISOString().split('T')[0]}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleOpenDiscord = () => {
    const discordUrl = 'https://discord.gg/SXbkYpU';
    if (typeof window !== 'undefined' && window.launcher) {
      // Open in external browser
      window.open(discordUrl, '_blank');
    }
  };

  const handleOpenBugTracker = () => {
    const bugTrackerUrl = 'https://www.star-made.org/content/bug-reports';
    if (typeof window !== 'undefined') {
      window.open(bugTrackerUrl, '_blank');
    }
  };

  return (
    <div 
      className="fixed inset-0 bg-black/80 backdrop-blur-md z-[60] flex items-center justify-center p-4"
      aria-modal="true"
      role="dialog"
    >
      <div className="relative bg-starmade-bg/95 border border-red-500/50 rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-red-500/30 bg-red-900/20">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 flex items-center justify-center rounded-full bg-red-900/50 border-2 border-red-500/50">
              <ExclamationTriangleIcon className="w-8 h-8 text-red-400" />
            </div>
            <div>
              <h2 className="font-display text-xl font-bold uppercase text-white tracking-wider">
                Game Crash Detected
              </h2>
              <p className="text-sm text-gray-400">{installationName}</p>
            </div>
          </div>
          
          <button 
            onClick={onClose} 
            className="p-2 rounded-full hover:bg-red-500/20 transition-colors"
            aria-label="Close"
          >
            <CloseIcon className="w-6 h-6 text-gray-400 hover:text-red-400" />
          </button>
        </div>

        {/* Message */}
        <div className="px-6 py-4 border-b border-white/10">
          <p className="text-gray-300 leading-relaxed">
            StarMade has crashed. Please help improve the game by reporting this crash to the developers.
            The crash report below contains technical information about what went wrong.
          </p>
        </div>

        {/* Crash Report Preview */}
        <div className="flex-1 overflow-y-auto px-6 py-4 bg-black/30">
          <pre className="text-xs font-mono text-gray-300 whitespace-pre-wrap break-words">
            {crashReport}
          </pre>
        </div>

        {/* Actions */}
        <div className="px-6 py-4 border-t border-white/10 bg-black/20">
          <div className="flex flex-col gap-3">
            <div className="flex justify-between items-center gap-3">
              <div className="flex gap-3">
                <button
                  onClick={handleCopy}
                  className="px-4 py-2 rounded-md bg-slate-700 hover:bg-slate-600 transition-colors text-sm font-semibold uppercase tracking-wider"
                >
                  {copied ? '✓ Copied!' : 'Copy Report'}
                </button>
                <button
                  onClick={handleExport}
                  className="px-4 py-2 rounded-md bg-slate-700 hover:bg-slate-600 transition-colors text-sm font-semibold uppercase tracking-wider"
                >
                  Export as File
                </button>
              </div>
              
              <div className="flex gap-3">
                <button
                  onClick={handleOpenDiscord}
                  className="flex items-center gap-2 px-4 py-2 rounded-md bg-[#5865F2] hover:bg-[#4752C4] transition-colors text-sm font-semibold uppercase tracking-wider"
                >
                  <DiscordIcon className="w-5 h-5" />
                  Report on Discord
                </button>
                {/*<button
                  onClick={handleOpenBugTracker}
                  className="px-4 py-2 rounded-md bg-starmade-accent hover:bg-starmade-accent/80 transition-colors text-sm font-semibold uppercase tracking-wider"
                >
                  Open Bug Tracker
                </button>*/}
              </div>
            </div>
            
            <p className="text-xs text-gray-500">
              Tip: Copy the report and paste it when submitting a bug report. Include steps to reproduce the crash if possible.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CrashReportModal;

