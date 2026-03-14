import React, { useCallback, useEffect, useMemo, useState } from 'react';
import PageContainer from '../../common/PageContainer';
import CustomDropdown from '../../common/CustomDropdown';
import { useData } from '../../../contexts/DataContext';
import type { ManagedItem, ModRecord } from '../../../types';

interface ModsListResult {
  modsDir: string;
  disabledModsDir: string;
  mods: ModRecord[];
}

interface ModsBridge {
  list: (installationPath: string) => Promise<ModsListResult>;
  download: (installationPath: string, downloadUrl: string, preferredFileName?: string, enabled?: boolean) => Promise<{ success: boolean; mod?: ModRecord; error?: string }>;
  remove: (installationPath: string, relativePath: string) => Promise<{ success: boolean; error?: string }>;
  setEnabled: (installationPath: string, relativePath: string, enabled: boolean) => Promise<{ success: boolean; relativePath?: string; error?: string }>;
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

const makeSafeFileName = (raw: string): string => {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const sanitized = trimmed.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!sanitized) return '';
  return sanitized.toLowerCase().endsWith('.jar') ? sanitized : `${sanitized}.jar`;
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
  const [disabledModsDir, setDisabledModsDir] = useState('');
  const [mods, setMods] = useState<ModRecord[]>([]);
  const [downloadUrl, setDownloadUrl] = useState('');
  const [downloadFileName, setDownloadFileName] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    () => [...mods].sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.fileName.localeCompare(b.fileName)),
    [mods],
  );

  const loadMods = useCallback(async () => {
    if (!selectedInstance) {
      setMods([]);
      setModsDir('');
      setDisabledModsDir('');
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
      setDisabledModsDir(result.disabledModsDir);
    } catch (err) {
      setError(`Failed to load mods: ${String(err)}`);
      setMods([]);
      setModsDir('');
      setDisabledModsDir('');
    } finally {
      setIsLoading(false);
    }
  }, [launcher, selectedInstance]);

  useEffect(() => {
    void loadMods();
  }, [loadMods]);

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

  const onDownloadMod = useCallback(async () => {
    if (!selectedInstance || !launcher?.mods?.download) return;

    const url = downloadUrl.trim();
    if (!url) {
      setError('Enter a mod download URL first.');
      return;
    }

    await withBusyAction(async () => {
      const preferredFileName = makeSafeFileName(downloadFileName);
      const result = await launcher.mods.download(selectedInstance.path, url, preferredFileName || undefined, true);
      if (!result.success) {
        throw new Error(result.error ?? 'Download failed.');
      }
      setStatus(`Downloaded ${result.mod?.fileName ?? 'mod'} to ${selectedInstance.name}.`);
      setDownloadUrl('');
      setDownloadFileName('');
      await loadMods();
    });
  }, [downloadFileName, downloadUrl, launcher, loadMods, selectedInstance, withBusyAction]);

  const onToggleMod = useCallback(async (mod: ModRecord) => {
    if (!selectedInstance || !launcher?.mods?.setEnabled) return;

    await withBusyAction(async () => {
      const result = await launcher.mods.setEnabled(selectedInstance.path, mod.relativePath, !mod.enabled);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to update mod state.');
      }
      setStatus(`${mod.fileName} ${mod.enabled ? 'disabled' : 'enabled'}.`);
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
              onClick={() => void openModsFolder()}
              className="px-3 py-2 rounded-md border border-slate-700 bg-slate-900/70 hover:bg-slate-800/80 text-sm"
              disabled={!modsDir}
            >
              Open Mods Folder
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(260px,420px)_1fr_1fr] gap-4 items-end">
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
            <p className="text-xs uppercase tracking-wider text-gray-400 mb-1">Enabled Folder</p>
            <p className="text-sm text-gray-200 break-all">{modsDir || 'n/a'}</p>
          </div>

          <div>
            <p className="text-xs uppercase tracking-wider text-gray-400 mb-1">Disabled Folder</p>
            <p className="text-sm text-gray-200 break-all">{disabledModsDir || 'n/a'}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr_auto] gap-3 items-end">
          <div>
            <p className="text-xs uppercase tracking-wider text-gray-400 mb-1">Mod Download URL</p>
            <input
              type="text"
              value={downloadUrl}
              onChange={(event) => setDownloadUrl(event.target.value)}
              placeholder="https://.../my-mod.jar"
              className="w-full rounded-md border border-slate-700 bg-slate-900/70 px-3 py-2 text-sm"
              disabled={isBusy}
            />
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-gray-400 mb-1">File Name (optional)</p>
            <input
              type="text"
              value={downloadFileName}
              onChange={(event) => setDownloadFileName(event.target.value)}
              placeholder="my-mod.jar"
              className="w-full rounded-md border border-slate-700 bg-slate-900/70 px-3 py-2 text-sm"
              disabled={isBusy}
            />
          </div>
          <button
            type="button"
            onClick={() => void onDownloadMod()}
            className="px-4 py-2 rounded-md bg-emerald-800/80 hover:bg-emerald-700 text-sm"
            disabled={isBusy || !selectedInstance}
          >
            Download
          </button>
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
                <th className="px-3 py-2">Size</th>
                <th className="px-3 py-2">Modified</th>
                <th className="px-3 py-2">Source Link</th>
                <th className="px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedMods.map((mod) => (
                <tr key={`${mod.relativePath}-${mod.modifiedMs}`} className="border-b border-white/5 last:border-b-0">
                  <td className="px-3 py-2 text-gray-200 break-all">{mod.fileName}</td>
                  <td className="px-3 py-2">{mod.enabled ? 'Enabled' : 'Disabled'}</td>
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
                        onClick={() => void onToggleMod(mod)}
                        className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs"
                        disabled={isBusy}
                      >
                        {mod.enabled ? 'Disable' : 'Enable'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void onDeleteMod(mod)}
                        className="px-2 py-1 rounded bg-red-900/70 hover:bg-red-800 text-xs"
                        disabled={isBusy}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {sortedMods.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-gray-400">
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

