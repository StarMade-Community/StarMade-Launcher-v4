import React, { useCallback, useEffect, useMemo, useState } from 'react';
import PageContainer from '../../common/PageContainer';
import CustomDropdown from '../../common/CustomDropdown';
import { useData } from '../../../contexts/DataContext';
import type { ManagedItem, ModRecord, SmdModResource, SmdInstalledUpdateStatus } from '../../../types';

interface ModsListResult {
  modsDir: string;
  mods: ModRecord[];
}

interface ModsBridge {
  list: (installationPath: string) => Promise<ModsListResult>;
  listSmdMods: (searchQuery?: string) => Promise<{ success: boolean; mods: SmdModResource[]; error?: string }>;
  installOrUpdateFromSmd: (installationPath: string, resourceId: number, enabled?: boolean) => Promise<{ success: boolean; mod?: ModRecord; error?: string }>;
  checkSmdUpdates: (installed: Array<{ resourceId: number; smdVersion: string }>) => Promise<{ success: boolean; updates: SmdInstalledUpdateStatus[]; error?: string }>;
  remove: (installationPath: string, relativePath: string) => Promise<{ success: boolean; error?: string }>;
  exportModpack: (
    installationPath: string,
    outputPath: string,
    options?: { name?: string; sourceInstallation?: { id?: string; name?: string; version?: string } },
  ) => Promise<{ success: boolean; outputPath?: string; exportedCount?: number; skippedCount?: number; error?: string }>;
  importModpack: (
    installationPath: string,
    manifestPath: string,
  ) => Promise<{ success: boolean; downloadedCount?: number; skippedCount?: number; failedCount?: number; failures?: string[]; error?: string }>;
}

const formatBytes = (value: number): string => {
  if (value < 1024) return `${value} B`;
  const kb = value / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
};

const makeTimestamp = (): string => {
  const now = new Date();
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  return `${yyyy}${mm}${dd}-${hh}${min}`;
};

const Mods: React.FC = () => {
  const { installations, selectedInstallationId } = useData();
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(selectedInstallationId);
  const [modsDir, setModsDir] = useState('');
  const [mods, setMods] = useState<ModRecord[]>([]);
  const [smdMods, setSmdMods] = useState<SmdModResource[]>([]);
  const [smdSearch, setSmdSearch] = useState('');
  const [debouncedSmdSearch, setDebouncedSmdSearch] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingSmd, setIsLoadingSmd] = useState(false);
  const [isCheckingUpdates, setIsCheckingUpdates] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updatesByResourceId, setUpdatesByResourceId] = useState<Record<number, SmdInstalledUpdateStatus>>({});

  const launcher = window.launcher as typeof window.launcher & {
    mods?: ModsBridge;
    dialog: {
      openFolder: (defaultPath?: string) => Promise<string | null>;
      openFile: (defaultPath?: string, type?: 'image' | 'java' | 'modpack') => Promise<string | null>;
    };
  };

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

  const selectedInstance = useMemo(
    () => instances.find((instance) => instance.id === selectedInstanceId) ?? null,
    [instances, selectedInstanceId],
  );

  const sortedMods = useMemo(
    () => [...mods].sort((a, b) => a.fileName.localeCompare(b.fileName)),
    [mods],
  );

  const sortedSmdMods = useMemo(
    () => [...smdMods].sort((a, b) => b.downloadCount - a.downloadCount || a.name.localeCompare(b.name)),
    [smdMods],
  );

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedSmdSearch(smdSearch.trim());
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [smdSearch]);

  const loadMods = useCallback(async () => {
    if (!selectedInstance) {
      setMods([]);
      setModsDir('');
      return;
    }
    if (!launcher?.mods?.list) {
      setError('Mod management is only available inside the desktop launcher.');
      setMods([]);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await launcher.mods.list(selectedInstance.path);
      setMods(result.mods);
      setModsDir(result.modsDir);
    } catch (err) {
      setError(`Failed to load mods: ${String(err)}`);
      setMods([]);
      setModsDir('');
    } finally {
      setIsLoading(false);
    }
  }, [launcher, selectedInstance]);

  useEffect(() => {
    void loadMods();
  }, [loadMods]);

  const loadSmdMods = useCallback(async (queryOverride?: string) => {
    if (!launcher?.mods?.listSmdMods) {
      setError('SMD browsing is unavailable in this environment.');
      setSmdMods([]);
      return;
    }

    setIsLoadingSmd(true);

    try {
      const searchQuery = typeof queryOverride === 'string' ? queryOverride.trim() : debouncedSmdSearch;
      const result = await launcher.mods.listSmdMods(searchQuery);
      if (!result.success) {
        setError(result.error ?? 'Failed to load SMD mods.');
        setSmdMods([]);
        return;
      }
      setSmdMods(result.mods);
    } catch (err) {
      setError(String(err));
      setSmdMods([]);
    } finally {
      setIsLoadingSmd(false);
    }
  }, [debouncedSmdSearch, launcher]);

  useEffect(() => {
    void loadSmdMods();
  }, [loadSmdMods]);

  const checkInstalledUpdates = useCallback(async () => {
    if (!launcher?.mods?.checkSmdUpdates) {
      setUpdatesByResourceId({});
      return;
    }

    const installed = mods
      .filter((mod) => typeof mod.resourceId === 'number' && typeof mod.smdVersion === 'string')
      .map((mod) => ({ resourceId: mod.resourceId as number, smdVersion: mod.smdVersion as string }));

    if (installed.length === 0) {
      setUpdatesByResourceId({});
      return;
    }

    setIsCheckingUpdates(true);
    try {
      const result = await launcher.mods.checkSmdUpdates(installed);
      if (!result.success) {
        setUpdatesByResourceId({});
        return;
      }

      const mapped: Record<number, SmdInstalledUpdateStatus> = {};
      for (const item of result.updates) {
        mapped[item.resourceId] = item;
      }
      setUpdatesByResourceId(mapped);
    } finally {
      setIsCheckingUpdates(false);
    }
  }, [launcher, mods]);

  useEffect(() => {
    void checkInstalledUpdates();
  }, [checkInstalledUpdates]);

  const withBusyAction = useCallback(async (fn: () => Promise<void>) => {
    setStatus(null);
    setError(null);
    setIsBusy(true);
    try {
      await fn();
    } catch (err) {
      setError(String(err));
    } finally {
      setIsBusy(false);
    }
  }, []);

  const onInstallOrUpdateSmdMod = useCallback(async (resource: SmdModResource) => {
    if (!selectedInstance || !launcher?.mods?.installOrUpdateFromSmd) return;

    await withBusyAction(async () => {
      const result = await launcher.mods.installOrUpdateFromSmd(selectedInstance.path, resource.resourceId, true);
      if (!result.success) {
        throw new Error(result.error ?? 'SMD download failed.');
      }

      setStatus(`Installed/updated ${resource.name} for ${selectedInstance.name}.`);
      await loadMods();
    });
  }, [launcher, loadMods, selectedInstance, withBusyAction]);

  const onUpdateInstalledMod = useCallback(async (mod: ModRecord) => {
    if (!selectedInstance || !launcher?.mods?.installOrUpdateFromSmd) return;
    if (typeof mod.resourceId !== 'number') return;

    await withBusyAction(async () => {
      const result = await launcher.mods.installOrUpdateFromSmd(selectedInstance.path, mod.resourceId, mod.enabled);
      if (!result.success) {
        throw new Error(result.error ?? `Failed to update ${mod.fileName}.`);
      }

      setStatus(`Updated ${mod.fileName} to the latest SMD version.`);
      await loadMods();
    });
  }, [launcher, loadMods, selectedInstance, withBusyAction]);

  const onDeleteMod = useCallback(async (mod: ModRecord) => {
    if (!selectedInstance || !launcher?.mods?.remove) return;

    const confirmed = window.confirm(`Delete ${mod.fileName}? This cannot be undone.`);
    if (!confirmed) return;

    await withBusyAction(async () => {
      const result = await launcher.mods.remove(selectedInstance.path, mod.relativePath);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to remove mod.');
      }
      setStatus(`Deleted ${mod.fileName}.`);
      await loadMods();
    });
  }, [launcher, loadMods, selectedInstance, withBusyAction]);

  const onExportModpack = useCallback(async () => {
    if (!selectedInstance || !launcher?.mods?.exportModpack || !launcher?.dialog?.openFolder) return;

    const targetDir = await launcher.dialog.openFolder(selectedInstance.path);
    if (!targetDir) return;

    const safePackName = selectedInstance.name.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'modpack';
    const outputPath = `${targetDir}${targetDir.endsWith('\\') ? '' : '\\'}${safePackName}-${makeTimestamp()}.starmade-modpack.json`;

    await withBusyAction(async () => {
      const result = await launcher.mods.exportModpack(selectedInstance.path, outputPath, {
        name: `${selectedInstance.name} Modpack`,
        sourceInstallation: {
          id: selectedInstance.id,
          name: selectedInstance.name,
          version: selectedInstance.version,
        },
      });
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to export modpack.');
      }
      setStatus(`Exported modpack with ${result.exportedCount} linked mod(s). Skipped ${result.skippedCount} without known links.`);
    });
  }, [launcher, selectedInstance, withBusyAction]);

  const onImportModpack = useCallback(async () => {
    if (!selectedInstance || !launcher?.mods?.importModpack || !launcher?.dialog?.openFile) return;

    const importPath = await launcher.dialog.openFile(selectedInstance.path, 'modpack');
    if (!importPath) return;

    await withBusyAction(async () => {
      const result = await launcher.mods.importModpack(selectedInstance.path, importPath);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to import modpack.');
      }
      setStatus(`Imported modpack: ${result.downloadedCount} downloaded, ${result.skippedCount} skipped, ${result.failedCount} failed.`);
      await loadMods();
    });
  }, [launcher, loadMods, selectedInstance, withBusyAction]);

  const openModsFolder = useCallback(async () => {
    if (!modsDir || !window.launcher?.shell?.openPath) return;
    const result = await window.launcher.shell.openPath(modsDir);
    if (!result.success) {
      setError(result.error ?? 'Failed to open mods folder.');
    }
  }, [modsDir]);

  return (
    <PageContainer>
      <div className="h-full flex flex-col gap-4 min-h-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-display text-3xl font-bold uppercase text-white tracking-wider">Mods</h1>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void loadMods()}
              className="px-3 py-2 rounded-md border border-slate-700 bg-slate-900/70 hover:bg-slate-800/80 text-sm"
              disabled={isLoading || isBusy}
            >
              Refresh
            </button>
            <button
              type="button"
              onClick={() => void checkInstalledUpdates()}
              className="px-3 py-2 rounded-md border border-slate-700 bg-slate-900/70 hover:bg-slate-800/80 text-sm"
              disabled={isBusy || isCheckingUpdates}
            >
              {isCheckingUpdates ? 'Checking Updates…' : 'Check Mod Updates'}
            </button>
            <button
              type="button"
              onClick={() => void openModsFolder()}
              className="px-3 py-2 rounded-md border border-slate-700 bg-slate-900/70 hover:bg-slate-800/80 text-sm"
              disabled={!modsDir}
            >
              Open Mods Folder
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(260px,420px)_1fr] gap-4 items-end">
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
            <p className="text-xs uppercase tracking-wider text-gray-400 mb-1">Mods Folder</p>
            <p className="text-sm text-gray-200 break-all">{modsDir || 'n/a'}</p>
          </div>
        </div>

        <div className="rounded-lg border border-white/10 bg-black/30 p-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[280px]">
              <p className="text-xs uppercase tracking-wider text-gray-400 mb-1">Search SMD StarLoader Mods</p>
              <input
                type="text"
                value={smdSearch}
                onChange={(event) => setSmdSearch(event.target.value)}
                placeholder="Search by name, author, or description"
                className="w-full rounded-md border border-slate-700 bg-slate-900/70 px-3 py-2 text-sm"
                disabled={isBusy}
              />
            </div>
            <button
              type="button"
              onClick={() => void loadSmdMods(smdSearch)}
              className="px-3 py-2 rounded-md border border-slate-700 bg-slate-900/70 hover:bg-slate-800/80 text-sm"
              disabled={isBusy || isLoadingSmd}
            >
              {isLoadingSmd ? 'Loading SMD Mods…' : 'Refresh SMD Mods'}
            </button>
          </div>

          <div className="mt-3 max-h-56 overflow-auto rounded border border-white/10">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-900/90">
                <tr className="text-left text-xs uppercase tracking-wider text-gray-400">
                  <th className="px-3 py-2">Mod</th>
                  <th className="px-3 py-2">Author</th>
                  <th className="px-3 py-2">Downloads</th>
                  <th className="px-3 py-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {sortedSmdMods.map((resource) => {
                  const installed = sortedMods.find((mod) => mod.resourceId === resource.resourceId);
                  const updateStatus = updatesByResourceId[resource.resourceId];
                  const hasUpdate = Boolean(updateStatus?.hasUpdate);
                  return (
                    <tr key={resource.resourceId} className="border-b border-white/5 last:border-b-0">
                      <td className="px-3 py-2">
                        <p className="text-gray-100">{resource.name}</p>
                        {resource.tagLine && <p className="text-xs text-gray-400 line-clamp-1">{resource.tagLine}</p>}
                      </td>
                      <td className="px-3 py-2 text-gray-300">{resource.author}</td>
                      <td className="px-3 py-2 text-gray-300">{resource.downloadCount.toLocaleString()}</td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => void onInstallOrUpdateSmdMod(resource)}
                          className="px-2 py-1 rounded bg-emerald-800/80 hover:bg-emerald-700 text-xs"
                          disabled={isBusy || !selectedInstance}
                        >
                          {installed ? (hasUpdate ? 'Update' : 'Reinstall') : 'Download'} Mod
                        </button>
                        {hasUpdate && (
                          <p className="text-[11px] text-amber-300 mt-1">
                            Update: {updateStatus?.currentVersion} to {updateStatus?.latestVersion}
                          </p>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {sortedSmdMods.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-gray-400">
                      {isLoadingSmd ? 'Loading SMD mods…' : 'No SMD mods matched your query.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void onExportModpack()}
            className="px-3 py-1.5 rounded bg-indigo-900/70 hover:bg-indigo-800 text-xs"
            disabled={isBusy || !selectedInstance}
          >
            Export Modpack (Link List)
          </button>
          <button
            type="button"
            onClick={() => void onImportModpack()}
            className="px-3 py-1.5 rounded bg-cyan-900/70 hover:bg-cyan-800 text-xs"
            disabled={isBusy || !selectedInstance}
          >
            Import Modpack
          </button>
          <p className="text-xs text-gray-400">Modpacks contain URLs only and never bundle JAR binaries.</p>
        </div>

        {error && <p className="text-sm text-red-300">{error}</p>}
        {status && <p className="text-sm text-emerald-300">{status}</p>}

        <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-white/10 bg-black/30">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-900/90 backdrop-blur border-b border-white/10">
              <tr className="text-left text-xs uppercase tracking-wider text-gray-400">
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">State</th>
                <th className="px-3 py-2">SMD</th>
                <th className="px-3 py-2">Size</th>
                <th className="px-3 py-2">Modified</th>
                <th className="px-3 py-2">Source Link</th>
                <th className="px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedMods.map((mod) => {
                const updateStatus = typeof mod.resourceId === 'number' ? updatesByResourceId[mod.resourceId] : undefined;
                const hasUpdate = Boolean(updateStatus?.hasUpdate);
                return (
                <tr key={`${mod.relativePath}-${mod.modifiedMs}`} className="border-b border-white/5 last:border-b-0">
                  <td className="px-3 py-2 text-gray-200 break-all">{mod.fileName}</td>
                  <td className="px-3 py-2">Managed In-Game</td>
                  <td className="px-3 py-2 text-gray-300">
                    {mod.resourceId ? `#${mod.resourceId}${mod.smdVersion ? ` (${mod.smdVersion})` : ''}` : 'Manual/Unknown'}
                    {hasUpdate && (
                      <button
                        type="button"
                        onClick={() => void onUpdateInstalledMod(mod)}
                        className="ml-2 inline-block px-2 py-0.5 rounded bg-amber-900/60 hover:bg-amber-800 text-amber-200 text-[10px] align-middle"
                        disabled={isBusy || !selectedInstance}
                        title="Update this mod now"
                      >
                        Update Available
                      </button>
                    )}
                  </td>
                  <td className="px-3 py-2 text-gray-300">{formatBytes(mod.sizeBytes)}</td>
                  <td className="px-3 py-2 text-gray-300">{new Date(mod.modifiedMs).toLocaleString()}</td>
                  <td className="px-3 py-2 text-gray-300">
                    {mod.downloadUrl ? (
                      <button
                        type="button"
                        onClick={() => void window.launcher?.shell?.openExternal(mod.downloadUrl!)}
                        className="underline text-cyan-300 hover:text-cyan-200"
                      >
                        Open
                      </button>
                    ) : (
                      <span className="text-gray-500">Unknown</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void onDeleteMod(mod)}
                        className="px-2 py-1 rounded bg-red-900/70 hover:bg-red-800 text-xs"
                        disabled={isBusy}
                      >
                        Delete
                      </button>
                      {hasUpdate && (
                        <button
                          type="button"
                          onClick={() => void onUpdateInstalledMod(mod)}
                          className="px-2 py-1 rounded bg-amber-900/70 hover:bg-amber-800 text-xs"
                          disabled={isBusy || !selectedInstance}
                        >
                          Update
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
                );
              })}
              {sortedMods.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-gray-400">
                    {isLoading ? 'Loading mods…' : 'No mods found for this installation.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </PageContainer>
  );
};

export default Mods;

