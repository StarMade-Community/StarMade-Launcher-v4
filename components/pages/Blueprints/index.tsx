import React, { useCallback, useEffect, useMemo, useState } from 'react';
import PageContainer from '../../common/PageContainer';
import CustomDropdown from '../../common/CustomDropdown';
import { useData } from '../../../contexts/DataContext';
import { FolderIcon, TrashIcon, ArchiveIcon, CheckIcon } from '../../common/icons';
import type { ManagedItem } from '../../../types';

// ─── Types ──────────────────────────────────────────────────────────────────

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

interface ExportedMeta { fileName: string; sizeBytes: number; modifiedMs: number; }

interface CatalogListing {
  catalogPath: string;
  blueprints: BlueprintMeta[];
  exported: ExportedMeta[];
  templates: Array<{ fileName: string; sizeBytes: number; modifiedMs: number }>;
  error?: string;
}

type CatalogItemRef =
  | { kind: 'blueprint'; name: string }
  | { kind: 'exported'; fileName: string }
  | { kind: 'template'; fileName: string };

// ─── Helpers ────────────────────────────────────────────────────────────────

const TYPE_COLORS: Record<string, string> = {
  SHIP: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  SPACE_STATION: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
  /*SHOP: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
  ASTEROID: 'bg-gray-500/20 text-gray-300 border-gray-500/30',
  MANAGED_ASTEROID: 'bg-gray-500/20 text-gray-300 border-gray-500/30',
  PLANET: 'bg-green-500/20 text-green-300 border-green-500/30',*/ //users cant actaully save these in game anyways
  UNKNOWN: 'bg-slate-500/20 text-slate-300 border-slate-500/30',
};

const ALL_TYPES = ['SHIP', 'SPACE_STATION', /*'SHOP', 'ASTEROID', 'MANAGED_ASTEROID', 'PLANET',*/ 'UNKNOWN'];
const typeLabel = (t: string) => t.replace(/_/g, ' ');

const STORE_KEY = 'blueprintsCatalogPath';

// ─── Component ──────────────────────────────────────────────────────────────

const Blueprints: React.FC = () => {
  const { installations, selectedInstallationId } = useData();

  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(selectedInstallationId);
  const [catalogPath, setCatalogPath] = useState<string>('');
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
  // Search & filters
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');

  const launcher = window.launcher;

  // Load catalog path from store
  useEffect(() => {
    launcher.store.get(STORE_KEY).then((val) => {
      if (typeof val === 'string') setCatalogPath(val);
    }).catch(() => {});
  }, []);

  // ── Instances ─────────────────────────────────────────────────────────────
  const instances = useMemo(() => {
    const deduped = new Map<string, ManagedItem>();
    installations.filter((item) => item.path?.trim().length > 0).forEach((item) => deduped.set(item.id, item));
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

  // ── Data loading (uses backend cache; Refresh buttons pass invalidate=true) ─
  const loadCatalog = useCallback(async (invalidate = false) => {
    if (!catalogPath) return;
    setIsLoadingCatalog(true);
    try {
      const data = await launcher.catalog.list(catalogPath, invalidate);
      setCatalogData(data);
      if (data.error) setError(data.error);
    } catch (err) {
      setError(`Failed to load catalog: ${String(err)}`);
    } finally {
      setIsLoadingCatalog(false);
    }
  }, [launcher, catalogPath]);

  const loadInstall = useCallback(async (invalidate = false) => {
    if (!selectedInstance?.path) { setInstallData(null); return; }
    setIsLoadingInstall(true);
    try {
      const data = await launcher.catalog.listInstallation(selectedInstance.path, invalidate);
      setInstallData(data);
    } catch (err) {
      setError(`Failed to load installation blueprints: ${String(err)}`);
    } finally {
      setIsLoadingInstall(false);
    }
  }, [launcher, selectedInstance]);

  useEffect(() => { void loadCatalog(); }, [loadCatalog]);
  useEffect(() => { void loadInstall(); }, [loadInstall]);

  // ── Filtering ─────────────────────────────────────────────────────────────
  const filterBlueprints = (list: BlueprintMeta[]) => {
    let filtered = list;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter((bp) => bp.name.toLowerCase().includes(q));
    }
    if (typeFilter !== 'ALL') {
      filtered = filtered.filter((bp) => bp.type === typeFilter);
    }
    return filtered;
  };

  const filterExported = (list: ExportedMeta[]) => {
    if (!searchQuery) return list;
    const q = searchQuery.toLowerCase();
    return list.filter((e) => e.fileName.toLowerCase().includes(q));
  };

  const catalogBlueprints = useMemo(() => filterBlueprints(catalogData?.blueprints ?? []), [catalogData, searchQuery, typeFilter]);
  const catalogExported = useMemo(() => filterExported(catalogData?.exported ?? []), [catalogData, searchQuery]);
  const installBlueprints = useMemo(() => filterBlueprints(installData?.blueprints ?? []), [installData, searchQuery, typeFilter]);
  const installExported = useMemo(() => filterExported(installData?.exported ?? []), [installData, searchQuery]);

  // ── Select all helpers ────────────────────────────────────────────────────
  const allCatalogKeys = useMemo(() => {
    const keys: string[] = [];
    for (const bp of catalogBlueprints) keys.push(`bp:${bp.name}`);
    for (const exp of catalogExported) keys.push(`exp:${exp.fileName}`);
    return keys;
  }, [catalogBlueprints, catalogExported]);

  const allInstallKeys = useMemo(() => {
    const keys: string[] = [];
    for (const bp of installBlueprints) keys.push(`bp:${bp.name}`);
    for (const exp of installExported) keys.push(`exp:${exp.fileName}`);
    return keys;
  }, [installBlueprints, installExported]);

  const toggleCatalogItem = (key: string) => {
    setCatalogSelection((prev) => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  };
  const toggleInstallItem = (key: string) => {
    setInstallSelection((prev) => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  };
  const selectAllCatalog = () => setCatalogSelection(new Set(allCatalogKeys));
  const deselectAllCatalog = () => setCatalogSelection(new Set());
  const selectAllInstall = () => setInstallSelection(new Set(allInstallKeys));
  const deselectAllInstall = () => setInstallSelection(new Set());

  const catalogItemRefFromKey = (key: string): CatalogItemRef => {
    if (key.startsWith('bp:')) return { kind: 'blueprint', name: key.slice(3) };
    if (key.startsWith('exp:')) return { kind: 'exported', fileName: key.slice(4) };
    return { kind: 'template', fileName: key.slice(4) };
  };

  // ── Drag & drop ───────────────────────────────────────────────────────────
  const [dragOverPanel, setDragOverPanel] = useState<'catalog' | 'install' | null>(null);

  const handleDragStart = (e: React.DragEvent, key: string, source: 'catalog' | 'install') => {
    const selection = source === 'catalog' ? catalogSelection : installSelection;
    // If dragged item is selected, drag all selected; otherwise just this one
    const keys = selection.has(key) ? Array.from(selection) : [key];
    e.dataTransfer.setData('application/x-catalog-keys', JSON.stringify(keys));
    e.dataTransfer.setData('application/x-catalog-source', source);
    e.dataTransfer.effectAllowed = 'copy';
  };

  const handleDragOver = (e: React.DragEvent, panel: 'catalog' | 'install') => {
    const source = e.dataTransfer.types.includes('application/x-catalog-source') ? 'ok' : null;
    if (!source) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDragOverPanel(panel);
  };

  const handleDragLeave = () => setDragOverPanel(null);

  const handleDrop = async (e: React.DragEvent, targetPanel: 'catalog' | 'install') => {
    e.preventDefault();
    setDragOverPanel(null);
    const source = e.dataTransfer.getData('application/x-catalog-source');
    if (source === targetPanel) return; // same panel, no-op
    const keys: string[] = JSON.parse(e.dataTransfer.getData('application/x-catalog-keys') || '[]');
    if (keys.length === 0) return;

    const items = keys.map(catalogItemRefFromKey);
    setIsBusy(true); setStatus(null); setError(null);
    try {
      if (targetPanel === 'install') {
        // Catalog → Installation (deploy)
        if (!selectedInstance || !catalogPath) return;
        const result = await launcher.catalog.deploy(catalogPath, items, [selectedInstance.path], overwrite);
        if (result.success) setStatus(`Deployed ${result.copiedCount ?? 0} item(s)${result.skippedCount ? `, skipped ${result.skippedCount}` : ''}`);
        else setError(result.errors?.join('; ') ?? 'Deploy failed');
        setCatalogSelection(new Set());
        void loadInstall();
      } else {
        // Installation → Catalog (import)
        if (!selectedInstance || !catalogPath) return;
        const result = await launcher.catalog.import(catalogPath, selectedInstance.path, items, overwrite);
        if (result.success) setStatus(`Imported ${result.copiedCount ?? 0} item(s)${result.skippedCount ? `, skipped ${result.skippedCount}` : ''}`);
        else setError(result.errors?.join('; ') ?? 'Import failed');
        setInstallSelection(new Set());
        void loadCatalog();
      }
    } catch (err) { setError(String(err)); } finally { setIsBusy(false); }
  };

  // ── Actions ───────────────────────────────────────────────────────────────
  const handleDeploy = async () => {
    if (!selectedInstance || catalogSelection.size === 0 || !catalogPath) return;
    setIsBusy(true); setStatus(null); setError(null);
    try {
      const items = Array.from(catalogSelection).map(catalogItemRefFromKey);
      const result = await launcher.catalog.deploy(catalogPath, items, [selectedInstance.path], overwrite);
      if (result.success) setStatus(`Deployed ${result.copiedCount ?? 0} item(s)${result.skippedCount ? `, skipped ${result.skippedCount}` : ''}`);
      else setError(result.errors?.join('; ') ?? 'Deploy failed');
      setCatalogSelection(new Set());
      void loadInstall();
    } catch (err) { setError(String(err)); } finally { setIsBusy(false); }
  };

  const handleImport = async () => {
    if (!selectedInstance || installSelection.size === 0 || !catalogPath) return;
    setIsBusy(true); setStatus(null); setError(null);
    try {
      const items = Array.from(installSelection).map(catalogItemRefFromKey);
      const result = await launcher.catalog.import(catalogPath, selectedInstance.path, items, overwrite);
      if (result.success) setStatus(`Imported ${result.copiedCount ?? 0} item(s)${result.skippedCount ? `, skipped ${result.skippedCount}` : ''}`);
      else setError(result.errors?.join('; ') ?? 'Import failed');
      setInstallSelection(new Set());
      void loadCatalog();
    } catch (err) { setError(String(err)); } finally { setIsBusy(false); }
  };

  const handleDeleteSelected = async () => {
    if (catalogSelection.size === 0 || !catalogPath) return;
    setIsBusy(true); setStatus(null); setError(null);
    let deleted = 0;
    const errs: string[] = [];
    for (const key of catalogSelection) {
      try {
        const r = await launcher.catalog.delete(catalogPath, catalogItemRefFromKey(key));
        if (r.success) deleted++; else if (r.error) errs.push(r.error);
      } catch (err) { errs.push(String(err)); }
    }
    if (errs.length) setError(errs.join('; ')); else setStatus(`Deleted ${deleted} item(s) from catalog`);
    setCatalogSelection(new Set());
    void loadCatalog();
    setIsBusy(false);
  };

  const handleImportSment = async () => {
    if (!catalogPath) return;
    const selected = await launcher.dialog.openFile(undefined, undefined as unknown as 'image');
    if (!selected || !selected.endsWith('.sment')) { if (selected) setError('Please select a .sment file'); return; }
    setIsBusy(true); setStatus(null); setError(null);
    try {
      const result = await launcher.catalog.importSment(catalogPath, selected);
      if (result.success) setStatus(`Imported .sment file (${result.copiedCount ?? 0} item(s))`);
      else setError(result.errors?.join('; ') ?? 'Import failed');
      void loadCatalog();
    } catch (err) { setError(String(err)); } finally { setIsBusy(false); }
  };

  const handleSetupCatalog = async () => {
    const selected = await launcher.dialog.openFolder();
    if (selected) {
      setCatalogPath(selected);
      await launcher.store.set(STORE_KEY, selected);
    }
  };

  const noCatalog = !catalogPath;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <PageContainer closeTarget="Play" resizable>
      <div className="flex flex-col h-full min-h-0">
        {/* Header */}
        <div className="flex items-center justify-between mb-3 flex-shrink-0">
          <h1 className="font-display text-3xl font-bold uppercase text-white tracking-wider">Blueprints</h1>
          <div className="flex items-center gap-3">
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

        {/* Search + filter bar */}
        {!noCatalog && (
          <div className="flex items-center gap-3 mb-3 flex-shrink-0">
            <input
              type="text"
              placeholder="Search by name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1 px-3 py-1.5 rounded-lg bg-black/30 border border-white/10 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-starmade-accent/50"
            />
            <CustomDropdown
              options={[{ value: 'ALL', label: 'All Types' }, ...ALL_TYPES.map((t) => ({ value: t, label: typeLabel(t) }))]}
              value={typeFilter}
              onChange={setTypeFilter}
              className="w-44"
            />
          </div>
        )}

        {/* Status / error */}
        {(status || error) && (
          <div className={`mb-3 px-4 py-2 rounded-lg text-sm flex-shrink-0 ${error ? 'bg-red-500/20 border border-red-500/30 text-red-300' : 'bg-green-500/20 border border-green-500/30 text-green-300'}`}>
            {error ?? status}
            <button onClick={() => { setStatus(null); setError(null); }} className="ml-2 opacity-60 hover:opacity-100">&times;</button>
          </div>
        )}

        {/* No catalog setup */}
        {noCatalog && (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center space-y-4">
              <p className="text-gray-400 text-lg">No blueprints catalog directory configured.</p>
              <p className="text-gray-500 text-sm">Choose a directory to store your centralized blueprint collection.</p>
              <button onClick={handleSetupCatalog} className="px-6 py-3 rounded-lg bg-starmade-accent hover:bg-starmade-accent/80 transition-colors font-semibold uppercase tracking-wider">
                Choose Blueprints Folder
              </button>
            </div>
          </div>
        )}

        {/* Main two-panel layout */}
        {!noCatalog && (
          <div className="flex-1 flex gap-4 min-h-0">
            {/* Left: Catalog */}
            <div
              className={`flex-1 flex flex-col min-h-0 min-w-0 rounded-lg transition-colors ${dragOverPanel === 'catalog' ? 'ring-2 ring-starmade-accent/60 bg-starmade-accent/5' : ''}`}
              onDragOver={(e) => handleDragOver(e, 'catalog')}
              onDragLeave={handleDragLeave}
              onDrop={(e) => void handleDrop(e, 'catalog')}
            >
              <div className="flex items-center justify-between mb-2">
                <h2 className="font-display text-sm font-bold uppercase tracking-wider text-starmade-text-accent">Catalog</h2>
                <div className="flex items-center gap-1">
                  <button onClick={catalogSelection.size === allCatalogKeys.length ? deselectAllCatalog : selectAllCatalog} className="px-2 py-1 text-xs rounded bg-white/5 hover:bg-white/10 transition-colors text-gray-400" title={catalogSelection.size === allCatalogKeys.length ? 'Deselect all' : 'Select all'}>
                    <CheckIcon className="w-3 h-3 inline mr-1" />{catalogSelection.size === allCatalogKeys.length ? 'None' : 'All'}
                  </button>
                  <button onClick={handleImportSment} disabled={isBusy} className="p-1.5 rounded-md hover:bg-white/10 transition-colors text-gray-400 hover:text-white disabled:opacity-40" title="Import .sment file">
                    <ArchiveIcon className="w-4 h-4" />
                  </button>
                  <button onClick={() => launcher.shell.openPath(catalogPath)} className="p-1.5 rounded-md hover:bg-white/10 transition-colors text-gray-400 hover:text-white" title="Open catalog folder">
                    <FolderIcon className="w-4 h-4" />
                  </button>
                  <button onClick={handleDeleteSelected} disabled={isBusy || catalogSelection.size === 0} className="p-1.5 rounded-md hover:bg-red-500/20 transition-colors text-gray-400 hover:text-red-400 disabled:opacity-40" title="Delete selected">
                    <TrashIcon className="w-4 h-4" />
                  </button>
                  <button onClick={() => void loadCatalog(true)} disabled={isLoadingCatalog} className="px-2 py-1 text-xs rounded bg-white/5 hover:bg-white/10 transition-colors text-gray-400">
                    {isLoadingCatalog ? 'Loading...' : 'Refresh'}
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto space-y-1 pr-1">
                {isLoadingCatalog && <p className="text-gray-500 text-sm p-4 text-center">Loading catalog...</p>}
                {!isLoadingCatalog && catalogBlueprints.length === 0 && catalogExported.length === 0 && (
                  <p className="text-gray-500 text-sm p-4 text-center">{searchQuery || typeFilter !== 'ALL' ? 'No matches.' : 'Catalog is empty. Import blueprints from an installation or a .sment file.'}</p>
                )}
                {catalogBlueprints.map((bp) => { const key = `bp:${bp.name}`; return <BlueprintRow key={key} bp={bp} selected={catalogSelection.has(key)} onToggle={() => toggleCatalogItem(key)} onDragStart={(e) => handleDragStart(e, key, 'catalog')} />; })}
                {catalogExported.length > 0 && (
                  <div className="pt-2">
                    <p className="text-xs text-gray-500 uppercase tracking-wider mb-1 px-2">Exported (.sment)</p>
                    {catalogExported.map((exp) => { const key = `exp:${exp.fileName}`; return <FileRow key={key} fileName={exp.fileName} selected={catalogSelection.has(key)} onToggle={() => toggleCatalogItem(key)} onDragStart={(e) => handleDragStart(e, key, 'catalog')} />; })}
                  </div>
                )}
              </div>
            </div>

            {/* Center: Actions */}
            <div className="flex flex-col items-center justify-center gap-3 flex-shrink-0 px-1">
              <button onClick={handleDeploy} disabled={isBusy || catalogSelection.size === 0 || !selectedInstance} className="px-3 py-2 rounded-lg bg-starmade-accent/80 hover:bg-starmade-accent disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-sm font-semibold uppercase tracking-wider whitespace-nowrap" title="Deploy selected to installation">
                Deploy &rarr;
              </button>
              <button onClick={handleImport} disabled={isBusy || installSelection.size === 0 || !selectedInstance} className="px-3 py-2 rounded-lg bg-starmade-accent/80 hover:bg-starmade-accent disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-sm font-semibold uppercase tracking-wider whitespace-nowrap" title="Import selected to catalog">
                &larr; Import
              </button>
              <label className="flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer mt-2">
                <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} className="rounded border-gray-600 bg-gray-800 text-starmade-accent focus:ring-starmade-accent/50" />
                Overwrite
              </label>
            </div>

            {/* Right: Installation */}
            <div
              className={`flex-1 flex flex-col min-h-0 min-w-0 rounded-lg transition-colors ${dragOverPanel === 'install' ? 'ring-2 ring-starmade-accent/60 bg-starmade-accent/5' : ''}`}
              onDragOver={(e) => handleDragOver(e, 'install')}
              onDragLeave={handleDragLeave}
              onDrop={(e) => void handleDrop(e, 'install')}
            >
              <div className="flex items-center justify-between mb-2">
                <h2 className="font-display text-sm font-bold uppercase tracking-wider text-starmade-text-accent truncate">
                  Installation{selectedInstance ? `: ${selectedInstance.name}` : ''}
                </h2>
                <div className="flex items-center gap-1">
                  <button onClick={installSelection.size === allInstallKeys.length ? deselectAllInstall : selectAllInstall} className="px-2 py-1 text-xs rounded bg-white/5 hover:bg-white/10 transition-colors text-gray-400" title={installSelection.size === allInstallKeys.length ? 'Deselect all' : 'Select all'}>
                    <CheckIcon className="w-3 h-3 inline mr-1" />{installSelection.size === allInstallKeys.length ? 'None' : 'All'}
                  </button>
                  <button onClick={() => void loadInstall(true)} disabled={isLoadingInstall} className="px-2 py-1 text-xs rounded bg-white/5 hover:bg-white/10 transition-colors text-gray-400">
                    {isLoadingInstall ? 'Loading...' : 'Refresh'}
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto space-y-1 pr-1">
                {!selectedInstance && <p className="text-gray-500 text-sm p-4 text-center">No installation selected.</p>}
                {selectedInstance && isLoadingInstall && <p className="text-gray-500 text-sm p-4 text-center">Loading...</p>}
                {selectedInstance && !isLoadingInstall && installBlueprints.length === 0 && installExported.length === 0 && (
                  <p className="text-gray-500 text-sm p-4 text-center">{searchQuery || typeFilter !== 'ALL' ? 'No matches.' : 'No blueprints in this installation.'}</p>
                )}
                {installBlueprints.map((bp) => { const key = `bp:${bp.name}`; return <BlueprintRow key={key} bp={bp} selected={installSelection.has(key)} onToggle={() => toggleInstallItem(key)} onDragStart={(e) => handleDragStart(e, key, 'install')} />; })}
                {installExported.length > 0 && (
                  <div className="pt-2">
                    <p className="text-xs text-gray-500 uppercase tracking-wider mb-1 px-2">Exported (.sment)</p>
                    {installExported.map((exp) => { const key = `exp:${exp.fileName}`; return <FileRow key={key} fileName={exp.fileName} selected={installSelection.has(key)} onToggle={() => toggleInstallItem(key)} onDragStart={(e) => handleDragStart(e, key, 'install')} />; })}
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

const BlueprintRow: React.FC<{ bp: BlueprintMeta; selected: boolean; onToggle: () => void; onDragStart?: (e: React.DragEvent) => void }> = ({ bp, selected, onToggle, onDragStart }) => {
  const colors = TYPE_COLORS[bp.type] ?? TYPE_COLORS.UNKNOWN;
  return (
    <button draggable onDragStart={onDragStart} onClick={onToggle} className={`w-full text-left px-3 py-2 rounded-lg border transition-colors flex items-center gap-3 cursor-grab active:cursor-grabbing ${selected ? 'bg-starmade-accent/15 border-starmade-accent/40' : 'bg-black/20 border-white/5 hover:bg-white/5'}`}>
      <input type="checkbox" checked={selected} onChange={onToggle} onClick={(e) => e.stopPropagation()} className="rounded border-gray-600 bg-gray-800 text-starmade-accent focus:ring-starmade-accent/50 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-white truncate">{bp.name}</span>
          <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${colors}`}>{typeLabel(bp.type)}</span>
          {bp.classification && <span className="text-[10px] uppercase tracking-wider text-gray-400">{bp.classification.replace(/_/g, ' ')}</span>}
        </div>
        <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-500">
          {bp.elementCount != null && <span>{bp.elementCount.toLocaleString()} blocks</span>}
          {bp.dockedCount > 0 && <span>{bp.dockedCount} docked</span>}
        </div>
      </div>
    </button>
  );
};

const FileRow: React.FC<{ fileName: string; selected: boolean; onToggle: () => void; onDragStart?: (e: React.DragEvent) => void }> = ({ fileName, selected, onToggle, onDragStart }) => (
  <button draggable onDragStart={onDragStart} onClick={onToggle} className={`w-full text-left px-3 py-1.5 rounded-lg border transition-colors flex items-center gap-3 cursor-grab active:cursor-grabbing ${selected ? 'bg-starmade-accent/15 border-starmade-accent/40' : 'bg-black/20 border-white/5 hover:bg-white/5'}`}>
    <input type="checkbox" checked={selected} onChange={onToggle} onClick={(e) => e.stopPropagation()} className="rounded border-gray-600 bg-gray-800 text-starmade-accent focus:ring-starmade-accent/50 flex-shrink-0" />
    <span className="text-sm text-gray-300 truncate flex-1">{fileName}</span>
  </button>
);

export default Blueprints;
