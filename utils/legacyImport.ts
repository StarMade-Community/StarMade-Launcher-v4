import type { ManagedItem, Version } from '@/types';

export const LEGACY_IMPORT_PROMPT_STORE_KEY = 'legacyImportPromptState';

export type LegacyImportPromptStatus = 'pending' | 'not-found' | 'dismissed' | 'imported';

export interface LegacyImportPromptState {
  status: LegacyImportPromptStatus;
  paths: string[];
  updatedAt: string;
}

export function dedupeLegacyInstallPaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const path of paths) {
    if (typeof path !== 'string') continue;
    const normalized = path.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    deduped.push(normalized);
  }

  return deduped;
}

export function areLegacyPathListsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((path, index) => path === b[index]);
}

export function createLegacyImportPromptState(
  status: LegacyImportPromptStatus,
  paths: string[] = [],
): LegacyImportPromptState {
  return {
    status,
    paths: dedupeLegacyInstallPaths(paths),
    updatedAt: new Date().toISOString(),
  };
}

export function parseLegacyImportPromptState(value: unknown): LegacyImportPromptState | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const candidate = value as Partial<LegacyImportPromptState>;
  if (candidate.status !== 'pending' && candidate.status !== 'not-found' && candidate.status !== 'dismissed' && candidate.status !== 'imported') {
    return null;
  }

  return {
    status: candidate.status,
    paths: Array.isArray(candidate.paths)
      ? dedupeLegacyInstallPaths(candidate.paths.filter((path): path is string => typeof path === 'string'))
      : [],
    updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : new Date().toISOString(),
  };
}

function createManagedInstallationId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  return `legacy-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function getLegacyImportDefaults(): Promise<Pick<ManagedItem, 'minMemory' | 'maxMemory' | 'jvmArgs'>> {
  if (typeof window === 'undefined' || !window.launcher?.store) return {};

  try {
    const stored = await window.launcher.store.get('defaultInstallationSettings');
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {};

    const raw = stored as Record<string, unknown>;
    const defaults: Pick<ManagedItem, 'minMemory' | 'maxMemory' | 'jvmArgs'> = {};

    if (typeof raw.javaMemory === 'number' && raw.javaMemory > 0) {
      defaults.minMemory = raw.javaMemory;
      defaults.maxMemory = raw.javaMemory;
    }

    if (typeof raw.jvmArgs === 'string' && raw.jvmArgs.trim().length > 0) {
      const extraJvmArgs = raw.jvmArgs
        .split(/\s+/)
        .filter(arg => !/^-Xm[sx]\d+[kKmMgGtT]?$/i.test(arg))
        .join(' ')
        .trim();

      if (extraJvmArgs) defaults.jvmArgs = extraJvmArgs;
    }

    return defaults;
  } catch (error) {
    console.error('Failed to load defaults for legacy import:', error);
    return {};
  }
}

export async function buildLegacyImportedInstallation(
  installPath: string,
  versions: Version[],
): Promise<ManagedItem> {
  const normalizedPath = installPath.trim();
  const defaults = await getLegacyImportDefaults();

  let version = 'unknown';
  if (window.launcher?.legacy?.readVersion) {
    try {
      const parsed = await window.launcher.legacy.readVersion(normalizedPath);
      if (parsed) version = parsed;
    } catch (error) {
      console.error('Failed to read legacy installation version:', error);
    }
  }

  const folderName = normalizedPath.replace(/[/\\]+$/, '').split(/[/\\]/).pop() ?? 'legacy-install';
  const matchedVersion = versions.find(candidate => candidate.id === version);
  const detectedType = matchedVersion?.type ?? 'archive';

  return {
    id: createManagedInstallationId(),
    name: folderName,
    version,
    type: detectedType,
    icon: detectedType === 'release'
      ? 'release'
      : detectedType === 'dev'
        ? 'dev'
        : detectedType === 'pre'
          ? 'pre'
          : 'archive',
    path: normalizedPath,
    lastPlayed: 'Never',
    installed: true,
    requiredJavaVersion: matchedVersion?.requiredJavaVersion,
    ...defaults,
  };
}

