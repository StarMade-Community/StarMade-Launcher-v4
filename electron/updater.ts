/**
 * Launcher self-update checker.
 *
 * Fetches the latest release from the GitHub releases API and compares it
 * against the currently running app version.  When a newer version is found
 * the result is returned so the main process can notify the renderer.
 *
 * This module deliberately does NOT download/install the update automatically;
 * it opens the releases page in the default browser so the user downloads the
 * installer for their platform.
 */

import { app } from 'electron';

// ─── Constants ────────────────────────────────────────────────────────────────

const GITHUB_RELEASES_API =
  'https://api.github.com/repos/StarMade-Community/StarMade-Launcher-v4/releases/latest';

const GITHUB_RELEASES_PAGE =
  'https://github.com/StarMade-Community/StarMade-Launcher-v4/releases/latest';

/** Request timeout in milliseconds. */
const TIMEOUT_MS = 15_000;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface UpdateInfo {
  /** Whether a newer version is available. */
  available: boolean;
  /** The latest release version string from GitHub (e.g. "4.1.0"). */
  latestVersion: string;
  /** The currently running version (from package.json). */
  currentVersion: string;
  /** Human-readable release notes / body from GitHub. */
  releaseNotes: string;
  /** URL to the GitHub releases page for manual download. */
  downloadUrl: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Compare two semver strings.
 * Returns:
 *   -1 if a < b (a is older)
 *    0 if a == b
 *    1 if a > b (a is newer)
 */
function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const parse = (s: string): [number, number, number] => {
    const parts = s.replace(/^v/, '').split('.');
    const nums = parts.map(n => parseInt(n, 10));
    if (nums.some(isNaN)) {
      throw new Error(`Invalid semver string: "${s}"`);
    }
    return [nums[0] ?? 0, nums[1] ?? 0, nums[2] ?? 0];
  };

  const [aMajor, aMinor, aPatch] = parse(a);
  const [bMajor, bMinor, bPatch] = parse(b);

  if (aMajor !== bMajor) return aMajor < bMajor ? -1 : 1;
  if (aMinor !== bMinor) return aMinor < bMinor ? -1 : 1;
  if (aPatch !== bPatch) return aPatch < bPatch ? -1 : 1;
  return 0;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Check GitHub releases for a newer version of the launcher.
 *
 * @returns An `UpdateInfo` object describing the result.
 * @throws  If the network request fails or the response is malformed.
 */
export async function checkForUpdates(): Promise<UpdateInfo> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let body: Record<string, unknown>;

  try {
    const res = await fetch(GITHUB_RELEASES_API, {
      signal: controller.signal,
      headers: {
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'StarMade-Launcher',
      },
    });

    if (!res.ok) {
      throw new Error(`GitHub API returned HTTP ${res.status}`);
    }

    body = (await res.json()) as Record<string, unknown>;
  } finally {
    clearTimeout(timeoutId);
  }

  if (typeof body !== 'object' || body === null) {
    throw new Error('GitHub API response is not an object');
  }

  const tagName = typeof body.tag_name === 'string' ? body.tag_name : '';
  if (!tagName) {
    throw new Error('GitHub API response missing tag_name');
  }

  const latestVersion = tagName.replace(/^v/, '');
  const currentVersion = app.getVersion();
  const releaseNotes =
    typeof body.body === 'string' ? body.body.trim() : '';

  const available = compareSemver(currentVersion, latestVersion) < 0;

  return {
    available,
    latestVersion,
    currentVersion,
    releaseNotes,
    downloadUrl: GITHUB_RELEASES_PAGE,
  };
}

/**
 * The URL of the GitHub releases page, used by the renderer when the user
 * chooses to navigate there.
 */
export { GITHUB_RELEASES_PAGE as releasesPageUrl };
