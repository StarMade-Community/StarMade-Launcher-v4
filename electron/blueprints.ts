import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import AdmZip from 'adm-zip';

// ─── Types (mirroring types/index.ts — electron rootDir prevents cross-import) ─

export type BlueprintEntityType = 'SHIP' | 'SPACE_STATION' | 'SHOP' | 'ASTEROID' | 'PLANET' | 'MANAGED_ASTEROID' | 'UNKNOWN';

export interface BlueprintMeta {
  name: string;
  type: BlueprintEntityType;
  classification?: string;
  boundingBox?: { min: [number, number, number]; max: [number, number, number] };
  elementCount?: number;
  sizeBytes: number;
  modifiedMs: number;
  dockedCount: number;
}

export interface ExportedBlueprintMeta {
  fileName: string;
  sizeBytes: number;
  modifiedMs: number;
}

export interface TemplateMeta {
  fileName: string;
  sizeBytes: number;
  modifiedMs: number;
}

export interface CatalogListing {
  catalogPath: string;
  blueprints: BlueprintMeta[];
  exported: ExportedBlueprintMeta[];
  templates: TemplateMeta[];
}

export type CatalogItemRef =
  | { kind: 'blueprint'; name: string }
  | { kind: 'exported'; fileName: string }
  | { kind: 'template'; fileName: string };

export interface CatalogCopyResult {
  success: boolean;
  copiedCount?: number;
  skippedCount?: number;
  errors?: string[];
}

// ─── Constants ───────────────────────────────────────────────────────────────

const BLUEPRINTS_DIR = 'blueprints';
const EXPORTED_DIR = path.join('blueprints', 'exported');
const TEMPLATES_DIR = 'templates';
const HEADER_FILE = 'header.smbph';

/**
 * BlueprintType enum ordinals from the StarMade source
 * (org.schema.game.server.data.blueprintnw.BlueprintType).
 */
const BLUEPRINT_TYPE_BY_ORDINAL: BlueprintEntityType[] = [
  'SHIP',             // 0
  'SHOP',             // 1
  'SPACE_STATION',    // 2
  'MANAGED_ASTEROID', // 3
  'ASTEROID',         // 4
  'PLANET',           // 5
];

/**
 * BlueprintClassification enum names from the StarMade source
 * (org.schema.game.server.data.blueprintnw.BlueprintClassification).
 */
const CLASSIFICATION_BY_ORDINAL: string[] = [
  'NONE', 'MINING', 'SUPPORT', 'CARGO', 'ATTACK', 'DEFENSE', 'CARRIER',
  'SCOUT', 'SCAVENGER',
  'NONE_STATION', 'SHIPYARD_STATION', 'OUTPOST_STATION', 'DEFENSE_STATION',
  'MINING_STATION', 'FACTORY_STATION', 'TRADE_STATION', 'WAYPOINT_STATION',
  'SHOPPING_STATION',
  'NONE_ASTEROID', 'NONE_ASTEROID_MANAGED', 'NONE_PLANET', 'NONE_SHOP',
  'NONE_ICO', 'ALL_SHIPS',
];

// ─── Header Parsing ──────────────────────────────────────────────────────────

/**
 * Parse a StarMade blueprint header (.smbph) file to extract metadata.
 * This is a best-effort binary parser — returns partial data on failure.
 */
function parseBlueprintHeader(headerPath: string): {
  type: BlueprintEntityType;
  classification?: string;
  boundingBox?: { min: [number, number, number]; max: [number, number, number] };
  elementCount?: number;
} {
  const result: ReturnType<typeof parseBlueprintHeader> = { type: 'UNKNOWN' };
  try {
    const buf = fs.readFileSync(headerPath);
    if (buf.length < 4) return result;

    let offset = 0;

    // int32: header version
    const headerVersion = buf.readInt32BE(offset); offset += 4;

    // version >= 5: UTF string (2-byte length prefix + chars)
    if (headerVersion >= 5) {
      if (offset + 2 > buf.length) return result;
      const strLen = buf.readUInt16BE(offset); offset += 2;
      offset += strLen; // skip the game version string
    }

    // int32: entity type ordinal
    if (offset + 4 > buf.length) return result;
    const typeOrdinal = buf.readInt32BE(offset); offset += 4;
    result.type = BLUEPRINT_TYPE_BY_ORDINAL[typeOrdinal] ?? 'UNKNOWN';

    // version >= 3 (and not version 0): int32 classification ordinal
    if (headerVersion !== 0 && headerVersion >= 3) {
      if (offset + 4 > buf.length) return result;
      const classOrdinal = buf.readInt32BE(offset); offset += 4;
      const classStr = CLASSIFICATION_BY_ORDINAL[classOrdinal];
      if (classStr && classStr !== 'NONE' && classStr !== 'NONE_STATION'
        && classStr !== 'NONE_ASTEROID' && classStr !== 'NONE_ASTEROID_MANAGED'
        && classStr !== 'NONE_PLANET' && classStr !== 'NONE_SHOP'
        && classStr !== 'NONE_ICO' && classStr !== 'ALL_SHIPS') {
        result.classification = classStr;
      }
    }

    // 6 floats: bounding box (minX, minY, minZ, maxX, maxY, maxZ)
    if (offset + 24 > buf.length) return result;
    const minX = buf.readFloatBE(offset); offset += 4;
    const minY = buf.readFloatBE(offset); offset += 4;
    const minZ = buf.readFloatBE(offset); offset += 4;
    const maxX = buf.readFloatBE(offset); offset += 4;
    const maxY = buf.readFloatBE(offset); offset += 4;
    const maxZ = buf.readFloatBE(offset); offset += 4;
    result.boundingBox = {
      min: [minX, minY, minZ],
      max: [maxX, maxY, maxZ],
    };

    // ElementCountMap: int32 entry count, then (short type + int count) per entry
    if (offset + 4 > buf.length) return result;
    const entryCount = buf.readInt32BE(offset); offset += 4;
    let totalElements = 0;
    for (let i = 0; i < entryCount; i++) {
      if (offset + 6 > buf.length) break;
      offset += 2; // skip short (block type id)
      const count = buf.readInt32BE(offset); offset += 4;
      totalElements += count;
    }
    result.elementCount = totalElements;
  } catch {
    // Best-effort: return whatever we managed to parse
  }
  return result;
}

// ─── Ensure Subdirectories ───────────────────────────────────────────────────

async function ensureCatalogDirs(catalogPath: string): Promise<void> {
  await fsp.mkdir(path.join(catalogPath, BLUEPRINTS_DIR), { recursive: true });
  await fsp.mkdir(path.join(catalogPath, EXPORTED_DIR), { recursive: true });
  await fsp.mkdir(path.join(catalogPath, TEMPLATES_DIR), { recursive: true });
}

// ─── Cache ───────────────────────────────────────────────────────────────────
// In-memory cache keyed by directory path. Invalidated after mutations or when
// the caller passes `invalidate: true`.

interface CachedListing { listing: CatalogListing; cachedAt: number; }
const listingCache = new Map<string, CachedListing>();
const CACHE_TTL_MS = 30_000; // 30 seconds

export function invalidateCatalogCache(dirPath?: string): void {
  if (dirPath) { listingCache.delete(dirPath); } else { listingCache.clear(); }
}

// ─── Async scanning ─────────────────────────────────────────────────────────

async function scanBlueprintEntry(bpPath: string, name: string): Promise<BlueprintMeta> {
  const headerPath = path.join(bpPath, HEADER_FILE);

  // Stat header (or directory) for modifiedMs — skip expensive recursive size calc
  let modifiedMs = 0;
  let sizeBytes = 0;
  try {
    const st = await fsp.stat(headerPath);
    modifiedMs = st.mtimeMs;
    sizeBytes = st.size;
  } catch {
    try { modifiedMs = (await fsp.stat(bpPath)).mtimeMs; } catch { /* skip */ }
  }

  // Count ATTACHED_* child directories
  let dockedCount = 0;
  try {
    const children = await fsp.readdir(bpPath, { withFileTypes: true });
    for (const child of children) {
      if (child.isDirectory() && child.name.startsWith('ATTACHED_')) dockedCount++;
    }
  } catch { /* skip */ }

  // Parse header (sync but only reads first ~100 bytes — cheap)
  let header: ReturnType<typeof parseBlueprintHeader> = { type: 'UNKNOWN' };
  try {
    await fsp.access(headerPath);
    header = parseBlueprintHeader(headerPath);
  } catch { /* no header */ }

  return {
    name,
    type: header.type,
    classification: header.classification,
    boundingBox: header.boundingBox,
    elementCount: header.elementCount,
    sizeBytes,
    modifiedMs,
    dockedCount,
  };
}

async function scanBlueprints(rootPath: string): Promise<BlueprintMeta[]> {
  const bpDir = path.join(rootPath, BLUEPRINTS_DIR);
  let entries: fs.Dirent[];
  try { entries = await fsp.readdir(bpDir, { withFileTypes: true }); } catch { return []; }

  const dirs = entries.filter(
    (e) => e.isDirectory() && e.name !== 'exported' && e.name !== 'DATA' && !e.name.startsWith('._'),
  );

  // Parse all blueprints in parallel (I/O bound, not CPU bound)
  const results = await Promise.all(
    dirs.map((d) => scanBlueprintEntry(path.join(bpDir, d.name), d.name)),
  );

  results.sort((a, b) => a.name.localeCompare(b.name));
  return results;
}

async function scanExported(rootPath: string): Promise<ExportedBlueprintMeta[]> {
  const expDir = path.join(rootPath, EXPORTED_DIR);
  let files: string[];
  try { files = await fsp.readdir(expDir); } catch { return []; }

  const results: ExportedBlueprintMeta[] = [];
  await Promise.all(files.filter((f) => f.endsWith('.sment') && !f.startsWith('._')).map(async (file) => {
    try {
      const stat = await fsp.stat(path.join(expDir, file));
      results.push({ fileName: file, sizeBytes: stat.size, modifiedMs: stat.mtimeMs });
    } catch { /* skip */ }
  }));

  results.sort((a, b) => a.fileName.localeCompare(b.fileName));
  return results;
}

async function scanTemplates(rootPath: string): Promise<TemplateMeta[]> {
  const tplDir = path.join(rootPath, TEMPLATES_DIR);
  let files: string[];
  try { files = await fsp.readdir(tplDir); } catch { return []; }

  const results: TemplateMeta[] = [];
  await Promise.all(files.filter((f) => f.endsWith('.smtpl') && !f.startsWith('._')).map(async (file) => {
    try {
      const stat = await fsp.stat(path.join(tplDir, file));
      results.push({ fileName: file, sizeBytes: stat.size, modifiedMs: stat.mtimeMs });
    } catch { /* skip */ }
  }));

  results.sort((a, b) => a.fileName.localeCompare(b.fileName));
  return results;
}

/** List all items in a catalog directory (cached). */
export async function listCatalog(catalogPath: string, invalidate = false): Promise<CatalogListing> {
  if (!invalidate) {
    const cached = listingCache.get(catalogPath);
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) return cached.listing;
  }

  await ensureCatalogDirs(catalogPath);
  const [blueprints, exported, templates] = await Promise.all([
    scanBlueprints(catalogPath),
    scanExported(catalogPath),
    scanTemplates(catalogPath),
  ]);
  const listing: CatalogListing = { catalogPath, blueprints, exported, templates };
  listingCache.set(catalogPath, { listing, cachedAt: Date.now() });
  return listing;
}

/** List blueprints/templates in a specific installation directory (cached). */
export async function listInstallationBlueprints(installPath: string, invalidate = false): Promise<CatalogListing> {
  if (!invalidate) {
    const cached = listingCache.get(installPath);
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) return cached.listing;
  }

  const [blueprints, exported, templates] = await Promise.all([
    scanBlueprints(installPath),
    scanExported(installPath),
    scanTemplates(installPath),
  ]);
  const listing: CatalogListing = { catalogPath: installPath, blueprints, exported, templates };
  listingCache.set(installPath, { listing, cachedAt: Date.now() });
  return listing;
}

// ─── Deploy (Catalog → Installation) ────────────────────────────────────────

export function deployToInstallations(
  catalogPath: string,
  items: CatalogItemRef[],
  targetPaths: string[],
  overwrite: boolean,
): CatalogCopyResult {
  let copiedCount = 0;
  let skippedCount = 0;
  const errors: string[] = [];

  for (const target of targetPaths) {
    for (const item of items) {
      try {
        const { src, dst } = resolveItemPaths(catalogPath, target, item);
        if (fs.existsSync(dst) && !overwrite) {
          skippedCount++;
          continue;
        }
        if (item.kind === 'blueprint') {
          fs.mkdirSync(path.dirname(dst), { recursive: true });
          fs.cpSync(src, dst, { recursive: true, force: true });
        } else {
          fs.mkdirSync(path.dirname(dst), { recursive: true });
          fs.copyFileSync(src, dst);
        }
        copiedCount++;
      } catch (err) {
        errors.push(`Failed to deploy ${itemLabel(item)} to ${target}: ${String(err)}`);
      }
    }
    invalidateCatalogCache(target);
  }

  return { success: errors.length === 0, copiedCount, skippedCount, errors: errors.length ? errors : undefined };
}

// ─── Import (Installation → Catalog) ────────────────────────────────────────

export function importToCatalog(
  installPath: string,
  items: CatalogItemRef[],
  catalogPath: string,
  overwrite: boolean,
): CatalogCopyResult {
  fs.mkdirSync(path.join(catalogPath, BLUEPRINTS_DIR), { recursive: true });
  fs.mkdirSync(path.join(catalogPath, EXPORTED_DIR), { recursive: true });
  fs.mkdirSync(path.join(catalogPath, TEMPLATES_DIR), { recursive: true });
  let copiedCount = 0;
  let skippedCount = 0;
  const errors: string[] = [];

  for (const item of items) {
    try {
      const { src, dst } = resolveItemPaths(installPath, catalogPath, item);
      if (fs.existsSync(dst) && !overwrite) {
        skippedCount++;
        continue;
      }
      if (item.kind === 'blueprint') {
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.cpSync(src, dst, { recursive: true, force: true });
      } else {
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.copyFileSync(src, dst);
      }
      copiedCount++;
    } catch (err) {
      errors.push(`Failed to import ${itemLabel(item)}: ${String(err)}`);
    }
  }

  invalidateCatalogCache(catalogPath);
  return { success: errors.length === 0, copiedCount, skippedCount, errors: errors.length ? errors : undefined };
}

// ─── Delete ──────────────────────────────────────────────────────────────────

export function deleteCatalogItem(
  catalogPath: string,
  item: CatalogItemRef,
): { success: boolean; error?: string } {
  try {
    const itemPath = resolveItemSingle(catalogPath, item);
    if (!fs.existsSync(itemPath)) return { success: true };
    if (item.kind === 'blueprint') {
      fs.rmSync(itemPath, { recursive: true, force: true });
    } else {
      fs.unlinkSync(itemPath);
    }
    invalidateCatalogCache(catalogPath);
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ─── Import .sment ───────────────────────────────────────────────────────────

export function importSmentToCatalog(
  catalogPath: string,
  smentFilePath: string,
): CatalogCopyResult {
  fs.mkdirSync(path.join(catalogPath, BLUEPRINTS_DIR), { recursive: true });
  fs.mkdirSync(path.join(catalogPath, EXPORTED_DIR), { recursive: true });
  const errors: string[] = [];
  let copiedCount = 0;

  const baseName = path.basename(smentFilePath, '.sment');
  const bpDest = path.join(catalogPath, BLUEPRINTS_DIR, baseName);
  const expDest = path.join(catalogPath, EXPORTED_DIR, path.basename(smentFilePath));

  try {
    fs.mkdirSync(bpDest, { recursive: true });
    const zip = new AdmZip(smentFilePath);
    zip.extractAllTo(bpDest, true);
    copiedCount++;
  } catch (err) {
    errors.push(`Failed to extract ${smentFilePath}: ${String(err)}`);
  }

  try {
    fs.copyFileSync(smentFilePath, expDest);
    copiedCount++;
  } catch (err) {
    errors.push(`Failed to copy .sment to exported/: ${String(err)}`);
  }

  invalidateCatalogCache(catalogPath);
  return { success: errors.length === 0, copiedCount, errors: errors.length ? errors : undefined };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function resolveItemPaths(
  srcRoot: string,
  dstRoot: string,
  item: CatalogItemRef,
): { src: string; dst: string } {
  switch (item.kind) {
    case 'blueprint':
      return {
        src: path.join(srcRoot, BLUEPRINTS_DIR, item.name),
        dst: path.join(dstRoot, BLUEPRINTS_DIR, item.name),
      };
    case 'exported':
      return {
        src: path.join(srcRoot, EXPORTED_DIR, item.fileName),
        dst: path.join(dstRoot, EXPORTED_DIR, item.fileName),
      };
    case 'template':
      return {
        src: path.join(srcRoot, TEMPLATES_DIR, item.fileName),
        dst: path.join(dstRoot, TEMPLATES_DIR, item.fileName),
      };
  }
}

function resolveItemSingle(root: string, item: CatalogItemRef): string {
  switch (item.kind) {
    case 'blueprint': return path.join(root, BLUEPRINTS_DIR, item.name);
    case 'exported': return path.join(root, EXPORTED_DIR, item.fileName);
    case 'template': return path.join(root, TEMPLATES_DIR, item.fileName);
  }
}

function itemLabel(item: CatalogItemRef): string {
  return item.kind === 'blueprint' ? item.name : ('fileName' in item ? item.fileName : '');
}

// ─── Sync Diff ───────────────────────────────────────────────────────────────

export interface SyncDiffItem {
  ref: CatalogItemRef;
  label: string;
  status: 'new' | 'modified' | 'up-to-date';
  catalogModifiedMs: number;
  installModifiedMs: number;
}

export interface SyncDiff {
  items: SyncDiffItem[];
  newCount: number;
  modifiedCount: number;
  upToDateCount: number;
}

/**
 * Compare a catalog directory against an installation directory and return
 * which items are new, modified (catalog is newer), or already up-to-date.
 */
export async function computeSyncDiff(
  catalogPath: string,
  installPath: string,
  kinds: Array<'blueprint' | 'exported' | 'template'>,
): Promise<SyncDiff> {
  const items: SyncDiffItem[] = [];

  if (kinds.includes('blueprint')) {
    const [catBlueprints, instBlueprints] = await Promise.all([
      scanBlueprints(catalogPath), scanBlueprints(installPath),
    ]);
    const instMap = new Map(instBlueprints.map((b) => [b.name, b]));
    for (const bp of catBlueprints) {
      const inst = instMap.get(bp.name);
      const ref: CatalogItemRef = { kind: 'blueprint', name: bp.name };
      if (!inst) {
        items.push({ ref, label: bp.name, status: 'new', catalogModifiedMs: bp.modifiedMs, installModifiedMs: 0 });
      } else if (bp.modifiedMs > inst.modifiedMs) {
        items.push({ ref, label: bp.name, status: 'modified', catalogModifiedMs: bp.modifiedMs, installModifiedMs: inst.modifiedMs });
      } else {
        items.push({ ref, label: bp.name, status: 'up-to-date', catalogModifiedMs: bp.modifiedMs, installModifiedMs: inst.modifiedMs });
      }
    }
  }

  if (kinds.includes('exported')) {
    const [catExp, instExp] = await Promise.all([
      scanExported(catalogPath), scanExported(installPath),
    ]);
    const instMap = new Map(instExp.map((e) => [e.fileName, e]));
    for (const exp of catExp) {
      const inst = instMap.get(exp.fileName);
      const ref: CatalogItemRef = { kind: 'exported', fileName: exp.fileName };
      if (!inst) {
        items.push({ ref, label: exp.fileName, status: 'new', catalogModifiedMs: exp.modifiedMs, installModifiedMs: 0 });
      } else if (exp.modifiedMs > inst.modifiedMs) {
        items.push({ ref, label: exp.fileName, status: 'modified', catalogModifiedMs: exp.modifiedMs, installModifiedMs: inst.modifiedMs });
      } else {
        items.push({ ref, label: exp.fileName, status: 'up-to-date', catalogModifiedMs: exp.modifiedMs, installModifiedMs: inst.modifiedMs });
      }
    }
  }

  if (kinds.includes('template')) {
    const [catTpl, instTpl] = await Promise.all([
      scanTemplates(catalogPath), scanTemplates(installPath),
    ]);
    const instMap = new Map(instTpl.map((t) => [t.fileName, t]));
    for (const tpl of catTpl) {
      const inst = instMap.get(tpl.fileName);
      const ref: CatalogItemRef = { kind: 'template', fileName: tpl.fileName };
      if (!inst) {
        items.push({ ref, label: tpl.fileName, status: 'new', catalogModifiedMs: tpl.modifiedMs, installModifiedMs: 0 });
      } else if (tpl.modifiedMs > inst.modifiedMs) {
        items.push({ ref, label: tpl.fileName, status: 'modified', catalogModifiedMs: tpl.modifiedMs, installModifiedMs: inst.modifiedMs });
      } else {
        items.push({ ref, label: tpl.fileName, status: 'up-to-date', catalogModifiedMs: tpl.modifiedMs, installModifiedMs: inst.modifiedMs });
      }
    }
  }

  return {
    items,
    newCount: items.filter((i) => i.status === 'new').length,
    modifiedCount: items.filter((i) => i.status === 'modified').length,
    upToDateCount: items.filter((i) => i.status === 'up-to-date').length,
  };
}
