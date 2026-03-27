/**
 * Launcher self-update checker and installer.
 *
 * Flow:
 *  1. Query GitHub Releases API for the latest version tag.
 *  2. Compare against the running app version.
 *  3. If newer: find the platform-appropriate asset (portable .exe on Windows,
 *     AppImage on Linux), download it to a temp file with live progress
 *     callbacks, then execute/replace the launcher.
 *  4. If anything fails, open the releases page in the browser as a fallback.
 *
 * macOS is intentionally excluded from silent install because code-signing and
 * notarisation make DMG silent-install impractical without a paid certificate.
 * On macOS, an update check that finds a newer version opens the releases page
 * in the browser so the user can download the DMG manually.
 */

import { app, shell } from 'electron';
import https from 'https';
import http  from 'http';
import fs    from 'fs';
import path  from 'path';
import os    from 'os';
import { spawn, type SpawnOptions } from 'child_process';

// ─── Constants ────────────────────────────────────────────────────────────────

const GITHUB_RELEASES_API =
  'https://api.github.com/repos/StarMade-Community/StarMade-Launcher-v4/releases/latest';

/** Endpoint returning ALL releases (including pre-releases), newest first. */
const GITHUB_ALL_RELEASES_API =
  'https://api.github.com/repos/StarMade-Community/StarMade-Launcher-v4/releases';

const GITHUB_RELEASES_PAGE =
  'https://github.com/StarMade-Community/StarMade-Launcher-v4/releases/latest';

/** Request timeout in milliseconds. */
const TIMEOUT_MS = 30_000;

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
  /** Direct download URL for the platform-appropriate installer asset, if found. */
  assetUrl?: string;
  /** Display name of the asset (e.g. "StarMade-Launcher.exe"). */
  assetName?: string;
  /** Whether this release is a GitHub pre-release. */
  isPreRelease?: boolean;
}

export interface DownloadProgress {
  bytesReceived: number;
  totalBytes: number;
  percent: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Compare two semver strings.
 * Returns -1 if a < b, 0 if equal, 1 if a > b.
 */
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
 * Pick the best installer asset for the current platform from a list of
 * GitHub release assets.
 *
 * Windows → .exe (portable executable)
 * Linux   → .AppImage
 * macOS   → not supported for silent install; returns undefined
 */
function pickAsset(
  assets: Array<{ name: string; browser_download_url: string }>
): { name: string; browser_download_url: string } | undefined {
  const plat = process.platform;

  if (plat === 'win32') {
    return assets.find(a => /\.exe$/i.test(a.name)) ?? undefined;
  }

  if (plat === 'linux') {
    return assets.find(a => /\.AppImage$/i.test(a.name)) ?? undefined;
  }

  // macOS – no silent install
  return undefined;
}

/**
 * Perform a GET request that follows redirects and returns a Node.js
 * IncomingMessage stream.  Resolves once the final response is received.
 */
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

    const req = lib.get(url, { timeout: TIMEOUT_MS }, res => {
      if (
        res.statusCode &&
        res.statusCode >= 300 &&
        res.statusCode < 400 &&
        res.headers.location
      ) {
        res.resume(); // drain
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

/** Resolve PowerShell path explicitly for environments where PATH is restricted. */
function resolvePowerShellPath(): string {
  const systemRoot = process.env.SystemRoot || process.env.WINDIR;
  if (systemRoot) {
    const candidate = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    if (fs.existsSync(candidate)) return candidate;
  }
  return 'powershell.exe';
}

/**
 * Launch a detached child and resolve only once the process has successfully
 * spawned.  If spawn fails (e.g. executable not found), reject so callers can
 * avoid quitting the current app instance.
 */
async function spawnDetachedAndConfirm(
  command: string,
  args: string[],
  options: SpawnOptions,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, options);
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Check GitHub releases for a newer version of the launcher.
 *
 * @param options.includePreReleases  When `true`, the latest release
 *   (including pre-releases) is compared against the running version.
 *   When `false` (default), only stable releases are considered.
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
      // All-releases endpoint returns an array; pick the first non-draft entry
      // (GitHub returns releases sorted newest-published-at first).
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

  // Try to locate a direct-download asset for the current platform
  let assetUrl: string | undefined;
  let assetName: string | undefined;

  if (available && Array.isArray(release.assets)) {
    const picked = pickAsset(
      release.assets as Array<{ name: string; browser_download_url: string }>
    );
    if (picked) {
      assetUrl  = picked.browser_download_url;
      assetName = picked.name;
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
 * Download an update asset to the OS temp directory, reporting progress via
 * the supplied callback.
 *
 * @returns The absolute path to the downloaded file.
 */
export async function downloadUpdate(
  assetUrl: string,
  assetName: string,
  onProgress: (progress: DownloadProgress) => void
): Promise<string> {
  const destPath = path.join(os.tmpdir(), assetName);

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

  return destPath;
}

/**
 * Install (execute) a downloaded update file.
 *
 * • Windows portable .exe → wait for the current process to exit via a
 *                           PowerShell helper script, copy the new exe over
 *                           the current one, then relaunch.
 * • Linux AppImage        → make executable, replace the running binary with
 *                           the new one (via a shell wrapper), then relaunch.
 * • macOS              → opens the GitHub releases page in the browser so
 *                         the user can download the DMG manually (code-signing
 *                         is required for silent DMG install and is not yet
 *                         set up).
 *
 * Falls back to opening the releases page on any unexpected error.
 */
export async function installUpdate(installerPath: string): Promise<void> {
  const plat = process.platform;

  // macOS requires code-signing & notarisation for a silent install, which
  // isn't set up yet.  Just open the releases page so the user can grab the
  // DMG manually.
  if (plat === 'darwin') {
    await shell.openExternal(GITHUB_RELEASES_PAGE);
    return;
  }

  try {
    if (plat === 'win32') {
      if (!installerPath || !fs.existsSync(installerPath)) {
        throw new Error(`Downloaded update file is missing: ${installerPath}`);
      }

      // Write a PowerShell helper script that waits for the current process to
      // exit, copies the new exe over the current one, then relaunches it.
      //
      // Paths are passed via environment variables to avoid any shell-injection
      // risk from special characters in file paths.  A random suffix on the
      // script name prevents predictable temp-file collisions.
      //
      // IMPORTANT: When running as an electron-builder portable executable,
      // the app self-extracts to a temporary directory at runtime.
      // app.getPath('exe') therefore returns the path to the *extracted* binary
      // inside that temp dir — NOT the original portable .exe the user placed
      // on disk.  electron-builder sets PORTABLE_EXECUTABLE_FILE to the real
      // on-disk path of the portable .exe, so we must use that when available.
      const currentExe = process.env.PORTABLE_EXECUTABLE_FILE || app.getPath('exe');

      const uniqueSuffix = Math.random().toString(36).slice(2);
      const scriptPath = path.join(os.tmpdir(), `starmade-update-${uniqueSuffix}.ps1`);
      const script = [
        `$src        = $env:UPDATE_SRC`,
        `$dst        = $env:UPDATE_DST`,
        `$procId     = [int]$env:UPDATE_PID`,
        `$scriptPath = $env:UPDATE_SCRIPT`,
        `$logPath    = Join-Path $env:TEMP 'starmade-update-error.log'`,
        `$backup     = "$dst.old"`,
        ``,
        `try {`,
        `  # Wait for inner Electron process to exit`,
        `  $intervalMs = 500`,
        `  $maxWaitMs  = 300000`,
        `  $elapsedMs  = 0`,
        `  while ((Get-Process -Id $procId -ErrorAction SilentlyContinue) -and ($elapsedMs -lt $maxWaitMs)) {`,
        `    Start-Sleep -Milliseconds $intervalMs`,
        `    $elapsedMs += $intervalMs`,
        `  }`,
        `  if (Get-Process -Id $procId -ErrorAction SilentlyContinue) {`,
        `    throw "Process $procId did not exit within timeout."`,
        `  }`,
        ``,
        `  # The outer NSIS portable wrapper may still hold the exe file mapped while`,
        `  # doing cleanup. Move-Item (rename) works even on running executables because`,
        `  # Windows opens them with FILE_SHARE_DELETE. After rename, $dst is free.`,
        `  if (Test-Path $backup) { Remove-Item -Force $backup -ErrorAction SilentlyContinue }`,
        `  $maxAttempts = 10`,
        `  $attempt = 0`,
        `  $moved = $false`,
        `  while (-not $moved -and $attempt -lt $maxAttempts) {`,
        `    try {`,
        `      Move-Item -Path $dst -Destination $backup -Force -ErrorAction Stop`,
        `      $moved = $true`,
        `    } catch {`,
        `      $attempt++`,
        `      Start-Sleep -Milliseconds 500`,
        `    }`,
        `  }`,
        `  if (-not $moved) { throw "Could not rename current exe after $maxAttempts attempts." }`,
        ``,
        `  # Copy new exe to original path; restore backup if this fails`,
        `  try {`,
        `    Copy-Item -Force $src $dst -ErrorAction Stop`,
        `  } catch {`,
        `    if ((Test-Path $backup) -and -not (Test-Path $dst)) {`,
        `      Move-Item -Path $backup -Destination $dst -Force -ErrorAction SilentlyContinue`,
        `    }`,
        `    throw`,
        `  }`,
        ``,
        `  Remove-Item -Force $backup -ErrorAction SilentlyContinue`,
        `} catch {`,
        `  Add-Content -Path $logPath -Value "$(Get-Date -Format o) - $($_.Exception.Message)" -ErrorAction SilentlyContinue`,
        `}`,
        ``,
        `# Always relaunch regardless of update success/failure`,
        `Start-Process $dst`,
        `Remove-Item -Force $scriptPath -ErrorAction SilentlyContinue`,
      ].join('\n');

      fs.writeFileSync(scriptPath, script);

      const powershellPath = resolvePowerShellPath();

      await spawnDetachedAndConfirm(powershellPath, [
        '-WindowStyle', 'Hidden',
        '-ExecutionPolicy', 'Bypass',
        '-File', scriptPath,
      ], {
        detached: true,
        stdio: 'ignore',
        env: {
          ...process.env,
          UPDATE_SRC: installerPath,
          UPDATE_DST: currentExe,
          UPDATE_PID: String(process.pid),
          UPDATE_SCRIPT: scriptPath,
        },
      });

      app.quit();
      return;
    }

    if (plat === 'linux') {
      // Make the AppImage executable
      fs.chmodSync(installerPath, 0o755);

      // When running as an AppImage, app.getPath('exe') returns the Electron
      // binary path *inside* the read-only squashfs mount (e.g.
      // /tmp/.mount_StarMaXXXX/starmade-launcher-v4.bin), not the .AppImage
      // file itself.  Copying to that path fails because the squashfs is
      // read-only, and after app.quit() the mount is torn down so the exec
      // also fails — leaving the old AppImage untouched and causing the update
      // prompt to reappear on every launch.
      //
      // The AppImage runtime always sets APPIMAGE to the path of the actual
      // .AppImage file on disk, so use that when available and fall back to
      // app.getPath('exe') for non-AppImage Linux installs (deb, rpm, etc.).
      const currentExe = process.env.APPIMAGE || app.getPath('exe');

      // Write a tiny shell script that waits for us to exit, then replaces
      // the current executable and relaunches it.
      const scriptPath = path.join(os.tmpdir(), 'starmade-update.sh');
      const script = [
        '#!/bin/sh',
        `# Wait until the old launcher process has exited`,
        `while kill -0 ${process.pid} 2>/dev/null; do sleep 0.5; done`,
        `cp -f "${installerPath}" "${currentExe}"`,
        `chmod +x "${currentExe}"`,
        `"${currentExe}" &`,
      ].join('\n');

      fs.writeFileSync(scriptPath, script, { mode: 0o755 });

      spawn('/bin/sh', [scriptPath], {
        detached: true,
        stdio: 'ignore',
      }).unref();

      app.quit();
      return;
    }

    // macOS or unhandled platform – open the browser fallback
    await shell.openExternal(GITHUB_RELEASES_PAGE);
  } catch (err) {
    console.error('[Updater] installUpdate failed, opening browser fallback:', err);
    await shell.openExternal(GITHUB_RELEASES_PAGE);
  }
}

/**
 * Open the GitHub releases page in the user's default browser.
 */
export function openReleasesPage(): void {
  shell.openExternal(GITHUB_RELEASES_PAGE);
}

export { GITHUB_RELEASES_PAGE as releasesPageUrl };
