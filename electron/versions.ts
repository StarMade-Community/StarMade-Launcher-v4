/**
 * Version manifest fetching for the StarMade CDN.
 *
 * Branch index format (one entry per line):
 *   0.203.175#20231020_123456 ./build/starmade-build_20231020_123456
 *
 * Reference: v2 launcher `src/services/updater.coffee` — getVersions()
 */

import { getRequiredJavaVersion } from './java.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const BASE_URL = 'http://files.star-made.org';

const BRANCH_URLS: Record<string, string> = {
  pre:     `${BASE_URL}/prebuildindex`,
  dev:     `${BASE_URL}/devbuildindex`,
  release: `${BASE_URL}/releasebuildindex`,
  archive: `${BASE_URL}/archivebuildindex`,
};

/** Cache TTL: 5 minutes */
const CACHE_TTL_MS = 5 * 60 * 1000;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FetchedVersion {
  id: string;
  name: string;
  type: 'release' | 'dev' | 'pre' | 'archive';
  build: string;
  buildPath: string;
  requiredJavaVersion: 8 | 25;
}

// ─── Cache ────────────────────────────────────────────────────────────────────

interface CacheEntry {
  data: FetchedVersion[];
  timestamp: number;
}

const _cache = new Map<string, CacheEntry>();

// ─── HTTP helper ──────────────────────────────────────────────────────────────

async function fetchText(url: string): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
    return await res.text();
  } finally {
    clearTimeout(timeoutId);
  }
}

// ─── Parsing ─────────────────────────────────────────────────────────────────

function parseBuildIndex(text: string, branch: string): FetchedVersion[] {
  const versions: FetchedVersion[] = [];
  const seen = new Set<string>();

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Entry format: 0.203.175#20231020_123456 ./build/starmade-build_20231020_123456
    const spaceIdx = trimmed.indexOf(' ');
    if (spaceIdx < 0) continue;

    const buildIdStr = trimmed.substring(0, spaceIdx);
    const buildPath  = trimmed.substring(spaceIdx + 1).trim();

    const hashIdx = buildIdStr.indexOf('#');
    if (hashIdx < 0) continue;

    const version = buildIdStr.substring(0, hashIdx);
    const build   = buildIdStr.substring(hashIdx + 1);

    // Skip malformed entries (mirrors v2 validation)
    if (!version || !build || !buildPath || buildPath.includes('#')) continue;

    // Deduplicate (consecutive duplicate entries appear in the real index)
    const key = `${version}#${build}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const type = branch as FetchedVersion['type'];
    const prefix = branch === 'release' ? '' : `${branch.charAt(0).toUpperCase()}${branch.slice(1)} `;

    versions.push({
      id: version,
      name: `${prefix}${version}`.trim(),
      type,
      build,
      buildPath,
      requiredJavaVersion: getRequiredJavaVersion(version),
    });
  }

  return versions;
}

// ─── Public API ──────────────────────────────────────────────────────────────

async function fetchBranch(branch: string): Promise<FetchedVersion[]> {
  const url = BRANCH_URLS[branch];
  if (!url) throw new Error(`Unknown branch: ${branch}`);

  const cached = _cache.get(branch);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) return cached.data;

  const text = await fetchText(url);
  const data = parseBuildIndex(text, branch);
  _cache.set(branch, { data, timestamp: Date.now() });
  return data;
}

/**
 * Fetch all available versions across every branch.
 * Returns release, then dev, then pre, then archive — most recent first within each.
 * Network failures for individual branches are logged and skipped; the caller
 * receives whatever branches succeeded.
 */
export async function fetchAllVersions(): Promise<FetchedVersion[]> {
  const branches: Array<FetchedVersion['type']> = ['release', 'dev', 'pre', 'archive'];
  const results: FetchedVersion[] = [];

  for (const branch of branches) {
    try {
      const versions = await fetchBranch(branch);
      results.push(...versions);
    } catch (err) {
      console.warn(`[versions] Failed to fetch "${branch}" branch:`, err);
    }
  }

  return results;
}

/** Evict all cached branch indexes (e.g. after a manual "Check for updates" trigger). */
export function invalidateVersionCache(): void {
  _cache.clear();
}

