import React, { useState, useEffect, useRef } from 'react';
import { CogIcon, FolderIcon, TrashIcon, PlayIcon, DownloadIcon, DocumentTextIcon, RestoreIcon } from './icons';
import { getIconComponent } from '../../utils/getIconComponent';
import type { ManagedItem, DownloadStatus } from '../../types';
import Tooltip from './Tooltip';

interface ItemCardProps {
  item: ManagedItem;
  isFeatured?: boolean;
  onEdit: (item: ManagedItem) => void;
  onDelete?: (id: string) => void;
  onDownload?: () => void;
  onCancelDownload?: () => void;
  onOpenFolder?: (path: string) => void;
  onAction?: (item: ManagedItem) => void;
  onViewLogs?: (item: ManagedItem) => void;
  onRestore?: (item: ManagedItem) => void;
  actionButtonText: string;
  statusLabel: string;
  downloadStatus?: DownloadStatus;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(1)} KB`;
  return `${bytes} B`;
}

function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec >= 1e6) return `${(bytesPerSec / 1e6).toFixed(1)} MB/s`;
  if (bytesPerSec >= 1e3) return `${(bytesPerSec / 1e3).toFixed(0)} KB/s`;
  return `${Math.floor(bytesPerSec)} B/s`;
}

const ItemCard: React.FC<ItemCardProps> = ({
  item, isFeatured, onEdit, onDelete,
  onDownload, onCancelDownload, onOpenFolder, onAction, onViewLogs, onRestore,
  actionButtonText, statusLabel,
  downloadStatus,
}) => {
  const [isRunning, setIsRunning] = useState(false);
  
  // ── Download speed calculation (3-second rolling window) ──────────────────
  const speedSamplesRef = useRef<{ bytes: number; time: number }[]>([]);
  const [downloadSpeed, setDownloadSpeed] = useState(0);

  useEffect(() => {
    if (downloadStatus?.state !== 'downloading') {
      speedSamplesRef.current = [];
      setDownloadSpeed(0);
      return;
    }
    const now = Date.now();
    const bytes = downloadStatus.bytesReceived;
    speedSamplesRef.current.push({ bytes, time: now });
    // Keep only the last 3 seconds of samples
    const cutoff = now - 3000;
    speedSamplesRef.current = speedSamplesRef.current.filter(s => s.time >= cutoff);
    const samples = speedSamplesRef.current;
    if (samples.length >= 2) {
      const oldest = samples[0];
      const newest = samples[samples.length - 1];
      const dt = (newest.time - oldest.time) / 1000;
      if (dt > 0) setDownloadSpeed((newest.bytes - oldest.bytes) / dt);
    }
  }, [downloadStatus?.bytesReceived, downloadStatus?.state]);
  
  // Check if this installation is currently running
  useEffect(() => {
    if (typeof window === 'undefined' || !window.launcher?.game) {
      return;
    }
    
    window.launcher.game.status(item.id).then((status) => {
      setIsRunning(status.running);
    }).catch(() => setIsRunning(false));
    
    // Poll every 5 seconds
    const interval = setInterval(() => {
      window.launcher.game.status(item.id).then((status) => {
        setIsRunning(status.running);
      }).catch(() => setIsRunning(false));
    }, 5000);
    
    return () => clearInterval(interval);
  }, [item.id]);

  const isActivelyDownloading =
    downloadStatus?.state === 'checksums' || downloadStatus?.state === 'downloading';

  // An item needs a download when explicitly marked not-installed, and it isn't
  // currently downloading and hasn't just finished.
  const needsDownload =
    item.installed === false &&
    !isActivelyDownloading &&
    downloadStatus?.state !== 'complete';

  // An item is playable if it is installed (or has no `installed` field, i.e. mock data)
  // or if the current download session just completed.
  const isPlayable = item.installed !== false || downloadStatus?.state === 'complete';

  return (
    <div className={`
      flex flex-col gap-3 p-4 rounded-lg bg-black/20 border
      transition-all duration-300
      ${isFeatured
        ? 'border-starmade-accent/80 shadow-[0_0_15px_0px_#227b8644]'
        : 'border-white/10 hover:border-white/20 hover:bg-black/30'}
    `}>
      {/* ── Main row ── */}
      <div className="flex items-center gap-6">
        <div className="flex-shrink-0">
          {getIconComponent(item.icon)}
        </div>

        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-bold text-white">
            {item.name}{' '}
            <span className="text-sm font-normal text-gray-400">{item.version}</span>
          </h3>
          <p className="text-xs text-gray-500 font-mono truncate">{item.path}</p>
        </div>

        {/* Status / progress text */}
        <div className="flex-1 text-right">
          {isActivelyDownloading ? (
            <p className="text-sm text-starmade-accent">
              {downloadStatus!.totalFiles > 0
                ? `${downloadStatus!.filesDownloaded} / ${downloadStatus!.totalFiles} files · ${downloadStatus!.percent}%`
                : downloadStatus!.currentFile}
            </p>
          ) : needsDownload ? (
            <p className="text-sm text-amber-400">Not installed</p>
          ) : downloadStatus?.state === 'error' ? (
            <p className="text-sm text-red-400">Download failed</p>
          ) : (
            <p className="text-sm text-gray-400">{statusLabel}: {item.lastPlayed}</p>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2">
          {isActivelyDownloading ? (
            <button
              onClick={onCancelDownload}
              className="
                flex items-center justify-center gap-2 px-4 py-2 rounded-md
                bg-starmade-danger/20 text-red-300 font-semibold uppercase tracking-wider text-sm
                hover:bg-starmade-danger/30 transition-colors
              "
            >
              Cancel
            </button>
          ) : needsDownload ? (
            <button
              onClick={onDownload}
              disabled={!onDownload}
              className="
                flex items-center justify-center gap-2 px-4 py-2 rounded-md
                bg-starmade-accent/80 text-white font-semibold uppercase tracking-wider text-sm
                hover:bg-starmade-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed
              "
            >
              <DownloadIcon className="w-4 h-4" />
              <span>Download</span>
            </button>
          ) : (
            <button
              onClick={() => onAction?.(item)}
              disabled={!isPlayable || !onAction}
              className="
                flex items-center justify-center gap-2 px-4 py-2 rounded-md
                bg-starmade-accent/80 text-white font-semibold uppercase tracking-wider text-sm
                hover:bg-starmade-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed
              "
            >
              <PlayIcon className="w-4 h-4" />
              <span>{actionButtonText}</span>
            </button>
          )}

          <Tooltip text="Open Directory">
            <button
              onClick={() => onOpenFolder?.(item.path)}
              disabled={!onOpenFolder}
              className="p-2 rounded-md hover:bg-white/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              aria-label="Open Folder"
            >
              <FolderIcon className="w-5 h-5 text-gray-400" />
            </button>
          </Tooltip>
          {isRunning && onViewLogs && (
            <Tooltip text="View Logs">
              <button 
                onClick={() => onViewLogs(item)} 
                className="p-2 rounded-md hover:bg-white/10 transition-colors animate-pulse" 
                aria-label="View Logs"
              >
                <DocumentTextIcon className="w-5 h-5 text-starmade-accent" />
              </button>
            </Tooltip>
          )}
          {onRestore && (
            <Tooltip text="Restore from Backup">
              <button
                onClick={() => onRestore(item)}
                className="p-2 rounded-md hover:bg-starmade-accent/20 transition-colors"
                aria-label="Restore from Backup"
              >
                <RestoreIcon className="w-5 h-5 text-gray-400 hover:text-starmade-accent" />
              </button>
            </Tooltip>
          )}
          <Tooltip text="Settings">
            <button onClick={() => onEdit(item)} className="p-2 rounded-md hover:bg-white/10 transition-colors" aria-label="Settings">
              <CogIcon className="w-5 h-5 text-gray-400" />
            </button>
          </Tooltip>
          <Tooltip text="Delete">
            <button
              onClick={() => onDelete?.(item.id)}
              className="p-2 rounded-md hover:bg-starmade-danger/20 transition-colors"
              aria-label="Delete"
            >
              <TrashIcon className="w-5 h-5 text-gray-400 hover:text-red-400" />
            </button>
          </Tooltip>
        </div>
      </div>

      {/* ── Progress bar (visible while downloading) ── */}
      {isActivelyDownloading && (
        <div className="flex flex-col gap-1">
          <div className="flex justify-between items-center text-xs text-gray-500">
            <span className="font-mono truncate max-w-[55%]">{downloadStatus!.currentFile}</span>
            <div className="flex items-center gap-3 flex-shrink-0">
              {downloadSpeed > 0 && (
                <span className="text-starmade-accent font-semibold">{formatSpeed(downloadSpeed)}</span>
              )}
              {downloadStatus!.totalBytes > 0 && (
                <span>{formatBytes(downloadStatus!.bytesReceived)} / {formatBytes(downloadStatus!.totalBytes)}</span>
              )}
            </div>
          </div>
          <div className="h-1.5 bg-black/50 rounded-full overflow-hidden">
            <div
              className="h-full bg-starmade-accent rounded-full transition-all duration-300"
              style={{ width: `${downloadStatus!.percent}%` }}
            />
          </div>
        </div>
      )}

      {/* ── Error message ── */}
      {downloadStatus?.state === 'error' && (
        <div className="text-xs text-red-300 bg-red-900/20 border border-red-900/40 rounded-md px-3 py-2">
          {downloadStatus.error ?? 'An unknown error occurred during download.'}
        </div>
      )}
    </div>
  );
};

export default ItemCard;
