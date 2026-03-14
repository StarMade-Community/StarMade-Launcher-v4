import React, { useCallback, useEffect, useMemo, useState } from 'react';
import PageContainer from '../../common/PageContainer';
import CustomDropdown from '../../common/CustomDropdown';
import { useData } from '../../../contexts/DataContext';
import type { ManagedItem } from '../../../types';

interface ScreenshotEntry {
  name: string;
  path: string;
  fileUrl: string;
  sizeBytes: number;
  modifiedMs: number;
  width: number;
  height: number;
}

interface ScreenshotListResult {
  screenshotsDir: string;
  screenshots: ScreenshotEntry[];
}

type ScreenshotSortMode =
  | 'newest'
  | 'oldest'
  | 'name-asc'
  | 'name-desc'
  | 'size-desc'
  | 'size-asc'
  | 'resolution-desc'
  | 'resolution-asc';

const SORT_OPTIONS: Array<{ value: ScreenshotSortMode; label: string }> = [
  { value: 'newest', label: 'Newest First' },
  { value: 'oldest', label: 'Oldest First' },
  { value: 'name-asc', label: 'Name (A-Z)' },
  { value: 'name-desc', label: 'Name (Z-A)' },
  { value: 'size-desc', label: 'Size (Largest)' },
  { value: 'size-asc', label: 'Size (Smallest)' },
  { value: 'resolution-desc', label: 'Resolution (High-Low)' },
  { value: 'resolution-asc', label: 'Resolution (Low-High)' },
];

const resolutionPixels = (shot: ScreenshotEntry): number => shot.width * shot.height;

function sortScreenshots(items: ScreenshotEntry[], mode: ScreenshotSortMode): ScreenshotEntry[] {
  const next = [...items];

  next.sort((a, b) => {
    switch (mode) {
      case 'oldest':
        return a.modifiedMs - b.modifiedMs;
      case 'name-asc':
        return a.name.localeCompare(b.name);
      case 'name-desc':
        return b.name.localeCompare(a.name);
      case 'size-desc':
        return b.sizeBytes - a.sizeBytes;
      case 'size-asc':
        return a.sizeBytes - b.sizeBytes;
      case 'resolution-desc':
        return resolutionPixels(b) - resolutionPixels(a);
      case 'resolution-asc':
        return resolutionPixels(a) - resolutionPixels(b);
      case 'newest':
      default:
        return b.modifiedMs - a.modifiedMs;
    }
  });

  return next;
}

const toMB = (sizeBytes: number): string => `${(sizeBytes / (1024 * 1024)).toFixed(2)} MB`;

const Screenshots: React.FC = () => {
  const { installations, selectedInstallationId } = useData();
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(selectedInstallationId);
  const [screenshotsDir, setScreenshotsDir] = useState('');
  const [screenshots, setScreenshots] = useState<ScreenshotEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [preview, setPreview] = useState<ScreenshotEntry | null>(null);
  const [targetInstallationId, setTargetInstallationId] = useState<string | null>(selectedInstallationId);
  const [sortMode, setSortMode] = useState<ScreenshotSortMode>('newest');
  const [selectedScreenshotPaths, setSelectedScreenshotPaths] = useState<Set<string>>(new Set());

  const instances = useMemo(() => {
    const deduped = new Map<string, ManagedItem>();
    installations
      .filter((item) => item.path?.trim().length > 0)
      .forEach((item) => deduped.set(item.id, item));
    return Array.from(deduped.values());
  }, [installations]);

  useEffect(() => {
    if (selectedInstanceId && instances.some((instance) => instance.id === selectedInstanceId)) return;
    setSelectedInstanceId(instances[0]?.id ?? null);
  }, [instances, selectedInstanceId]);

  useEffect(() => {
    if (targetInstallationId && instances.some((instance) => instance.id === targetInstallationId)) return;
    setTargetInstallationId(instances[0]?.id ?? null);
  }, [instances, targetInstallationId]);

  useEffect(() => {
    setSelectedScreenshotPaths(new Set());
  }, [selectedInstanceId]);

  const selectedInstance = useMemo(
    () => instances.find((instance) => instance.id === selectedInstanceId) ?? null,
    [instances, selectedInstanceId],
  );

  const targetInstallation = useMemo(
    () => instances.find((instance) => instance.id === targetInstallationId) ?? null,
    [instances, targetInstallationId],
  );

  const sortedScreenshots = useMemo(() => sortScreenshots(screenshots, sortMode), [screenshots, sortMode]);

  const selectedScreenshots = useMemo(
    () => sortedScreenshots.filter((shot) => selectedScreenshotPaths.has(shot.path)),
    [sortedScreenshots, selectedScreenshotPaths],
  );

  const isAllSelected = sortedScreenshots.length > 0 && sortedScreenshots.every((shot) => selectedScreenshotPaths.has(shot.path));

  const loadScreenshots = useCallback(async () => {
    if (!selectedInstance) {
      setScreenshots([]);
      setScreenshotsDir('');
      return;
    }

    if (!window.launcher?.screenshots?.list) {
      setError('Screenshot management is only available inside the desktop launcher.');
      setScreenshots([]);
      setScreenshotsDir('');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await window.launcher.screenshots.list(selectedInstance.path) as ScreenshotListResult;
      setScreenshotsDir(result.screenshotsDir);
      setScreenshots(result.screenshots);
    } catch (err) {
      setError(`Failed to read screenshots: ${String(err)}`);
      setScreenshots([]);
      setScreenshotsDir('');
    } finally {
      setIsLoading(false);
    }
  }, [selectedInstance]);

  useEffect(() => {
    void loadScreenshots();
  }, [loadScreenshots]);

  const runAction = useCallback(async (
    action: () => Promise<{ success: boolean; error?: string }>,
    successText: string,
  ): Promise<boolean> => {
    setStatus(null);
    setError(null);

    try {
      const result = await action();
      if (!result.success) {
        setError(result.error ?? 'Action failed.');
        return false;
      }
      setStatus(successText);
      return true;
    } catch (err) {
      setError(String(err));
      return false;
    }
  }, []);

  const setAsLauncherBackground = useCallback(async (shot: ScreenshotEntry) => {
    if (!selectedInstance || !window.launcher?.screenshots?.setAsLauncherBackground) return;

    const updated = await runAction(
      () => window.launcher.screenshots.setAsLauncherBackground(selectedInstance.path, shot.path),
      'Launcher background updated.',
    );

    if (updated) {
      window.dispatchEvent(new CustomEvent('launcher-background-changed'));
    }
  }, [runAction, selectedInstance]);

  const setAsLoadingScreen = useCallback(async (shot: ScreenshotEntry) => {
    if (!selectedInstance || !window.launcher?.screenshots?.setAsLoadingScreen) return;

    await runAction(
      () => window.launcher.screenshots.setAsLoadingScreen(selectedInstance.path, shot.path, targetInstallation?.path),
      `Loading screen copied to ${targetInstallation?.name ?? 'the selected installation'}.`,
    );
  }, [runAction, selectedInstance, targetInstallation]);

  const toggleScreenshotSelection = useCallback((screenshotPath: string) => {
    setSelectedScreenshotPaths((prev) => {
      const next = new Set(prev);
      if (next.has(screenshotPath)) next.delete(screenshotPath);
      else next.add(screenshotPath);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedScreenshotPaths((prev) => {
      if (sortedScreenshots.length === 0) return new Set();
      if (sortedScreenshots.every((shot) => prev.has(shot.path))) return new Set();
      return new Set(sortedScreenshots.map((shot) => shot.path));
    });
  }, [sortedScreenshots]);

  const runBulkLoadingScreenCopy = useCallback(async () => {
    if (!selectedInstance || !targetInstallation || !window.launcher?.screenshots?.setAsLoadingScreen) return;
    if (selectedScreenshots.length === 0) {
      setError('Select one or more screenshots first.');
      setStatus(null);
      return;
    }

    setError(null);
    setStatus(null);

    let copied = 0;
    let failed = 0;
    for (const shot of selectedScreenshots) {
      const result = await window.launcher.screenshots.setAsLoadingScreen(
        selectedInstance.path,
        shot.path,
        targetInstallation.path,
      );
      if (result.success) copied += 1;
      else failed += 1;
    }

    if (failed > 0) {
      setError(`Copied ${copied} screenshot(s) to ${targetInstallation.name}; ${failed} failed.`);
    } else {
      setStatus(`Copied ${copied} screenshot(s) to ${targetInstallation.name} loading-screens.`);
    }
  }, [selectedInstance, targetInstallation, selectedScreenshots]);

  const runBulkLauncherBackground = useCallback(async () => {
    if (!selectedInstance || !window.launcher?.screenshots?.setAsLauncherBackground) return;
    if (selectedScreenshots.length === 0) {
      setError('Select one or more screenshots first.');
      setStatus(null);
      return;
    }

    const first = selectedScreenshots[0];
    const updated = await runAction(
      () => window.launcher.screenshots.setAsLauncherBackground(selectedInstance.path, first.path),
      `Launcher background set from ${first.name}.`,
    );

    if (updated) {
      window.dispatchEvent(new CustomEvent('launcher-background-changed'));
    }
  }, [runAction, selectedInstance, selectedScreenshots]);

  const deleteScreenshot = useCallback(async (shot: ScreenshotEntry) => {
    if (!selectedInstance || !window.launcher?.screenshots?.delete) return;

    const confirmed = window.confirm(`Delete screenshot "${shot.name}"? This cannot be undone.`);
    if (!confirmed) return;

    const deleted = await runAction(
      () => window.launcher.screenshots.delete(selectedInstance.path, shot.path),
      `Deleted ${shot.name}.`,
    );

    if (!deleted) return;

    setSelectedScreenshotPaths((prev) => {
      const next = new Set(prev);
      next.delete(shot.path);
      return next;
    });

    if (preview?.path === shot.path) {
      setPreview(null);
    }

    await loadScreenshots();
  }, [loadScreenshots, preview, runAction, selectedInstance]);

  const runBulkDeleteScreenshots = useCallback(async () => {
    if (!selectedInstance || !window.launcher?.screenshots?.delete) return;
    if (selectedScreenshots.length === 0) {
      setError('Select one or more screenshots first.');
      setStatus(null);
      return;
    }

    const confirmed = window.confirm(`Delete ${selectedScreenshots.length} selected screenshot(s)? This cannot be undone.`);
    if (!confirmed) return;

    setError(null);
    setStatus(null);

    let deletedCount = 0;
    let failedCount = 0;

    for (const shot of selectedScreenshots) {
      const result = await window.launcher.screenshots.delete(selectedInstance.path, shot.path);
      if (result.success) deletedCount += 1;
      else failedCount += 1;
    }

    if (preview && selectedScreenshots.some((shot) => shot.path === preview.path)) {
      setPreview(null);
    }

    setSelectedScreenshotPaths(new Set());
    await loadScreenshots();

    if (failedCount > 0) {
      setError(`Deleted ${deletedCount} screenshot(s); ${failedCount} failed.`);
      return;
    }

    setStatus(`Deleted ${deletedCount} screenshot(s).`);
  }, [loadScreenshots, preview, selectedInstance, selectedScreenshots]);

  return (
    <PageContainer>
      <div className="h-full flex flex-col gap-4 min-h-0">
        <div className="flex items-center justify-between gap-4">
          <h1 className="font-display text-3xl font-bold uppercase text-white tracking-wider">Screenshots</h1>
          <button
            type="button"
            onClick={() => void loadScreenshots()}
            className="px-3 py-2 rounded-md border border-slate-700 bg-slate-900/70 hover:bg-slate-800/80 text-sm"
          >
            Refresh
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(280px,420px)_1fr] gap-4 items-start">
          <div>
            <p className="text-xs uppercase tracking-wider text-gray-400 mb-2">Installation</p>
            {instances.length > 0 ? (
              <CustomDropdown
                options={instances.map((instance) => ({ value: instance.id, label: `${instance.name} (${instance.version})` }))}
                value={selectedInstanceId ?? instances[0].id}
                onChange={(value) => setSelectedInstanceId(value)}
              />
            ) : (
              <p className="text-sm text-gray-300">No installations with a valid path were found.</p>
            )}
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-gray-400 mb-1">Detected Folder</p>
            <p className="text-sm text-gray-200 break-all">{screenshotsDir || 'n/a'}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
          <div>
            <p className="text-xs uppercase tracking-wider text-gray-400 mb-2">Loading Screen Target</p>
            {instances.length > 0 ? (
              <CustomDropdown
                options={instances.map((instance) => ({ value: instance.id, label: `${instance.name} (${instance.version})` }))}
                value={targetInstallationId ?? instances[0].id}
                onChange={(value) => setTargetInstallationId(value)}
              />
            ) : (
              <p className="text-sm text-gray-300">No installations are available.</p>
            )}
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-gray-400 mb-2">Sort</p>
            <CustomDropdown
              options={SORT_OPTIONS}
              value={sortMode}
              onChange={(value) => setSortMode(value)}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={toggleSelectAll}
            className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-xs"
          >
            {isAllSelected ? 'Clear All' : 'Select All'}
          </button>
          <button
            type="button"
            onClick={() => void runBulkLoadingScreenCopy()}
            className="px-3 py-1.5 rounded bg-indigo-900/70 hover:bg-indigo-800 text-xs"
          >
            Bulk Set Loading Screens ({selectedScreenshots.length})
          </button>
          <button
            type="button"
            onClick={() => void runBulkLauncherBackground()}
            className="px-3 py-1.5 rounded bg-teal-900/60 hover:bg-teal-800 text-xs"
          >
            Add as Launcher BG from Selection
          </button>
          <button
            type="button"
            onClick={() => void runBulkDeleteScreenshots()}
            className="px-3 py-1.5 rounded bg-red-900/70 hover:bg-red-800 text-xs"
          >
            Delete Selected ({selectedScreenshots.length})
          </button>
        </div>

        {status && <p className="text-sm text-emerald-300">{status}</p>}
        {error && <p className="text-sm text-red-300">{error}</p>}

        <div className="flex-grow min-h-0 overflow-y-auto pr-1">
          {isLoading ? (
            <div className="h-full flex items-center justify-center text-gray-300">Loading screenshots...</div>
          ) : sortedScreenshots.length === 0 ? (
            <div className="h-full flex items-center justify-center text-gray-400">
              No PNG screenshots found in this instance.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {sortedScreenshots.map((shot) => (
                <article
                  key={shot.path}
                  className={`rounded-lg border bg-black/30 overflow-hidden ${selectedScreenshotPaths.has(shot.path) ? 'border-starmade-accent/80' : 'border-white/10'}`}
                >
                  <button
                    type="button"
                    onClick={() => setPreview(shot)}
                    className="block w-full text-left relative"
                  >
                    <img
                      src={shot.fileUrl}
                      alt={shot.name}
                      loading="lazy"
                      className="w-full h-40 object-cover bg-slate-900"
                    />
                    <label
                      className="absolute top-2 left-2 bg-black/70 rounded px-2 py-1 text-xs text-white flex items-center gap-2"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={selectedScreenshotPaths.has(shot.path)}
                        onChange={() => toggleScreenshotSelection(shot.path)}
                      />
                      Select
                    </label>
                  </button>

                  <div className="p-3 space-y-2">
                    <p className="text-sm font-semibold text-white truncate" title={shot.name}>{shot.name}</p>
                    <div className="text-xs text-gray-300 space-y-1">
                      <p>Resolution: {shot.width > 0 && shot.height > 0 ? `${shot.width} x ${shot.height}` : 'Unknown'}</p>
                      <p>Size: {toMB(shot.sizeBytes)}</p>
                    </div>

                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setPreview(shot)}
                        className="px-2 py-1.5 rounded bg-slate-800/90 hover:bg-slate-700 text-xs"
                      >
                        Preview
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (!selectedInstance || !window.launcher?.screenshots?.copyToClipboard) return;
                          void runAction(
                            () => window.launcher.screenshots.copyToClipboard(selectedInstance.path, shot.path),
                            'Screenshot copied to clipboard.',
                          );
                        }}
                        className="px-2 py-1.5 rounded bg-slate-800/90 hover:bg-slate-700 text-xs"
                      >
                        Copy
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (!selectedInstance || !window.launcher?.screenshots?.openContainingFolder) return;
                          void runAction(
                            () => window.launcher.screenshots.openContainingFolder(selectedInstance.path, shot.path),
                            'Opened screenshot folder.',
                          );
                        }}
                        className="px-2 py-1.5 rounded bg-slate-800/90 hover:bg-slate-700 text-xs"
                      >
                        Open Folder
                      </button>
                      <button
                        type="button"
                        onClick={() => void setAsLauncherBackground(shot)}
                        className="px-2 py-1.5 rounded bg-teal-900/60 hover:bg-teal-800 text-xs"
                      >
                        Add as Launcher BG
                      </button>
                      <button
                        type="button"
                        onClick={() => void setAsLoadingScreen(shot)}
                        className="px-2 py-1.5 rounded bg-indigo-900/70 hover:bg-indigo-800 text-xs"
                      >
                        Add as Loading Screen
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteScreenshot(shot)}
                        className="px-2 py-1.5 rounded bg-red-900/70 hover:bg-red-800 text-xs"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </div>

      {preview && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-8">
          <div className="w-full max-w-5xl rounded-xl border border-white/10 bg-slate-950/90 p-4">
            <div className="flex items-center justify-between gap-4 mb-3">
              <p className="text-sm text-gray-200 truncate">{preview.name}</p>
              <button
                type="button"
                onClick={() => setPreview(null)}
                className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-sm"
              >
                Close
              </button>
            </div>
            <img
              src={preview.fileUrl}
              alt={preview.name}
              className="w-full max-h-[75vh] object-contain bg-black rounded-md"
            />
          </div>
        </div>
      )}
    </PageContainer>
  );
};

export default Screenshots;

