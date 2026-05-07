import fs from 'fs';
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

// ─── Directory Size ──────────────────────────────────────────────────────────

function dirSizeBytes(dirPath: string): number {
  let total = 0;
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        total += dirSizeBytes(full);
      } else {
        try { total += fs.statSync(full).size; } catch { /* skip */ }
      }
    }
  } catch { /* skip */ }
  return total;
}

// ─── Ensure Subdirectories ───────────────────────────────────────────────────

function ensureCatalogDirs(catalogPath: string): void {
  fs.mkdirSync(path.join(catalogPath, BLUEPRINTS_DIR), { recursive: true });
  fs.mkdirSync(path.join(catalogPath, EXPORTED_DIR), { recursive: true });
  fs.mkdirSync(path.join(catalogPath, TEMPLATES_DIR), { recursive: true });
}

// ─── List ────────────────────────────────────────────────────────────────────

function scanBlueprints(rootPath: string): BlueprintMeta[] {
  const bpDir = path.join(rootPath, BLUEPRINTS_DIR);
  if (!fs.existsSync(bpDir)) return [];

  const results: BlueprintMeta[] = [];
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(bpDir, { withFileTypes: true }); } catch { return []; }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    // skip the exported/ and DATA/ subdirectories
    if (entry.name === 'exported' || entry.name === 'DATA') continue;

    const bpPath = path.join(bpDir, entry.name);
    const headerPath = path.join(bpPath, HEADER_FILE);

    let modifiedMs = 0;
    try { modifiedMs = fs.statSync(headerPath).mtimeMs; } catch {
      try { modifiedMs = fs.statSync(bpPath).mtimeMs; } catch { /* skip */ }
    }

    // Count ATTACHED_* child directories
    let dockedCount = 0;
    try {
      const children = fs.readdirSync(bpPath, { withFileTypes: true });
      for (const child of children) {
        if (child.isDirectory() && child.name.startsWith('ATTACHED_')) {
          dockedCount++;
        }
      }
    } catch { /* skip */ }

    const header = fs.existsSync(headerPath)
      ? parseBlueprintHeader(headerPath)
      : { type: 'UNKNOWN' as BlueprintEntityType };

    results.push({
      name: entry.name,
      type: header.type,
      classification: header.classification,
      boundingBox: header.boundingBox,
      elementCount: header.elementCount,
      sizeBytes: dirSizeBytes(bpPath),
      modifiedMs,
      dockedCount,
    });
  }

  results.sort((a, b) => a.name.localeCompare(b.name));
  return results;
}

function scanExported(rootPath: string): ExportedBlueprintMeta[] {
  const expDir = path.join(rootPath, EXPORTED_DIR);
  if (!fs.existsSync(expDir)) return [];

  const results: ExportedBlueprintMeta[] = [];
  try {
    const files = fs.readdirSync(expDir);
    for (const file of files) {
      if (!file.endsWith('.sment')) continue;
      try {
        const stat = fs.statSync(path.join(expDir, file));
        results.push({ fileName: file, sizeBytes: stat.size, modifiedMs: stat.mtimeMs });
      } catch { /* skip */ }
    }
  } catch { /* skip */ }

  results.sort((a, b) => a.fileName.localeCompare(b.fileName));
  return results;
}

function scanTemplates(rootPath: string): TemplateMeta[] {
  const tplDir = path.join(rootPath, TEMPLATES_DIR);
  if (!fs.existsSync(tplDir)) return [];

  const results: TemplateMeta[] = [];
  try {
    const files = fs.readdirSync(tplDir);
    for (const file of files) {
      if (!file.endsWith('.smtpl')) continue;
      try {
        const stat = fs.statSync(path.join(tplDir, file));
        results.push({ fileName: file, sizeBytes: stat.size, modifiedMs: stat.mtimeMs });
      } catch { /* skip */ }
    }
  } catch { /* skip */ }

  results.sort((a, b) => a.fileName.localeCompare(b.fileName));
  return results;
}

/** List all items in the central catalog directory. */
export function listCatalog(catalogPath: string): CatalogListing {
  ensureCatalogDirs(catalogPath);
  return {
    catalogPath,
    blueprints: scanBlueprints(catalogPath),
    exported: scanExported(catalogPath),
    templates: scanTemplates(catalogPath),
  };
}

/** List blueprints/templates in a specific installation directory. */
export function listInstallationBlueprints(installPath: string): CatalogListing {
  return {
    catalogPath: installPath,
    blueprints: scanBlueprints(installPath),
    exported: scanExported(installPath),
    templates: scanTemplates(installPath),
  };
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
  ensureCatalogDirs(catalogPath);
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

  return { success: errors.length === 0, copiedCount, skippedCount, errors: errors.length ? errors : undefined };
}

// ─── Delete ──────────────────────────────────────────────────────────────────

export function deleteCatalogItem(
  catalogPath: string,
  item: CatalogItemRef,
): { success: boolean; error?: string } {
  try {
    const itemPath = resolveItemSingle(catalogPath, item);
    if (!fs.existsSync(itemPath)) return { success: true }; // already gone
    if (item.kind === 'blueprint') {
      fs.rmSync(itemPath, { recursive: true, force: true });
    } else {
      fs.unlinkSync(itemPath);
    }
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
  ensureCatalogDirs(catalogPath);
  const errors: string[] = [];
  let copiedCount = 0;

  const baseName = path.basename(smentFilePath, '.sment');
  const bpDest = path.join(catalogPath, BLUEPRINTS_DIR, baseName);
  const expDest = path.join(catalogPath, EXPORTED_DIR, path.basename(smentFilePath));

  // Extract the .sment (ZIP) into blueprints/<name>/
  try {
    fs.mkdirSync(bpDest, { recursive: true });
    const zip = new AdmZip(smentFilePath);
    zip.extractAllTo(bpDest, true);
    copiedCount++;
  } catch (err) {
    errors.push(`Failed to extract ${smentFilePath}: ${String(err)}`);
  }

  // Copy the .sment archive to exported/
  try {
    fs.copyFileSync(smentFilePath, expDest);
    copiedCount++;
  } catch (err) {
    errors.push(`Failed to copy .sment to exported/: ${String(err)}`);
  }

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
