import React, { useState, useEffect, useRef } from 'react';
import { CloseIcon } from './icons';
import CrashReportModal from './CrashReportModal';

interface GameLogViewerProps {
  installationId: string;
  installationName: string;
  installationPath: string;
  isOpen: boolean;
  onClose: () => void;
}

interface LogEntry {
  timestamp: string;
  level: 'INFO' | 'WARNING' | 'ERROR' | 'FATAL' | 'DEBUG' | 'stdout' | 'stderr';
  message: string;
}

const CRASH_CONTEXT_RADIUS = 50;

const CRASH_MARKERS: Array<{ label: string; pattern: RegExp }> = [
  { label: 'exiting normal', pattern: /exiting normal/i },
  { label: 'critical gl error', pattern: /critical gl error/i },
];

const findCrashMarker = (entries: LogEntry[]): { index: number; label: string } | null => {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const marker = CRASH_MARKERS.find(({ pattern }) => pattern.test(entries[index].message));
    if (marker) {
      return { index, label: marker.label };
    }
  }

  return null;
};

const GameLogViewer: React.FC<GameLogViewerProps> = ({ 
  installationId, 
  installationName,
  installationPath,
  isOpen, 
  onClose 
}) => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const [filter, setFilter] = useState<'all' | 'errors' | 'warnings' | 'info' | 'debug'>('all');
  const logContainerRef = useRef<HTMLDivElement>(null);
  const [logPath, setLogPath] = useState<string>('');
  const [crashDetected, setCrashDetected] = useState(false);
  const [showCrashReportModal, setShowCrashReportModal] = useState(false);
  const [crashReport, setCrashReport] = useState<string>('');

  /**
   * Generate a comprehensive crash report with context
   */
  const generateCrashReport = async (
    crashLogs: LogEntry[],
    markerContext?: { index: number; label: string }
  ): Promise<string> => {
    const report: string[] = [];
    
    report.push('═══════════════════════════════════════════════════════════');
    report.push('          STARMADE CRASH REPORT          ');
    report.push('═══════════════════════════════════════════════════════════');
    report.push('');
    report.push(`Installation: ${installationName}`);
    report.push(`Installation ID: ${installationId}`);
    report.push(`Date: ${new Date().toISOString()}`);
    report.push(`Platform: ${navigator.platform}`);
    report.push(`User Agent: ${navigator.userAgent}`);
    report.push('');
    report.push('───────────────────────────────────────────────────────────');
    if (markerContext) {
      report.push(`CRASH LOG (${CRASH_CONTEXT_RADIUS} entries above/below "${markerContext.label}")`);
    } else {
      report.push('CRASH LOG (Last 100 entries before crash)');
    }
    report.push('───────────────────────────────────────────────────────────');
    report.push('');

    const relevantLogs = markerContext
      ? crashLogs.slice(
          Math.max(0, markerContext.index - CRASH_CONTEXT_RADIUS),
          Math.min(crashLogs.length, markerContext.index + CRASH_CONTEXT_RADIUS + 1)
        )
      : crashLogs.slice(-100);
    
    relevantLogs.forEach(log => {
      const levelPadded = log.level.padEnd(8);
      report.push(`[${log.timestamp}] [${levelPadded}] ${log.message}`);
    });
    
    report.push('');

    // Try to read GraphicsInfo.txt if it exists
    if (typeof window !== 'undefined' && window.launcher?.game?.getGraphicsInfo) {
      try {
        const graphicsInfo = await window.launcher.game.getGraphicsInfo(installationPath);
        if (graphicsInfo) {
          report.push('');
          report.push('───────────────────────────────────────────────────────────');
          report.push('GRAPHICS INFORMATION');
          report.push('───────────────────────────────────────────────────────────');
          report.push(graphicsInfo);
        }
      } catch (error) {
        console.log('[Crash Report] GraphicsInfo.txt not available:', error);
      }
    }
    
    report.push('');
    report.push('═══════════════════════════════════════════════════════════');
    report.push('Please report this crash at:');
    report.push('Discord: https://discord.gg/SXbkYpU');
    // report.push('Bug Tracker: https://www.star-made.org/content/bug-reports'); Todo: Replace with phabriactor link once it stops being down
    report.push('═══════════════════════════════════════════════════════════');
    
    return report.join('\n');
  };

  useEffect(() => {
    if (!isOpen || typeof window === 'undefined' || !window.launcher?.game) {
      return;
    }

    // Get log path from main process
    window.launcher.game.getLogPath?.(installationId).then((path: string) => {
      setLogPath(path);
    }).catch(() => {});

    // Listen for log events
    const cleanup = window.launcher.game.onLog?.((data: { 
      installationId: string; 
      level: string; 
      message: string;
    }) => {
      if (data.installationId === installationId) {
        const timestamp = new Date().toLocaleTimeString();
        
        const newLog: LogEntry = {
          timestamp,
          level: data.level as LogEntry['level'],
          message: data.message,
        };
        
        setLogs(prev => {
          const updated = [...prev, newLog];
          
          if (!crashDetected) {
            const processExitMatch = data.message.match(/Process exited with code (-?\d+)/);
            const isProcessError = data.level === 'ERROR' && /^Process error:/.test(data.message);
            const hasProcessTerminalMessage = Boolean(processExitMatch) || isProcessError;

            if (hasProcessTerminalMessage) {
              const markerContext = findCrashMarker(updated);

              // Prefer known crash markers over generic process-exit fallback.
              if (markerContext) {
                setCrashDetected(true);
                generateCrashReport(updated, markerContext).then(report => {
                  setCrashReport(report);
                  setShowCrashReportModal(true);
                }).catch(err => {
                  console.error('[Crash Report] Failed to generate report:', err);
                  setCrashReport('Failed to generate full crash report. Check console logs.');
                  setShowCrashReportModal(true);
                });

                return updated;
              }

              // Fallback detection when no crash markers are present.
              let shouldCrash = false;

              if (isProcessError) {
                shouldCrash = true;
              } else if (processExitMatch) {
                const exitCode = parseInt(processExitMatch[1], 10);
                shouldCrash = exitCode !== 0;
              }

              if (shouldCrash) {
                setCrashDetected(true);
                generateCrashReport(updated).then(report => {
                  setCrashReport(report);
                  setShowCrashReportModal(true);
                }).catch(err => {
                  console.error('[Crash Report] Failed to generate report:', err);
                  setCrashReport('Failed to generate full crash report. Check console logs.');
                  setShowCrashReportModal(true);
                });
              }
            }
          }
          
          return updated;
        });
      }
    });

    return cleanup;
  }, [isOpen, installationId, crashDetected]);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const handleCopyToClipboard = () => {
    const logText = filteredLogs
      .map(log => `[${log.timestamp}] [${log.level.toUpperCase()}] ${log.message}`)
      .join('\n');
    
    navigator.clipboard.writeText(logText).then(() => {
      alert('Logs copied to clipboard!');
    }).catch(err => {
      console.error('Failed to copy logs:', err);
    });
  };

  const handleOpenLogLocation = async () => {
    if (typeof window === 'undefined' || !window.launcher?.game) {
      return;
    }
    
    try {
      await window.launcher.game.openLogLocation?.(installationPath);
    } catch (error) {
      console.error('Failed to open log location:', error);
    }
  };

  const handleClearLogs = () => {
    setLogs([]);
    setCrashDetected(false);
  };

  const handleExportLogs = () => {
    const logText = filteredLogs
      .map(log => `[${log.timestamp}] [${log.level.toUpperCase()}] ${log.message}`)
      .join('\n');
    
    const blob = new Blob([logText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `starmade-${installationName}-${new Date().toISOString().split('T')[0]}.log`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const filteredLogs = logs.filter(log => {
    if (filter === 'all') return true;
    // 'stderr' is intentionally excluded from the errors filter — routine JVM
    // output goes to stderr but is not an error.  Real exceptions/errors that
    // arrive via stderr are already promoted to level 'ERROR' by the launcher.
    if (filter === 'errors') return log.level === 'ERROR' || log.level === 'FATAL';
    if (filter === 'warnings') return log.level === 'WARNING';
    if (filter === 'info') return log.level === 'INFO' || log.level === 'stdout';
    if (filter === 'debug') return log.level === 'DEBUG';
    return true;
  });

  const getLogLevelColor = (level: LogEntry['level']) => {
    switch (level) {
      case 'FATAL':
        return 'text-red-600 font-bold';
      case 'ERROR':
        return 'text-red-400';
      case 'WARNING':
        return 'text-yellow-400';
      case 'INFO':
      case 'stdout':
        return 'text-blue-300';
      case 'stderr':
        // Routine JVM stderr output — neutral colour.  Real errors from stderr
        // are promoted to 'ERROR' level before reaching the viewer.
        return 'text-gray-400';
      case 'DEBUG':
        return 'text-gray-400';
      default:
        return 'text-gray-300';
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <>
      <CrashReportModal
        isOpen={showCrashReportModal}
        onClose={() => setShowCrashReportModal(false)}
        crashReport={crashReport}
        installationName={installationName}
      />
      
      <div 
        className="fixed inset-0 bg-black/70 backdrop-blur-md z-50 flex items-center justify-center p-4"
        aria-modal="true"
        role="dialog"
      >
        <div className="relative bg-starmade-bg/95 border border-starmade-accent/30 rounded-xl shadow-2xl w-full max-w-5xl h-[80vh] flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div>
            <h2 className="font-display text-xl font-bold uppercase text-white tracking-wider flex items-center gap-3">
              Game Log
              {crashDetected && (
                <button
                  onClick={() => setShowCrashReportModal(true)}
                  className="text-xs px-3 py-1 bg-red-900/50 border border-red-500 rounded-md text-red-300 hover:bg-red-900/70 transition-colors animate-pulse cursor-pointer"
                >
                  ⚠ CRASH DETECTED - Click to Report
                </button>
              )}
            </h2>
            <p className="text-sm text-gray-400 mt-1">{installationName}</p>
          </div>
          
          <div className="flex items-center gap-3">
            {/* Filter Toggle */}
            <div className="flex items-center gap-2 text-sm">
              <span className="text-gray-400">Filter:</span>
              <button
                onClick={() => setFilter('all')}
                className={`px-3 py-1 rounded ${
                  filter === 'all' 
                    ? 'bg-starmade-accent text-white' 
                    : 'bg-slate-700 text-gray-300 hover:bg-slate-600'
                } transition-colors`}
              >
                All
              </button>
              <button
                onClick={() => setFilter('info')}
                className={`px-3 py-1 rounded ${
                  filter === 'info' 
                    ? 'bg-blue-500 text-white' 
                    : 'bg-slate-700 text-gray-300 hover:bg-slate-600'
                } transition-colors`}
              >
                Info
              </button>
              <button
                onClick={() => setFilter('warnings')}
                className={`px-3 py-1 rounded ${
                  filter === 'warnings' 
                    ? 'bg-yellow-500 text-white' 
                    : 'bg-slate-700 text-gray-300 hover:bg-slate-600'
                } transition-colors`}
              >
                Warnings
              </button>
              <button
                onClick={() => setFilter('errors')}
                className={`px-3 py-1 rounded ${
                  filter === 'errors' 
                    ? 'bg-red-500 text-white' 
                    : 'bg-slate-700 text-gray-300 hover:bg-slate-600'
                } transition-colors`}
              >
                Errors
              </button>
              <button
                onClick={() => setFilter('debug')}
                className={`px-3 py-1 rounded ${
                  filter === 'debug' 
                    ? 'bg-gray-500 text-white' 
                    : 'bg-slate-700 text-gray-300 hover:bg-slate-600'
                } transition-colors`}
              >
                Debug
              </button>
            </div>

            {/* Auto-scroll Toggle */}
            <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={(e) => setAutoScroll(e.target.checked)}
                className="w-4 h-4 rounded border-gray-600 bg-slate-700"
              />
              Auto-scroll
            </label>

            <button 
              onClick={onClose} 
              className="p-2 rounded-full hover:bg-starmade-danger/20 transition-colors"
              aria-label="Close"
            >
              <CloseIcon className="w-6 h-6 text-gray-400 hover:text-starmade-danger-light" />
            </button>
          </div>
        </div>

        {/* Log Container */}
        <div 
          ref={logContainerRef}
          className="flex-1 overflow-y-auto px-6 py-4 font-mono text-sm bg-black/20"
        >
          {filteredLogs.length === 0 ? (
            <div className="flex items-center justify-center h-full text-gray-500 italic">
              No logs yet. Waiting for game output...
            </div>
          ) : (
            <div className="space-y-1">
              {filteredLogs.map((log, index) => (
                <div key={index} className="flex gap-3 hover:bg-white/5 px-2 py-1 rounded">
                  <span className="text-gray-500 flex-shrink-0">{log.timestamp}</span>
                  <span className={`flex-shrink-0 font-semibold ${getLogLevelColor(log.level)}`}>
                    [{log.level.toUpperCase()}]
                  </span>
                  <span className="break-all text-gray-300">
                    {log.message}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-white/10 bg-black/20">
          <div className="text-sm text-gray-400">
            {filteredLogs.length} log {filteredLogs.length === 1 ? 'entry' : 'entries'}
            {logPath && (
              <span className="ml-3 font-mono text-xs">{logPath}</span>
            )}
          </div>
          
          <div className="flex gap-3">
            <button
              onClick={handleClearLogs}
              className="px-4 py-2 rounded-md bg-slate-700 hover:bg-slate-600 transition-colors text-sm font-semibold uppercase tracking-wider"
            >
              Clear
            </button>
            <button
              onClick={handleOpenLogLocation}
              className="px-4 py-2 rounded-md bg-slate-700 hover:bg-slate-600 transition-colors text-sm font-semibold uppercase tracking-wider"
            >
              Open Folder
            </button>
            <button
              onClick={handleCopyToClipboard}
              className="px-4 py-2 rounded-md bg-slate-700 hover:bg-slate-600 transition-colors text-sm font-semibold uppercase tracking-wider"
            >
              Copy to Clipboard
            </button>
            <button
              onClick={handleExportLogs}
              className="px-4 py-2 rounded-md bg-starmade-accent hover:bg-starmade-accent/80 transition-colors text-sm font-semibold uppercase tracking-wider"
            >
              Export
            </button>
          </div>
        </div>
      </div>
    </div>
    </>
  );
};

export default GameLogViewer;

