import fs from 'fs';
import path from 'path';
import { gunzipSync } from 'zlib';
import { getManagedPathCandidates } from './install-paths.js';

export interface ModRecord {
  fileName: string;
  absolutePath: string;
  relativePath: string;
  sizeBytes: number;
  modifiedMs: number;
  enabled: boolean;
  downloadUrl?: string;
  resourceId?: number;
  smdVersion?: string;
}

export interface SmdModResource {
  resourceId: number;
  name: string;
  author: string;
  tagLine?: string;
  gameVersion?: string;
  downloadCount: number;
  ratingAverage: number;
  latestVersion?: string;
}

export interface SmdInstalledUpdateStatus {
  resourceId: number;
  currentVersion: string;
  latestVersion?: string;
  hasUpdate: boolean;
  error?: string;
}

export interface ModsListResult {
  modsDir: string;
  mods: ModRecord[];
}

export interface ModpackEntry {
  name: string;
  fileName?: string;
  downloadUrl: string;
  enabled?: boolean;
}

export interface ModpackManifest {
  format: 'starmade-modpack';
  version: 1;
  name: string;
  createdAt: string;
  sourceInstallation?: {
    id?: string;
    name?: string;
    version?: string;
  };
  entries: ModpackEntry[];
}

export interface ModMetadataRecord {
  downloadUrl: string;
  addedAt: string;
  source: 'smd' | 'modpack-import';
  resourceId?: number;
  smdVersion?: string;
}

interface ModMetadataStoreData {
  byInstallation: Record<string, Record<string, ModMetadataRecord>>;
}

export interface ModMetadataStore {
  get: () => unknown;
  set: (value: unknown) => void;
}

const MODS_DIR_NAME = 'mods';
const LEGACY_MODS_DISABLED_DIR_NAME = 'mods-disabled';
const SMD_API_BASE = 'https://starmadedock.net/api';
const SMD_CACHED_API_BASE = 'https://starmadedock.net/cached-api';
const SMD_MOD_CATEGORY_ID = 6;
const SMD_API_KEY_ENV_NAMES = ['SMD_API_KEY', 'SMD_XF_API_KEY', 'XENFORO_API_KEY'] as const;

const DEFAULT_METADATA: ModMetadataStoreData = {
  byInstallation: {},
};

let smdCache: { fetchedAtMs: number; resources: SmdModResource[] } | null = null;
const SMD_CACHE_TTL_MS = 5 * 60 * 1000;

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

function coerceMetadata(raw: unknown): ModMetadataStoreData {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...DEFAULT_METADATA };
  const byInstallationRaw = (raw as { byInstallation?: unknown }).byInstallation;
  if (!byInstallationRaw || typeof byInstallationRaw !== 'object' || Array.isArray(byInstallationRaw)) {
    return { ...DEFAULT_METADATA };
  }

  const byInstallation: Record<string, Record<string, ModMetadataRecord>> = {};
  for (const [installationKey, modsRaw] of Object.entries(byInstallationRaw as Record<string, unknown>)) {
    if (!modsRaw || typeof modsRaw !== 'object' || Array.isArray(modsRaw)) continue;

    const modsForInstallation: Record<string, ModMetadataRecord> = {};
    for (const [fileName, recordRaw] of Object.entries(modsRaw as Record<string, unknown>)) {
      if (!recordRaw || typeof recordRaw !== 'object' || Array.isArray(recordRaw)) continue;
      const recordObj = recordRaw as {
        downloadUrl?: unknown;
        addedAt?: unknown;
        source?: unknown;
        resourceId?: unknown;
        smdVersion?: unknown;
      };
      if (typeof recordObj.downloadUrl !== 'string' || !isHttpUrl(recordObj.downloadUrl)) continue;
      modsForInstallation[fileName] = {
        downloadUrl: recordObj.downloadUrl,
        addedAt: typeof recordObj.addedAt === 'string' ? recordObj.addedAt : new Date().toISOString(),
        source: recordObj.source === 'modpack-import' ? 'modpack-import' : 'smd',
        resourceId: typeof recordObj.resourceId === 'number' ? recordObj.resourceId : undefined,
        smdVersion: typeof recordObj.smdVersion === 'string' ? recordObj.smdVersion : undefined,
      };
    }

    byInstallation[installationKey] = modsForInstallation;
  }

  return { byInstallation };
}

function getInstallationKey(installationRoot: string): string {
  return path.normalize(installationRoot);
}

function readMetadata(store: ModMetadataStore): ModMetadataStoreData {
  return coerceMetadata(store.get());
}

function writeMetadata(store: ModMetadataStore, data: ModMetadataStoreData): void {
  store.set(data);
}

function getInstallationRoot(installationPath: string, launcherDir: string): string {
  if (typeof installationPath !== 'string' || installationPath.trim().length === 0) {
    throw new Error('Installation path is required.');
  }

  const candidates = getManagedPathCandidates(installationPath, launcherDir);
  const existing = candidates.find((candidate) => fs.existsSync(candidate));
  if (!existing) throw new Error('Installation path does not exist.');
  return existing;
}

function assertWithin(parentDir: string, childPath: string): void {
  const resolvedParent = path.resolve(parentDir);
  const resolvedChild = path.resolve(childPath);
  if (!resolvedChild.startsWith(`${resolvedParent}${path.sep}`)) {
    throw new Error('Path escapes installation scope.');
  }
}

export function sanitizeModFileName(fileNameRaw: string, fallbackBaseName = 'mod-download'): string {
  const withoutPath = fileNameRaw.replace(/[\\/]/g, ' ').trim();
  const base = withoutPath.length > 0 ? withoutPath : fallbackBaseName;
  const sanitized = base.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '');
  return sanitized.toLowerCase().endsWith('.jar') ? sanitized : `${sanitized || fallbackBaseName}.jar`;
}

function getUniqueFilePath(targetDir: string, preferredFileName: string): string {
  const ext = path.extname(preferredFileName) || '.jar';
  const base = path.basename(preferredFileName, ext);

  let index = 0;
  while (true) {
    const fileName = index === 0 ? `${base}${ext}` : `${base}-${index}${ext}`;
    const fullPath = path.join(targetDir, fileName);
    if (!fs.existsSync(fullPath)) return fullPath;
    index += 1;
  }
}

function migrateLegacyDisabledModsToMods(modsDir: string, legacyDisabledDir: string): void {
  if (!fs.existsSync(legacyDisabledDir)) return;
  const stats = fs.statSync(legacyDisabledDir);
  if (!stats.isDirectory()) return;

  for (const fileName of fs.readdirSync(legacyDisabledDir)) {
    const sourcePath = path.join(legacyDisabledDir, fileName);
    if (!fs.statSync(sourcePath).isFile()) continue;
    if (path.extname(fileName).toLowerCase() !== '.jar') continue;

    const targetPath = getUniqueFilePath(modsDir, fileName);
    fs.renameSync(sourcePath, targetPath);
  }
}

function parseContentDispositionFileName(headerValue: string | null): string | null {
  if (!headerValue) return null;

  const utf8Match = headerValue.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return utf8Match[1];
    }
  }

  const plainMatch = headerValue.match(/filename="?([^";]+)"?/i);
  return plainMatch?.[1] ?? null;
}

function inferDownloadFileName(downloadUrl: string, contentDisposition: string | null, preferredFileName?: string): string {
  const fromPreferred = preferredFileName?.trim();
  if (fromPreferred) return sanitizeModFileName(fromPreferred);

  const fromHeader = parseContentDispositionFileName(contentDisposition);
  if (fromHeader?.trim()) return sanitizeModFileName(fromHeader);

  try {
    const parsed = new URL(downloadUrl);
    const fromPath = path.basename(parsed.pathname);
    if (fromPath.trim().length > 0) return sanitizeModFileName(fromPath);
  } catch {
    // URL validation is handled separately.
  }

  return sanitizeModFileName('mod-download.jar');
}

async function smdFetchJson(apiPath: string): Promise<unknown> {
  const normalizedPath = apiPath.startsWith('/') ? apiPath : `/${apiPath}`;
  const apiKey = getSmdApiKey();
  const response = await fetch(`${SMD_API_BASE}${normalizedPath}`, {
    headers: {
      'Content-type': 'application/x-www-form-urlencoded',
      'XF-Api-Key': apiKey,
      'User-Agent': 'StarMade-Launcher',
    },
  });

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    const suffix = bodyText.trim().length > 0
      ? `: ${bodyText.trim().slice(0, 240)}`
      : '';
    throw new Error(`SMD API request failed (${response.status}) for ${normalizedPath}${suffix}`);
  }

  return response.json();
}

function getSmdApiKey(): string {
  // Each process.env.X reference below is replaced with a literal string by
  // build-electron.mjs when the corresponding variable is set at build time
  // (e.g. in GitHub Actions via secrets.SMD_API_KEY).  At runtime the fallback
  // chain still works for local development via dotenv / .env file.
  const candidates = [
    process.env.SMD_API_KEY,
    process.env.SMD_XF_API_KEY,
    process.env.XENFORO_API_KEY,
  ];

  for (const value of candidates) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }

  throw new Error(
    `SMD API key is not configured. Set one of: ${SMD_API_KEY_ENV_NAMES.join(', ')}`,
  );
}

function getOptionalSmdApiKey(): string | null {
  for (const value of [process.env.SMD_API_KEY, process.env.SMD_XF_API_KEY, process.env.XENFORO_API_KEY]) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function isSmdHost(urlValue: string): boolean {
  try {
    const host = new URL(urlValue).hostname.toLowerCase();
    return host === 'starmadedock.net' || host.endsWith('.starmadedock.net');
  } catch {
    return false;
  }
}

function getDownloadRequestHeaders(downloadUrl: string): Record<string, string> | undefined {
  if (!isSmdHost(downloadUrl)) return undefined;

  const apiKey = getOptionalSmdApiKey();
  if (!apiKey) return undefined;

  return {
    'XF-Api-Key': apiKey,
    'User-Agent': 'StarMade-Launcher',
  };
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function getStringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

function getNumberField(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === 'number' ? value : undefined;
}

function getPaginationPageCount(root: Record<string, unknown> | null): number {
  const pagination = asObject(root?.pagination);
  const lastPage = pagination ? getNumberField(pagination, 'last_page') : undefined;
  return typeof lastPage === 'number' && Number.isFinite(lastPage) && lastPage > 1 ? lastPage : 1;
}

function appendPageQuery(apiPath: string, page: number): string {
  const separator = apiPath.includes('?') ? '&' : '?';
  return `${apiPath}${separator}page=${page}`;
}

async function smdFetchPaginatedResources(apiPath: string): Promise<unknown[]> {
  const firstRaw = await smdFetchJson(apiPath);
  const firstRoot = asObject(firstRaw);
  const firstPageResources = Array.isArray(firstRoot?.resources) ? firstRoot.resources : [];
  const lastPage = getPaginationPageCount(firstRoot);

  if (lastPage <= 1) return firstPageResources;

  const resources = [...firstPageResources];
  for (let page = 2; page <= lastPage; page += 1) {
    const pageRaw = await smdFetchJson(appendPageQuery(apiPath, page));
    const pageRoot = asObject(pageRaw);
    if (!Array.isArray(pageRoot?.resources)) continue;
    resources.push(...pageRoot.resources);
  }

  return resources;
}

async function smdFetchCachedCategoryResources(categoryId: number): Promise<unknown[]> {
  const response = await fetch(`${SMD_CACHED_API_BASE}/resource-categories/${categoryId}.json.gz`, {
    headers: {
      'User-Agent': 'StarMade-Launcher',
    },
  });

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    const suffix = bodyText.trim().length > 0
      ? `: ${bodyText.trim().slice(0, 240)}`
      : '';
    throw new Error(`SMD cached category request failed (${response.status}) for ${categoryId}${suffix}`);
  }

  const gzipped = Buffer.from(await response.arrayBuffer());
  const rawJson = gunzipSync(gzipped).toString('utf8');
  const root = asObject(JSON.parse(rawJson));
  return Array.isArray(root?.resources) ? root.resources : [];
}

function isResourceInModsCategory(resource: Record<string, unknown>): boolean {
  const categoryId = getNumberField(resource, 'category_id')
    ?? getNumberField(resource, 'resource_category_id');
  if (categoryId === SMD_MOD_CATEGORY_ID) return true;

  const category = asObject(resource.Category) ?? asObject(resource.category);
  const parentCategoryId = category ? getNumberField(category, 'parent_category_id') : undefined;
  return parentCategoryId === SMD_MOD_CATEGORY_ID;
}

function mapSmdResource(resourceRaw: unknown): SmdModResource | null {
  const resource = asObject(resourceRaw);
  if (!resource) return null;

  const resourceId = getNumberField(resource, 'resource_id');
  const name = getStringField(resource, 'title');
  const author = getStringField(resource, 'username') ?? 'Unknown';
  if (!resourceId || !name) return null;

  const customFields = asObject(resource.custom_fields);
  const gameVersion = customFields ? getStringField(customFields, 'Gameversion') : undefined;

  return {
    resourceId,
    name,
    author,
    tagLine: getStringField(resource, 'tag_line'),
    gameVersion,
    downloadCount: getNumberField(resource, 'download_count') ?? 0,
    ratingAverage: getNumberField(resource, 'rating_avg') ?? 0,
    latestVersion: undefined,
  };
}


async function fetchSmdCategoryResources(): Promise<SmdModResource[]> {
  let listRaw: unknown[] = [];
  let usingFallback = false;
  try {
    listRaw = await smdFetchPaginatedResources(`/resource-categories/${SMD_MOD_CATEGORY_ID}/resources`);
  } catch (error) {
    const message = toErrorMessage(error);
    // Some XenForo keys can read /resources but are denied from category-scoped routes.
    if (!message.includes('(403)')) throw error;

    try {
      listRaw = await smdFetchCachedCategoryResources(SMD_MOD_CATEGORY_ID);
    } catch {
      listRaw = await smdFetchPaginatedResources('/resources');
      usingFallback = true;
    }
  }

  const entriesById = new Map<number, SmdModResource>();
  for (const resourceRaw of listRaw) {
    const resource = asObject(resourceRaw);
    if (!resource) continue;

    // Only filter by category when using the fallback /resources endpoint which
    // returns all categories.  The primary /resource-categories/{id}/resources
    // endpoint already scopes to the right category, so we include everything it returns.
    if (usingFallback && !isResourceInModsCategory(resource)) continue;

    const entry = mapSmdResource(resource);
    if (!entry) continue;
    entriesById.set(entry.resourceId, entry);
  }

  const entries = [...entriesById.values()];
  entries.sort((a, b) => b.downloadCount - a.downloadCount || a.name.localeCompare(b.name));
  return entries;
}

/** Clears the in-memory SMD mod cache.  Intended for use in tests only. */
export function clearSmdCache(): void {
  smdCache = null;
}

export async function listSmdMods(searchQuery?: string): Promise<SmdModResource[]> {
  const now = Date.now();
  if (!smdCache || (now - smdCache.fetchedAtMs) > SMD_CACHE_TTL_MS) {
    smdCache = {
      fetchedAtMs: now,
      resources: await fetchSmdCategoryResources(),
    };
  }

  const all = smdCache.resources;
  const query = (searchQuery ?? '').trim().toLowerCase();
  if (!query) return all;

  return all.filter((item) => (
    item.name.toLowerCase().includes(query)
    || item.author.toLowerCase().includes(query)
    || (item.tagLine ?? '').toLowerCase().includes(query)
  ));
}

async function fetchLatestSmdDownload(resourceId: number): Promise<{ version: string; downloadUrl: string }> {
  const raw = await smdFetchJson(`/resources/${resourceId}/versions`);
  const root = asObject(raw);
  const versionsRaw = root?.versions;
  if (!Array.isArray(versionsRaw) || versionsRaw.length === 0) {
    throw new Error(`SMD resource ${resourceId} has no version entries.`);
  }

  const latest = asObject(versionsRaw[0]);
  const version = latest ? getStringField(latest, 'version_string') : undefined;
  const files = latest?.files;
  const firstFile = Array.isArray(files) && files.length > 0 ? asObject(files[0]) : null;
  const downloadUrl = firstFile ? getStringField(firstFile, 'download_url') : undefined;

  if (!version || !downloadUrl || !isHttpUrl(downloadUrl)) {
    throw new Error(`SMD resource ${resourceId} latest version does not provide a valid download URL.`);
  }

  return { version, downloadUrl };
}

export async function checkSmdUpdatesForInstalled(
  installed: Array<{ resourceId: number; smdVersion: string }>,
): Promise<SmdInstalledUpdateStatus[]> {
  const unique = new Map<number, string>();
  for (const item of installed) {
    if (!Number.isFinite(item.resourceId) || item.resourceId <= 0) continue;
    if (typeof item.smdVersion !== 'string' || item.smdVersion.trim().length === 0) continue;
    unique.set(item.resourceId, item.smdVersion.trim());
  }

  const checks = Array.from(unique.entries()).map(async ([resourceId, currentVersion]) => {
    try {
      const latest = await fetchLatestSmdDownload(resourceId);
      return {
        resourceId,
        currentVersion,
        latestVersion: latest.version,
        hasUpdate: latest.version !== currentVersion,
      } satisfies SmdInstalledUpdateStatus;
    } catch (error) {
      return {
        resourceId,
        currentVersion,
        hasUpdate: false,
        error: error instanceof Error ? error.message : String(error),
      } satisfies SmdInstalledUpdateStatus;
    }
  });

  return Promise.all(checks);
}

function createModRecordFromFile(
  modFilePath: string,
  metadataForInstallation: Record<string, ModMetadataRecord>,
): ModRecord | null {
  if (!fs.existsSync(modFilePath)) return null;
  const stats = fs.statSync(modFilePath);
  if (!stats.isFile()) return null;

  const ext = path.extname(modFilePath).toLowerCase();
  if (ext !== '.jar') return null;

  const normalizedPath = path.resolve(modFilePath);
  const relativePath = path.join(MODS_DIR_NAME, path.basename(modFilePath));

  const fileName = path.basename(modFilePath);
  return {
    fileName,
    absolutePath: normalizedPath,
    relativePath,
    sizeBytes: stats.size,
    modifiedMs: stats.mtimeMs,
    // StarMade owns enable/disable state. Presence in mods/ means available to the game.
    enabled: true,
    downloadUrl: metadataForInstallation[fileName]?.downloadUrl,
    resourceId: metadataForInstallation[fileName]?.resourceId,
    smdVersion: metadataForInstallation[fileName]?.smdVersion,
  };
}

export function listModsForInstallation(
  installationPath: string,
  launcherDir: string,
  metadataStore: ModMetadataStore,
): ModsListResult {
  const installationRoot = getInstallationRoot(installationPath, launcherDir);
  const modsDir = path.join(installationRoot, MODS_DIR_NAME);
  const legacyDisabledModsDir = path.join(installationRoot, LEGACY_MODS_DISABLED_DIR_NAME);
  fs.mkdirSync(modsDir, { recursive: true });
  migrateLegacyDisabledModsToMods(modsDir, legacyDisabledModsDir);

  const metadata = readMetadata(metadataStore);
  const installationKey = getInstallationKey(installationRoot);
  const metadataForInstallation = metadata.byInstallation[installationKey] ?? {};

  const entries: ModRecord[] = [];
  for (const fileName of fs.readdirSync(modsDir)) {
    const mod = createModRecordFromFile(path.join(modsDir, fileName), metadataForInstallation);
    if (mod) entries.push(mod);
  }

  entries.sort((a, b) => a.fileName.localeCompare(b.fileName));

  return {
    modsDir,
    mods: entries,
  };
}

async function downloadToFile(
  downloadUrl: string,
  targetPath: string,
  headers?: Record<string, string>,
): Promise<void> {
  const response = await fetch(downloadUrl, headers ? { headers } : undefined);
  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    const suffix = bodyText.trim().length > 0
      ? `: ${bodyText.trim().slice(0, 240)}`
      : '';
    throw new Error(`Download request failed with status ${response.status}${suffix}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  fs.writeFileSync(targetPath, Buffer.from(arrayBuffer));
}

function updateMetadataForFile(
  metadataStore: ModMetadataStore,
  installationRoot: string,
  fileName: string,
  record: ModMetadataRecord,
): void {
  const metadata = readMetadata(metadataStore);
  const installationKey = getInstallationKey(installationRoot);
  if (!metadata.byInstallation[installationKey]) metadata.byInstallation[installationKey] = {};
  metadata.byInstallation[installationKey][fileName] = record;
  writeMetadata(metadataStore, metadata);
}

function removeMetadataForFile(metadataStore: ModMetadataStore, installationRoot: string, fileName: string): void {
  const metadata = readMetadata(metadataStore);
  const installationKey = getInstallationKey(installationRoot);
  if (!metadata.byInstallation[installationKey]) return;
  delete metadata.byInstallation[installationKey][fileName];
  if (Object.keys(metadata.byInstallation[installationKey]).length === 0) {
    delete metadata.byInstallation[installationKey];
  }
  writeMetadata(metadataStore, metadata);
}

export async function downloadModForInstallation(options: {
  installationPath: string;
  launcherDir: string;
  downloadUrl: string;
  preferredFileName?: string;
  enabled?: boolean;
  source: 'smd' | 'modpack-import';
  resourceId?: number;
  smdVersion?: string;
  metadataStore: ModMetadataStore;
}): Promise<ModRecord> {
  const {
    installationPath,
    launcherDir,
    downloadUrl,
    preferredFileName,
    metadataStore,
    source,
    resourceId,
    smdVersion,
  } = options;

  if (!isHttpUrl(downloadUrl)) {
    throw new Error('Only http/https download URLs are supported.');
  }

  const installationRoot = getInstallationRoot(installationPath, launcherDir);
  const modsDir = path.join(installationRoot, MODS_DIR_NAME);
  fs.mkdirSync(modsDir, { recursive: true });

  const downloadHeaders = getDownloadRequestHeaders(downloadUrl);
  const headResponse = await fetch(
    downloadUrl,
    downloadHeaders ? { method: 'HEAD', headers: downloadHeaders } : { method: 'HEAD' },
  ).catch(() => null);
  const inferredFileName = inferDownloadFileName(
    downloadUrl,
    headResponse?.headers.get('content-disposition') ?? null,
    preferredFileName,
  );

  const targetPath = getUniqueFilePath(modsDir, inferredFileName);
  assertWithin(installationRoot, targetPath);

  await downloadToFile(downloadUrl, targetPath, downloadHeaders);

  const fileName = path.basename(targetPath);
  updateMetadataForFile(metadataStore, installationRoot, fileName, {
    downloadUrl,
    addedAt: new Date().toISOString(),
    source,
    resourceId,
    smdVersion,
  });

  const listed = listModsForInstallation(installationRoot, launcherDir, metadataStore).mods.find((mod) => mod.fileName === fileName);
  if (!listed) throw new Error('Downloaded mod was not found after write.');
  return listed;
}

function removeExistingModsForResource(
  installationPath: string,
  launcherDir: string,
  metadataStore: ModMetadataStore,
  resourceId: number,
): void {
  const existing = listModsForInstallation(installationPath, launcherDir, metadataStore).mods;
  for (const mod of existing) {
    if (mod.resourceId !== resourceId) continue;
    removeModForInstallation({
      installationPath,
      launcherDir,
      relativePath: mod.relativePath,
      metadataStore,
    });
  }
}

export async function installOrUpdateSmdModForInstallation(options: {
  installationPath: string;
  launcherDir: string;
  resourceId: number;
  enabled?: boolean;
  metadataStore: ModMetadataStore;
}): Promise<ModRecord> {
  const { installationPath, launcherDir, resourceId, metadataStore } = options;
  if (!Number.isFinite(resourceId) || resourceId <= 0) {
    throw new Error('Invalid SMD resource id.');
  }

  const { version, downloadUrl } = await fetchLatestSmdDownload(resourceId);
  const catalog = await listSmdMods();
  const resourceName = catalog.find((item) => item.resourceId === resourceId)?.name ?? `smd-${resourceId}`;
  const preferredFileName = sanitizeModFileName(`${resourceName}-v${version}.jar`, `smd-${resourceId}`);

  removeExistingModsForResource(installationPath, launcherDir, metadataStore, resourceId);

  return downloadModForInstallation({
    installationPath,
    launcherDir,
    downloadUrl,
    preferredFileName,
    source: 'smd',
    resourceId,
    smdVersion: version,
    metadataStore,
  });
}

function resolveManagedModPath(installationRoot: string, relativePath: string): string {
  const modsDir = path.join(installationRoot, MODS_DIR_NAME);

  const normalized = path.normalize(relativePath);
  const allowedRoot = path.normalize(MODS_DIR_NAME);
  const startsInAllowedRoot = normalized === allowedRoot || normalized.startsWith(`${allowedRoot}${path.sep}`);
  if (!startsInAllowedRoot) throw new Error('Mod path is outside managed mods directory.');

  const fullPath = path.resolve(path.join(installationRoot, normalized));
  const fullModsDir = path.resolve(modsDir);

  if (!fullPath.startsWith(`${fullModsDir}${path.sep}`)) {
    throw new Error('Mod path is outside installation mods directory.');
  }

  if (path.extname(fullPath).toLowerCase() !== '.jar') {
    throw new Error('Only .jar mod files are supported.');
  }

  return fullPath;
}

export function removeModForInstallation(options: {
  installationPath: string;
  launcherDir: string;
  relativePath: string;
  metadataStore: ModMetadataStore;
}): void {
  const { installationPath, launcherDir, relativePath, metadataStore } = options;
  const installationRoot = getInstallationRoot(installationPath, launcherDir);
  const fullPath = resolveManagedModPath(installationRoot, relativePath);
  if (!fs.existsSync(fullPath)) throw new Error('Mod file does not exist.');

  fs.unlinkSync(fullPath);
  removeMetadataForFile(metadataStore, installationRoot, path.basename(fullPath));
}

export function setModEnabledForInstallation(options: {
  installationPath: string;
  launcherDir: string;
  relativePath: string;
  enabled: boolean;
}): { relativePath: string } {
  const { installationPath, launcherDir, relativePath, enabled } = options;
  if (!enabled) {
    throw new Error('Disabling mods is managed by StarMade. Use the in-game mod settings.');
  }

  const installationRoot = getInstallationRoot(installationPath, launcherDir);
  const sourcePath = resolveManagedModPath(installationRoot, relativePath);
  if (!fs.existsSync(sourcePath)) throw new Error('Mod file does not exist.');

  return {
    relativePath: path.join(MODS_DIR_NAME, path.basename(sourcePath)),
  };
}

function isManifestInstallationInfo(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as { id?: unknown; name?: unknown; version?: unknown };
  if (item.id !== undefined && typeof item.id !== 'string') return false;
  if (item.name !== undefined && typeof item.name !== 'string') return false;
  return item.version === undefined || typeof item.version === 'string';
}

export function parseModpackManifest(raw: unknown): ModpackManifest {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Manifest must be a JSON object.');
  }

  const obj = raw as {
    format?: unknown;
    version?: unknown;
    name?: unknown;
    createdAt?: unknown;
    sourceInstallation?: unknown;
    entries?: unknown;
  };

  if (obj.format !== 'starmade-modpack') {
    throw new Error('Unsupported manifest format.');
  }
  if (obj.version !== 1) {
    throw new Error('Unsupported manifest version.');
  }
  if (typeof obj.name !== 'string' || obj.name.trim().length === 0) {
    throw new Error('Manifest name is required.');
  }
  if (typeof obj.createdAt !== 'string' || obj.createdAt.trim().length === 0) {
    throw new Error('Manifest createdAt is required.');
  }
  if (!Array.isArray(obj.entries)) {
    throw new Error('Manifest entries must be an array.');
  }

  const entries: ModpackEntry[] = obj.entries.map((entryRaw, index) => {
    if (!entryRaw || typeof entryRaw !== 'object' || Array.isArray(entryRaw)) {
      throw new Error(`Manifest entry ${index + 1} is invalid.`);
    }
    const entry = entryRaw as { name?: unknown; fileName?: unknown; downloadUrl?: unknown; enabled?: unknown };
    if (typeof entry.name !== 'string' || entry.name.trim().length === 0) {
      throw new Error(`Manifest entry ${index + 1} is missing name.`);
    }
    if (typeof entry.downloadUrl !== 'string' || !isHttpUrl(entry.downloadUrl)) {
      throw new Error(`Manifest entry ${index + 1} must use an http/https downloadUrl.`);
    }

    return {
      name: entry.name,
      fileName: typeof entry.fileName === 'string' ? sanitizeModFileName(entry.fileName) : undefined,
      downloadUrl: entry.downloadUrl,
      enabled: typeof entry.enabled === 'boolean' ? entry.enabled : true,
    };
  });

  const sourceInstallation = isManifestInstallationInfo(obj.sourceInstallation)
    ? (obj.sourceInstallation as { id?: string; name?: string; version?: string })
    : undefined;

  return {
    format: 'starmade-modpack',
    version: 1,
    name: obj.name.trim(),
    createdAt: obj.createdAt,
    sourceInstallation,
    entries,
  };
}

export function createModpackManifest(options: {
  installationPath: string;
  launcherDir: string;
  manifestName: string;
  sourceInstallation?: { id?: string; name?: string; version?: string };
  metadataStore: ModMetadataStore;
}): { manifest: ModpackManifest; exportedCount: number; skippedCount: number } {
  const { installationPath, launcherDir, manifestName, sourceInstallation, metadataStore } = options;
  const listResult = listModsForInstallation(installationPath, launcherDir, metadataStore);

  const entries: ModpackEntry[] = [];
  let skippedCount = 0;

  for (const mod of listResult.mods) {
    if (!mod.downloadUrl) {
      skippedCount += 1;
      continue;
    }

    entries.push({
      name: mod.fileName,
      fileName: mod.fileName,
      downloadUrl: mod.downloadUrl,
    });
  }

  const manifest: ModpackManifest = {
    format: 'starmade-modpack',
    version: 1,
    name: manifestName.trim() || 'StarMade Modpack',
    createdAt: new Date().toISOString(),
    sourceInstallation,
    entries,
  };

  return {
    manifest,
    exportedCount: entries.length,
    skippedCount,
  };
}

export function writeModpackManifest(outputPath: string, manifest: ModpackManifest): void {
  if (typeof outputPath !== 'string' || outputPath.trim().length === 0) {
    throw new Error('Output path is required.');
  }
  const resolvedOutput = path.resolve(outputPath);
  const outputDir = path.dirname(resolvedOutput);
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(resolvedOutput, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

export async function importModpackFromFile(options: {
  installationPath: string;
  launcherDir: string;
  manifestPath: string;
  metadataStore: ModMetadataStore;
}): Promise<{
  downloadedCount: number;
  skippedCount: number;
  failedCount: number;
  failures: string[];
}> {
  const { installationPath, launcherDir, manifestPath, metadataStore } = options;
  if (typeof manifestPath !== 'string' || manifestPath.trim().length === 0) {
    throw new Error('Manifest path is required.');
  }

  const raw = fs.readFileSync(path.resolve(manifestPath), 'utf8');
  const parsed = JSON.parse(raw) as unknown;
  const manifest = parseModpackManifest(parsed);

  let downloadedCount = 0;
  let skippedCount = 0;
  const failures: string[] = [];

  for (const entry of manifest.entries) {
    try {
      await downloadModForInstallation({
        installationPath,
        launcherDir,
        downloadUrl: entry.downloadUrl,
        preferredFileName: entry.fileName || entry.name,
        source: 'modpack-import',
        metadataStore,
      });
      downloadedCount += 1;
    } catch (error) {
      failures.push(`${entry.name}: ${toErrorMessage(error)}`);
    }
  }

  if (manifest.entries.length === 0) skippedCount += 1;

  return {
    downloadedCount,
    skippedCount,
    failedCount: failures.length,
    failures,
  };
}

