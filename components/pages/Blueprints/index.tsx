import React, { useCallback, useEffect, useMemo, useState } from 'react';
import PageContainer from '../../common/PageContainer';
import CustomDropdown from '../../common/CustomDropdown';
import { useData } from '../../../contexts/DataContext';
import { FolderIcon, TrashIcon, DownloadIcon, ArchiveIcon } from '../../common/icons';
import type { ManagedItem } from '../../../types';

// ─── Types mirroring the preload API return shapes ──────────────────────────

interface BlueprintMeta {
  name: string;
  type: string;
  classification?: string;
  boundingBox?: { min: [number, number, number]; max: [number, number, number] };
  elementCount?: number;
  sizeBytes: number;
  modifiedMs: number;
  dockedCount: number;
}

interface ExportedMeta {
  fileName: string;
  sizeBytes: number;
  modifiedMs: number;
}

interface TemplateMeta {
  fileName: string;
  sizeBytes: number;
  modifiedMs: number;
}

interface CatalogListing {
  catalogPath: string;
  blueprints: BlueprintMeta[];
  exported: ExportedMeta[];
  templates: TemplateMeta[];
  error?: string;
}

type CatalogItemRef =
  | { kind: 'blueprint'; name: string }
  | { kind: 'exported'; fileName: string }
  | { kind: 'template'; fileName: string };

// ─── Helpers ────────────────────────────────────────────────────────────────

const formatBytes = (value: number): string => {
  if (value < 1024) return `${value} B`;
  const kb = value / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
};

const TYPE_COLORS: Record<string, string> = {
  SHIP: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  SPACE_STATION: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
  SHOP: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
  ASTEROID: 'bg-gray-500/20 text-gray-300 border-gray-500/30',
  MANAGED_ASTEROID: 'bg-gray-500/20 text-gray-300 border-gray-500/30',
  PLANET: 'bg-green-500/20 text-green-300 border-green-500/30',
  UNKNOWN: 'bg-slate-500/20 text-slate-300 border-slate-500/30',
};

const typeLabel = (t: string) => t.replace(/_/g, ' ');

// ─── Component ──────────────────────────────────────────────────────────────

const Blueprints: React.FC = () => {
  const { installations, selectedInstallationId } = useData();

  // ── State ─────────────────────────────────────────────────────────────────
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(selectedInstallationId);
  const [catalogData, setCatalogData] = useState<CatalogListing | null>(null);
  const [installData, setInstallData] = useState<CatalogListing | null>(null);
  const [isLoadingCatalog, setIsLoadingCatalog] = useState(false);
  const [isLoadingInstall, setIsLoadingInstall] = useState(false);
  const [catalogSelection, setCatalogSelection] = useState<Set<string>>(new Set());
  const [installSelection, setInstallSelection] = useState<Set<string>>(new Set());
  const [overwrite, setOverwrite] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const launcher = window.launcher;

  // ── Instances ─────────────────────────────────────────────────────────────
  const instances = useMemo(() => {
    const deduped = new Map<string, ManagedItem>();
    installations
      .filter((item) => item.path?.trim().length > 0)
      .forEach((item) => deduped.set(item.id, item));
    return Array.from(deduped.values());
  }, [installations]);

  useEffect(() => {
    if (selectedInstanceId && instances.some((i) => i.id === selectedInstanceId)) return;
    setSelectedInstanceId(instances[0]?.id ?? null);
  }, [instances, selectedInstanceId]);

  const selectedInstance = useMemo(
    () => instances.find((i) => i.id === selectedInstanceId) ?? null,
    [instances, selectedInstanceId],
  );

  // ── Data loading ──────────────────────────────────────────────────────────

  const loadCatalog = useCallback(async () => {
    if (!launcher?.catalog?.list) return;
    setIsLoadingCatalog(true);
    try {
      const data = await launcher.catalog.list();
      setCatalogData(data);
      if (data.error) setError(data.error);
    } catch (err) {
      setError(`Failed to load catalog: ${String(err)}`);
    } finally {
      setIsLoadingCatalog(false);
    }
  }, [launcher]);

  const loadInstall = useCallback(async () => {
    if (!launcher?.catalog?.listInstallation || !selectedInstance?.path) {
      setInstallData(null);
      return;
    }
    setIsLoadingInstall(true);
    try {
      const data = await launcher.catalog.listInstallation(selectedInstance.path);
      setInstallData(data);
    } catch (err) {
      setError(`Failed to load installation blueprints: ${String(err)}`);
    } finally {
      setIsLoadingInstall(false);
    }
  }, [launcher, selectedInstance]);

  useEffect(() => { void loadCatalog(); }, [loadCatalog]);
  useEffect(() => { void loadInstall(); }, [loadInstall]);

  // ── Selection helpers ─────────────────────────────────────────────────────

  const toggleCatalogItem = (key: string) => {
    setCatalogSelection((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const toggleInstallItem = (key: string) => {
    setInstallSelection((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const catalogItemRefFromKey = (key: string): CatalogItemRef => {
    if (key.startsWith('bp:')) return { kind: 'blueprint', name: key.slice(3) };
    if (key.startsWith('exp:')) return { kind: 'exported', fileName: key.slice(4) };
    return { kind: 'template', fileName: key.slice(4) };
  };

  // ── Actions ───────────────────────────────────────────────────────────────

  const handleDeploy = async () => {
    if (!selectedInstance || catalogSelection.size === 0) return;
    setIsBusy(true);
    setStatus(null);
    setError(null);
    try {
      const items = Array.from(catalogSelection).map(catalogItemRefFromKey);
      const result = await launcher.catalog.deploy(items, [selectedInstance.path], overwrite);
      if (result.success) {
        setStatus(`Deployed ${result.copiedCount ?? 0} item(s)${result.skippedCount ? `, skipped ${result.skippedCount}` : ''}`);
      } else {
        setError(result.errors?.join('; ') ?? 'Deploy failed');
      }
      setCatalogSelection(new Set());
      void loadInstall();
    } catch (err) {
      setError(String(err));
    } finally {
      setIsBusy(false);
    }
  };

  const handleImport = async () => {
    if (!selectedInstance || installSelection.size === 0) return;
    setIsBusy(true);
    setStatus(null);
    setError(null);
    try {
      const items = Array.from(installSelection).map(catalogItemRefFromKey);
      const result = await launcher.catalog.import(selectedInstance.path, items, overwrite);
      if (result.success) {
        setStatus(`Imported ${result.copiedCount ?? 0} item(s)${result.skippedCount ? `, skipped ${result.skippedCount}` : ''}`);
      } else {
        setError(result.errors?.join('; ') ?? 'Import failed');
      }
      setInstallSelection(new Set());
      void loadCatalog();
    } catch (err) {
      setError(String(err));
    } finally {
      setIsBusy(false);
    }
  };

  const handleDeleteSelected = async () => {
    if (catalogSelection.size === 0) return;
    setIsBusy(true);
    setStatus(null);
    setError(null);
    let deleted = 0;
    const errs: string[] = [];
    for (const key of catalogSelection) {
      const item = catalogItemRefFromKey(key);
      try {
        const r = await launcher.catalog.delete(item);
        if (r.success) deleted++;
        else if (r.error) errs.push(r.error);
      } catch (err) {
        errs.push(String(err));
      }
    }
    if (errs.length) setError(errs.join('; '));
    else setStatus(`Deleted ${deleted} item(s) from catalog`);
    setCatalogSelection(new Set());
    void loadCatalog();
    setIsBusy(false);
  };

  const handleImportSment = async () => {
    const selected = await launcher.dialog.openFile(undefined, undefined as unknown as 'image');
    if (!selected || !selected.endsWith('.sment')) {
      if (selected) setError('Please select a .sment file');
      return;
    }
    setIsBusy(true);
    setStatus(null);
    setError(null);
    try {
      const result = await launcher.catalog.importSment(selected);
      if (result.success) {
        setStatus(`Imported .sment file (${result.copiedCount ?? 0} item(s))`);
      } else {
        setError(result.errors?.join('; ') ?? 'Import failed');
      }
      void loadCatalog();
    } catch (err) {
      setError(String(err));
    } finally {
      setIsBusy(false);
    }
  };

  const handleSetupCatalog = async () => {
    const selected = await launcher.dialog.openFolder();
    if (selected) {
      await launcher.store.set('catalogPath', selected);
      void loadCatalog();
    }
  };

  // ── No catalog path configured ────────────────────────────────────────────

  const noCatalog = !catalogData?.catalogPath;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <PageContainer closeTarget="Play" resizable>
      <div className="flex flex-col h-full min-h-0">
        {/* ── Header ───────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between mb-4 flex-shrink-0">
          <h1 className="font-display text-3xl font-bold uppercase text-white tracking-wider">Catalog</h1>
          <div className="flex items-center gap-3">
            {/* Installation selector */}
            {instances.length > 0 && (
              <CustomDropdown
                options={instances.map((i) => ({ value: i.id, label: i.name || i.id }))}
                value={selectedInstanceId ?? ''}
                onChange={(id) => { setSelectedInstanceId(id); setInstallSelection(new Set()); }}
                className="w-60"
              />
            )}
          </div>
        </div>

        {/* ── Status / error bar ───────────────────────────────────────────── */}
        {(status || error) && (
          <div className={`mb-3 px-4 py-2 rounded-lg text-sm flex-shrink-0 ${error ? 'bg-red-500/20 border border-red-500/30 text-red-300' : 'bg-green-500/20 border border-green-500/30 text-green-300'}`}>
            {error ?? status}
            <button onClick={() => { setStatus(null); setError(null); }} className="ml-2 opacity-60 hover:opacity-100">&times;</button>
          </div>
        )}

        {/* ── No catalog setup ─────────────────────────────────────────────── */}
        {noCatalog && (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center space-y-4">
              <p className="text-gray-400 text-lg">No blueprint catalog directory configured.</p>
              <p className="text-gray-500 text-sm">Choose a directory to store your centralized blueprint and template collection.</p>
              <button
                onClick={handleSetupCatalog}
                className="px-6 py-3 rounded-lg bg-starmade-accent hover:bg-starmade-accent/80 transition-colors font-semibold uppercase tracking-wider"
              >
                Choose Catalog Folder
              </button>
            </div>
          </div>
        )}

        {/* ── Main two-panel layout ────────────────────────────────────────── */}
        {!noCatalog && (
          <div className="flex-1 flex gap-4 min-h-0">
            {/* ── Left: Catalog ──────────────────────────────────────────── */}
            <div className="flex-1 flex flex-col min-h-0 min-w-0">
              <div className="flex items-center justify-between mb-2">
                <h2 className="font-display text-sm font-bold uppercase tracking-wider text-starmade-text-accent">Catalog</h2>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleImportSment}
                    disabled={isBusy}
                    className="p-1.5 rounded-md hover:bg-white/10 transition-colors text-gray-400 hover:text-white disabled:opacity-40"
                    title="Import .sment file"
                  >
                    <ArchiveIcon className="w-4 h-4" />
                  </button>
                  {catalogData?.catalogPath && (
                    <button
                      onClick={() => launcher.shell.openPath(catalogData.catalogPath)}
                      className="p-1.5 rounded-md hover:bg-white/10 transition-colors text-gray-400 hover:text-white"
                      title="Open catalog folder"
                    >
                      <FolderIcon className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    onClick={handleDeleteSelected}
                    disabled={isBusy || catalogSelection.size === 0}
                    className="p-1.5 rounded-md hover:bg-red-500/20 transition-colors text-gray-400 hover:text-red-400 disabled:opacity-40"
                    title="Delete selected from catalog"
                  >
                    <TrashIcon className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => void loadCatalog()}
                    disabled={isLoadingCatalog}
                    className="px-2 py-1 text-xs rounded bg-white/5 hover:bg-white/10 transition-colors text-gray-400"
                  >
                    {isLoadingCatalog ? 'Loading...' : 'Refresh'}
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto space-y-1 pr-1">
                {isLoadingCatalog && <p className="text-gray-500 text-sm p-4 text-center">Loading catalog...</p>}
                {!isLoadingCatalog && catalogData && catalogData.blueprints.length === 0 && catalogData.exported.length === 0 && catalogData.templates.length === 0 && (
                  <p className="text-gray-500 text-sm p-4 text-center">Catalog is empty. Import blueprints from an installation or a .sment file.</p>
                )}
                {/* Blueprints */}
                {catalogData?.blueprints.map((bp) => {
                  const key = `bp:${bp.name}`;
                  return (
                    <BlueprintRow
                      key={key}
                      name={bp.name}
                      type={bp.type}
                      classification={bp.classification}
                      elementCount={bp.elementCount}
                      sizeBytes={bp.sizeBytes}
                      dockedCount={bp.dockedCount}
                      selected={catalogSelection.has(key)}
                      onToggle={() => toggleCatalogItem(key)}
                    />
                  );
                })}
                {/* Exported */}
                {catalogData && catalogData.exported.length > 0 && (
                  <div className="pt-2">
                    <p className="text-xs text-gray-500 uppercase tracking-wider mb-1 px-2">Exported (.sment)</p>
                    {catalogData.exported.map((exp) => {
                      const key = `exp:${exp.fileName}`;
                      return (
                        <FileRow
                          key={key}
                          fileName={exp.fileName}
                          sizeBytes={exp.sizeBytes}
                          selected={catalogSelection.has(key)}
                          onToggle={() => toggleCatalogItem(key)}
                        />
                      );
                    })}
                  </div>
                )}
                {/* Templates */}
                {catalogData && catalogData.templates.length > 0 && (
                  <div className="pt-2">
                    <p className="text-xs text-gray-500 uppercase tracking-wider mb-1 px-2">Templates (.smtpl)</p>
                    {catalogData.templates.map((tpl) => {
                      const key = `tpl:${tpl.fileName}`;
                      return (
                        <FileRow
                          key={key}
                          fileName={tpl.fileName}
                          sizeBytes={tpl.sizeBytes}
                          selected={catalogSelection.has(key)}
                          onToggle={() => toggleCatalogItem(key)}
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* ── Center: Action buttons ─────────────────────────────────── */}
            <div className="flex flex-col items-center justify-center gap-3 flex-shrink-0 px-1">
              <button
                onClick={handleDeploy}
                disabled={isBusy || catalogSelection.size === 0 || !selectedInstance}
                className="px-3 py-2 rounded-lg bg-starmade-accent/80 hover:bg-starmade-accent disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-sm font-semibold uppercase tracking-wider whitespace-nowrap"
                title="Deploy selected catalog items to installation"
              >
                Deploy &rarr;
              </button>
              <button
                onClick={handleImport}
                disabled={isBusy || installSelection.size === 0 || !selectedInstance}
                className="px-3 py-2 rounded-lg bg-starmade-accent/80 hover:bg-starmade-accent disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-sm font-semibold uppercase tracking-wider whitespace-nowrap"
                title="Import selected installation items to catalog"
              >
                &larr; Import
              </button>
              <label className="flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer mt-2">
                <input
                  type="checkbox"
                  checked={overwrite}
                  onChange={(e) => setOverwrite(e.target.checked)}
                  className="rounded border-gray-600 bg-gray-800 text-starmade-accent focus:ring-starmade-accent/50"
                />
                Overwrite
              </label>
            </div>

            {/* ── Right: Installation ────────────────────────────────────── */}
            <div className="flex-1 flex flex-col min-h-0 min-w-0">
              <div className="flex items-center justify-between mb-2">
                <h2 className="font-display text-sm font-bold uppercase tracking-wider text-starmade-text-accent">
                  Installation{selectedInstance ? `: ${selectedInstance.name}` : ''}
                </h2>
                <button
                  onClick={() => void loadInstall()}
                  disabled={isLoadingInstall}
                  className="px-2 py-1 text-xs rounded bg-white/5 hover:bg-white/10 transition-colors text-gray-400"
                >
                  {isLoadingInstall ? 'Loading...' : 'Refresh'}
                </button>
              </div>
              <div className="flex-1 overflow-y-auto space-y-1 pr-1">
                {!selectedInstance && <p className="text-gray-500 text-sm p-4 text-center">No installation selected.</p>}
                {selectedInstance && isLoadingInstall && <p className="text-gray-500 text-sm p-4 text-center">Loading...</p>}
                {selectedInstance && !isLoadingInstall && installData && installData.blueprints.length === 0 && installData.exported.length === 0 && installData.templates.length === 0 && (
                  <p className="text-gray-500 text-sm p-4 text-center">No blueprints or templates in this installation.</p>
                )}
                {/* Blueprints */}
                {installData?.blueprints.map((bp) => {
                  const key = `bp:${bp.name}`;
                  return (
                    <BlueprintRow
                      key={key}
                      name={bp.name}
                      type={bp.type}
                      classification={bp.classification}
                      elementCount={bp.elementCount}
                      sizeBytes={bp.sizeBytes}
                      dockedCount={bp.dockedCount}
                      selected={installSelection.has(key)}
                      onToggle={() => toggleInstallItem(key)}
                    />
                  );
                })}
                {/* Exported */}
                {installData && installData.exported.length > 0 && (
                  <div className="pt-2">
                    <p className="text-xs text-gray-500 uppercase tracking-wider mb-1 px-2">Exported (.sment)</p>
                    {installData.exported.map((exp) => {
                      const key = `exp:${exp.fileName}`;
                      return (
                        <FileRow
                          key={key}
                          fileName={exp.fileName}
                          sizeBytes={exp.sizeBytes}
                          selected={installSelection.has(key)}
                          onToggle={() => toggleInstallItem(key)}
                        />
                      );
                    })}
                  </div>
                )}
                {/* Templates */}
                {installData && installData.templates.length > 0 && (
                  <div className="pt-2">
                    <p className="text-xs text-gray-500 uppercase tracking-wider mb-1 px-2">Templates (.smtpl)</p>
                    {installData.templates.map((tpl) => {
                      const key = `tpl:${tpl.fileName}`;
                      return (
                        <FileRow
                          key={key}
                          fileName={tpl.fileName}
                          sizeBytes={tpl.sizeBytes}
                          selected={installSelection.has(key)}
                          onToggle={() => toggleInstallItem(key)}
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </PageContainer>
  );
};

// ─── Row sub-components ─────────────────────────────────────────────────────

const BlueprintRow: React.FC<{
  name: string;
  type: string;
  classification?: string;
  elementCount?: number;
  sizeBytes: number;
  dockedCount: number;
  selected: boolean;
  onToggle: () => void;
}> = ({ name, type, classification, elementCount, sizeBytes, dockedCount, selected, onToggle }) => {
  const colors = TYPE_COLORS[type] ?? TYPE_COLORS.UNKNOWN;
  return (
    <button
      onClick={onToggle}
      className={`w-full text-left px-3 py-2 rounded-lg border transition-colors flex items-center gap-3 ${
        selected
          ? 'bg-starmade-accent/15 border-starmade-accent/40'
          : 'bg-black/20 border-white/5 hover:bg-white/5'
      }`}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        onClick={(e) => e.stopPropagation()}
        className="rounded border-gray-600 bg-gray-800 text-starmade-accent focus:ring-starmade-accent/50 flex-shrink-0"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-white truncate">{name}</span>
          <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${colors}`}>
            {typeLabel(type)}
          </span>
          {classification && (
            <span className="text-[10px] uppercase tracking-wider text-gray-400">{classification.replace(/_/g, ' ')}</span>
          )}
        </div>
        <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-500">
          <span>{formatBytes(sizeBytes)}</span>
          {elementCount != null && <span>{elementCount.toLocaleString()} blocks</span>}
          {dockedCount > 0 && <span>{dockedCount} docked</span>}
        </div>
      </div>
    </button>
  );
};

const FileRow: React.FC<{
  fileName: string;
  sizeBytes: number;
  selected: boolean;
  onToggle: () => void;
}> = ({ fileName, sizeBytes, selected, onToggle }) => (
  <button
    onClick={onToggle}
    className={`w-full text-left px-3 py-1.5 rounded-lg border transition-colors flex items-center gap-3 ${
      selected
        ? 'bg-starmade-accent/15 border-starmade-accent/40'
        : 'bg-black/20 border-white/5 hover:bg-white/5'
    }`}
  >
    <input
      type="checkbox"
      checked={selected}
      onChange={onToggle}
      onClick={(e) => e.stopPropagation()}
      className="rounded border-gray-600 bg-gray-800 text-starmade-accent focus:ring-starmade-accent/50 flex-shrink-0"
    />
    <span className="text-sm text-gray-300 truncate flex-1">{fileName}</span>
    <span className="text-xs text-gray-500 flex-shrink-0">{formatBytes(sizeBytes)}</span>
  </button>
);

export default Blueprints;
