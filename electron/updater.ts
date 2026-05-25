/**
 * Launcher self-update via ASAR swap.
 *
 * Strategy (works on all platforms without code signing):
 *  1. Query GitHub Releases API for the latest version tag.
 *  2. Compare against the running app version.
 *  3. If newer: download the `app.asar` asset from the release into
 *     the resources directory as `app_update.asar`.
 *  4. On next launch (or via app.relaunch()), the startup code detects
 *     `app_update.asar` and swaps it into place before loading.
 *
 * For the initial launch swap, see `applyPendingUpdate()` which should
 * be called very early in the main process before the app is ready.
 *
 * Fallback: if anything goes wrong, open the GitHub releases page in
 * the user's browser.
 */

import { app, shell } from 'electron';
import https from 'https';
import http  from 'http';
import fs    from 'fs';
import path  from 'path';

// ─── Constants ────────────────────────────────────────────────────────────────

const GITHUB_RELEASES_API =
  'https://api.github.com/repos/StarMade-Community/StarMade-Launcher-v4/releases/latest';

const GITHUB_ALL_RELEASES_API =
  'https://api.github.com/repos/StarMade-Community/StarMade-Launcher-v4/releases';

const GITHUB_RELEASES_PAGE =
  'https://github.com/StarMade-Community/StarMade-Launcher-v4/releases/latest';

const TIMEOUT_MS = 30_000;

const ASAR_ASSET_NAME = 'app.asar';
const UPDATE_FILE_NAME = 'app_update.asar';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface UpdateInfo {
  available: boolean;
  latestVersion: string;
  currentVersion: string;
  releaseNotes: string;
  downloadUrl: string;
  assetUrl?: string;
  assetName?: string;
  isPreRelease?: boolean;
}

export interface DownloadProgress {
  bytesReceived: number;
  totalBytes: number;
  percent: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const parse = (s: string): [number, number, number] => {
    const parts = s.replace(/^v/, '').split('.');
    const nums = parts.map(n => parseInt(n, 10));
    if (nums.some(isNaN)) throw new Error(`Invalid semver: "${s}"`);
    return [nums[0] ?? 0, nums[1] ?? 0, nums[2] ?? 0];
  };
  const [aMajor, aMinor, aPatch] = parse(a);
  const [bMajor, bMinor, bPatch] = parse(b);
  if (aMajor !== bMajor) return aMajor < bMajor ? -1 : 1;
  if (aMinor !== bMinor) return aMinor < bMinor ? -1 : 1;
  if (aPatch !== bPatch) return aPatch < bPatch ? -1 : 1;
  return 0;
}

/**
 * Resolve the `resources` directory that contains `app.asar`.
 * - Windows/Linux: `<app-dir>/resources/`
 * - macOS:         `<app-bundle>/Contents/Resources/`
 */
function getResourcesDir(): string {
  if (process.platform === 'darwin') {
    // app.getAppPath() returns something like:
    //   /Applications/StarMade Launcher.app/Contents/Resources/app.asar
    // or when running from source:
    //   /path/to/project
    const appPath = app.getAppPath();
    if (appPath.includes('app.asar')) {
      return path.dirname(appPath);
    }
    return path.join(path.dirname(app.getPath('exe')), '..', 'Resources');
  }

  // Windows / Linux
  const appPath = app.getAppPath();
  if (appPath.includes('app.asar')) {
    return path.dirname(appPath);
  }
  return path.join(path.dirname(app.getPath('exe')), 'resources');
}

/**
 * Find the `app.asar` asset URL from a GitHub release's assets array.
 */
function findAsarAsset(
  assets: Array<{ name: string; browser_download_url: string }>
): { name: string; browser_download_url: string } | undefined {
  return assets.find(a => a.name === ASAR_ASSET_NAME) ?? undefined;
}

/**
 * Also look for a platform-specific installer as fallback (for the UI to show
 * "Open in Browser" if ASAR isn't available).
 */
function findPlatformAsset(
  assets: Array<{ name: string; browser_download_url: string }>
): { name: string; browser_download_url: string } | undefined {
  const plat = process.platform;
  if (plat === 'win32') return assets.find(a => /\.exe$/i.test(a.name));
  if (plat === 'linux') return assets.find(a => /\.AppImage$/i.test(a.name));
  if (plat === 'darwin') return assets.find(a => /\.dmg$/i.test(a.name));
  return undefined;
}

function httpGetStream(
  url: string,
  maxRedirects = 10
): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    if (maxRedirects < 0) {
      reject(new Error('Too many redirects'));
      return;
    }

    const isHttps = url.startsWith('https');
    const lib: typeof https = isHttps ? https : (http as unknown as typeof https);

    const reqOptions = {
      timeout: TIMEOUT_MS,
      headers: {
        'User-Agent': 'StarMade-Launcher',
        Accept: 'application/octet-stream',
      },
    };

    const req = lib.get(url, reqOptions, res => {
      if (
        res.statusCode &&
        res.statusCode >= 300 &&
        res.statusCode < 400 &&
        res.headers.location
      ) {
        res.resume();
        httpGetStream(res.headers.location, maxRedirects - 1)
          .then(resolve)
          .catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} downloading ${url}`));
        res.resume();
        return;
      }
      resolve(res);
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Timeout downloading ${url}`));
    });
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Check GitHub releases for a newer version of the launcher.
 */
export async function checkForUpdates(
  options: { includePreReleases?: boolean } = {},
): Promise<UpdateInfo> {
  const { includePreReleases = false } = options;
  const apiUrl = includePreReleases ? GITHUB_ALL_RELEASES_API : GITHUB_RELEASES_API;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let release: Record<string, unknown>;
  try {
    const res = await fetch(apiUrl, {
      signal: controller.signal,
      headers: {
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'StarMade-Launcher',
      },
    });
    if (!res.ok) throw new Error(`GitHub API returned HTTP ${res.status}`);

    if (includePreReleases) {
      const releases = (await res.json()) as Array<Record<string, unknown>>;
      if (!Array.isArray(releases) || releases.length === 0) {
        throw new Error('GitHub API returned no releases');
      }
      const found = releases.find(r => !r.draft);
      if (!found) throw new Error('GitHub API returned no publishable releases');
      release = found;
    } else {
      release = (await res.json()) as Record<string, unknown>;
    }
  } finally {
    clearTimeout(timeoutId);
  }

  if (typeof release !== 'object' || release === null) {
    throw new Error('GitHub API response is not an object');
  }

  const tagName = typeof release.tag_name === 'string' ? release.tag_name : '';
  if (!tagName) throw new Error('GitHub API response missing tag_name');

  const latestVersion  = tagName.replace(/^v/, '');
  const currentVersion = app.getVersion();
  const releaseNotes   = typeof release.body === 'string' ? release.body.trim() : '';
  const isPreRelease   = release.prerelease === true;
  const available      = compareSemver(currentVersion, latestVersion) < 0;

  let assetUrl: string | undefined;
  let assetName: string | undefined;

  if (Array.isArray(release.assets)) {
    const assets = release.assets as Array<{ name: string; browser_download_url: string }>;
    // Prefer the app.asar asset for silent update
    const asarAsset = findAsarAsset(assets);
    if (asarAsset) {
      assetUrl  = asarAsset.browser_download_url;
      assetName = asarAsset.name;
    } else {
      // Fallback to platform installer (user will get "Open in Browser")
      const platformAsset = findPlatformAsset(assets);
      if (platformAsset) {
        assetUrl  = platformAsset.browser_download_url;
        assetName = platformAsset.name;
      }
    }
  }

  return {
    available,
    latestVersion,
    currentVersion,
    releaseNotes,
    isPreRelease,
    downloadUrl: GITHUB_RELEASES_PAGE,
    assetUrl,
    assetName,
  };
}

/**
 * Download the app.asar update asset into the resources directory as
 * `app_update.asar`, reporting progress via the supplied callback.
 *
 * @returns The absolute path to the downloaded update file.
 */
export async function downloadUpdate(
  assetUrl: string,
  _assetName: string,
  onProgress: (progress: DownloadProgress) => void
): Promise<string> {
  const resourcesDir = getResourcesDir();
  const destPath = path.join(resourcesDir, UPDATE_FILE_NAME);

  // Remove a stale partial download if present
  try { fs.unlinkSync(destPath); } catch { /* ignore */ }

  const res = await httpGetStream(assetUrl);

  const totalBytes = parseInt(res.headers['content-length'] ?? '0', 10) || 0;
  let bytesReceived = 0;

  await new Promise<void>((resolve, reject) => {
    const writeStream = fs.createWriteStream(destPath);

    res.on('data', (chunk: Buffer) => {
      bytesReceived += chunk.length;
      const percent = totalBytes > 0 ? Math.round((bytesReceived / totalBytes) * 100) : 0;
      onProgress({ bytesReceived, totalBytes, percent });
    });

    res.pipe(writeStream);
    writeStream.on('finish', resolve);
    writeStream.on('error', reject);
    res.on('error', reject);
  });

  // Validate that the downloaded file is actually an ASAR archive.
  // ASAR files start with a 4-byte LE uint32 header size. If we got
  // an HTML error page or a JSON API response instead, catch it now
  // rather than crashing on next launch.
  const fd = fs.openSync(destPath, 'r');
  try {
    const header = Buffer.alloc(16);
    fs.readSync(fd, header, 0, 16, 0);
    // ASAR header: 4 bytes pickle size, 4 bytes header-string size,
    // then another pickle containing JSON starting with '{"files"'.
    // A quick sanity check: the file must not start with '<' (HTML)
    // or '{' at byte 0 (raw JSON), and must be > 1 KB.
    const firstByte = header[0];
    const fileSize = fs.fstatSync(fd).size;
    if (fileSize < 1024 || firstByte === 0x3C /* < */ || firstByte === 0x7B /* { */) {
      fs.closeSync(fd);
      try { fs.unlinkSync(destPath); } catch { /* ignore */ }
      const preview = fs.existsSync(destPath) ? '' : ` (first byte: 0x${firstByte.toString(16)}, size: ${fileSize})`;
      throw new Error(`Downloaded file is not a valid ASAR package${preview}`);
    }
  } finally {
    try { fs.closeSync(fd); } catch { /* ignore */ }
  }

  return destPath;
}

/**
 * "Install" the update by restarting the app. The actual swap happens
 * at the next startup via `applyPendingUpdate()`.
 *
 * This works on ALL platforms (Windows, macOS, Linux) because we're only
 * replacing the app.asar file, not the executable itself — no code signing
 * issues.
 */
export async function installUpdate(installerPath: string): Promise<void> {
  // Verify the update file exists
  if (!installerPath || !fs.existsSync(installerPath)) {
    console.error('[Updater] Update file missing, opening browser fallback');
    await shell.openExternal(GITHUB_RELEASES_PAGE);
    return;
  }

  // Relaunch the app — applyPendingUpdate() will handle the swap on next start
  app.relaunch();
  app.quit();
}

/**
 * Apply a pending update if one exists.
 *
 * Call this VERY EARLY in the main process (before `app.on('ready')`).
 * It checks if `app_update.asar` exists in the resources directory and,
 * if so, replaces `app.asar` with it.
 *
 * The swap is done synchronously before Electron loads the app code from
 * `app.asar`, ensuring the new version is what actually runs.
 */
export function applyPendingUpdate(): boolean {
  try {
    const resourcesDir = getResourcesDir();
    const updatePath = path.join(resourcesDir, UPDATE_FILE_NAME);
    const appAsarPath = path.join(resourcesDir, 'app.asar');

    if (!fs.existsSync(updatePath)) return false;

    console.log('[Updater] Found pending update, applying...');

    // Backup current app.asar
    const backupPath = path.join(resourcesDir, 'app.asar.backup');
    try { fs.unlinkSync(backupPath); } catch { /* no previous backup */ }

    try {
      fs.copyFileSync(appAsarPath, backupPath);
    } catch (err) {
      console.error('[Updater] Failed to backup current app.asar:', err);
      // Continue anyway — the update is more important
    }

    // Replace app.asar with the update
    try {
      fs.copyFileSync(updatePath, appAsarPath);
      fs.unlinkSync(updatePath);
      console.log('[Updater] Update applied successfully');
      return true;
    } catch (err) {
      console.error('[Updater] Failed to apply update:', err);
      // Try to restore backup
      try {
        if (fs.existsSync(backupPath)) {
          fs.copyFileSync(backupPath, appAsarPath);
        }
      } catch { /* last resort failed */ }
      // Clean up the broken update file
      try { fs.unlinkSync(updatePath); } catch { /* ignore */ }
      return false;
    }
  } catch (err) {
    console.error('[Updater] applyPendingUpdate error:', err);
    return false;
  }
}

/**
 * Open the GitHub releases page in the user's default browser.
 */
export function openReleasesPage(): void {
  shell.openExternal(GITHUB_RELEASES_PAGE);
}

export { GITHUB_RELEASES_PAGE as releasesPageUrl };
