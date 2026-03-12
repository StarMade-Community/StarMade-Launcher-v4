/**
 * Game file downloader for the StarMade CDN.
 *
 * Download flow (mirrors v2 launcher `src/services/updater.coffee`):
 *   1. Fetch the checksum manifest for the chosen build path.
 *   2. For each listed file, compare its SHA-1 against the local copy.
 *   3. Download every file that is missing or has a mismatched checksum.
 *   4. Report progress back to the renderer via callbacks.
 *
 * Checksum manifest format (one entry per line):
 *   ./relative/path  SIZE_BYTES  SHA1_HEX
 *
 * Reference: v2 launcher `src/services/Checksum.coffee`
 */

import http  from 'http';
import fs    from 'fs';
import path  from 'path';
import crypto from 'crypto';

// ─── Constants ────────────────────────────────────────────────────────────────

const BASE_URL    = 'http://files.star-made.org';
/** Maximum concurrent file downloads. */
const CONCURRENCY = 3;

// ─── Types ────────────────────────────────────────────────────────────────────

interface ChecksumEntry {
  relativePath: string;
  size: number;
  checksum: string;
}

export interface DownloadProgress {
  installationId: string;
  phase: 'checksums' | 'downloading';
  percent: number;
  bytesReceived: number;
  totalBytes: number;
  filesDownloaded: number;
  totalFiles: number;
  currentFile: string;
}

interface DownloadSession {
  cancelled: boolean;
  activeRequests: Set<http.ClientRequest>;
}

// ─── Active sessions ─────────────────────────────────────────────────────────

const activeSessions = new Map<string, DownloadSession>();

// ─── HTTP helper ──────────────────────────────────────────────────────────────

function httpGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: 15_000 }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} fetching ${url}`));
        res.resume();
        return;
      }
      let data = '';
      res.setEncoding('utf-8');
      res.on('data', (chunk: string) => { data += chunk; });
      res.on('end',  () => resolve(data));
      res.on('error', reject);
    });
    req.on('error',   reject);
    req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout: ${url}`)); });
  });
}

// ─── Checksum manifest parsing ────────────────────────────────────────────────

function parseChecksums(text: string): ChecksumEntry[] {
  const entries: ChecksumEntry[] = [];

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Format: ./path/to/file  SIZE  SHA1
    // Use lastIndexOf so that paths with spaces are handled safely.
    const lastSpace        = trimmed.lastIndexOf(' ');
    if (lastSpace < 0) continue;

    const checksum         = trimmed.substring(lastSpace + 1).trim();
    const rest             = trimmed.substring(0, lastSpace).trim();
    const secondLastSpace  = rest.lastIndexOf(' ');
    if (secondLastSpace < 0) continue;

    const sizeStr          = rest.substring(secondLastSpace + 1).trim();
    const size             = parseFloat(sizeStr);
    const relativePath     = rest.substring(0, secondLastSpace).trim();

    if (relativePath && !isNaN(size) && checksum) {
      entries.push({ relativePath, size, checksum });
    }
  }

  return entries;
}

// ─── Local file SHA-1 verification ───────────────────────────────────────────

function sha1File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash   = crypto.createHash('sha1');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data',  (chunk: Buffer | string) => hash.update(chunk));
    stream.on('end',   () => resolve(hash.digest('hex')));
  });
}

async function needsDownload(filePath: string, expectedChecksum: string): Promise<boolean> {
  try {
    if (!fs.existsSync(filePath)) return true;
    const actual = await sha1File(filePath);
    return actual !== expectedChecksum;
  } catch {
    return true;
  }
}

// ─── Single-file download ─────────────────────────────────────────────────────

function downloadFile(
  session:  DownloadSession,
  url:      string,
  destPath: string,
  onBytes:  (n: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (session.cancelled) { reject(new Error('Cancelled')); return; }

    try {
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
    } catch (err) {
      reject(err);
      return;
    }

    const tmpPath     = `${destPath}.tmp`;
    const writeStream = fs.createWriteStream(tmpPath);

    const req = http.get(url, { timeout: 60_000 }, (res) => {
      if (res.statusCode !== 200) {
        writeStream.destroy();
        try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
        reject(new Error(`HTTP ${res.statusCode} downloading ${url}`));
        res.resume();
        return;
      }

      res.on('data', (chunk: Buffer) => { onBytes(chunk.length); });
      res.on('error', (err) => {
        writeStream.destroy();
        try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
        reject(err);
      });

      writeStream.on('error', (err) => {
        try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
        reject(err);
      });

      writeStream.on('finish', () => {
        if (session.cancelled) {
          try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
          reject(new Error('Cancelled'));
          return;
        }
        try {
          fs.renameSync(tmpPath, destPath); // atomic replace
          resolve();
        } catch (err) {
          reject(err);
        }
      });

      res.pipe(writeStream);
    });

    req.on('error', (err) => {
      writeStream.destroy();
      try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
      reject(err);
    });

    req.on('timeout', () => {
      req.destroy();
      writeStream.destroy();
      try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
      reject(new Error('Download timed out'));
    });

    session.activeRequests.add(req);
    req.on('close', () => session.activeRequests.delete(req));
  });
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Download (or update) the game files for a given build path into `targetDir`.
 *
 * @param installationId  Opaque identifier forwarded in every progress event.
 * @param buildPath       CDN-relative build path, e.g. `./build/starmade-build_20231020_123456`.
 * @param targetDir       Absolute path to the local installation directory.
 * @param onProgress      Called repeatedly with live progress data.
 * @param onComplete      Called once all files are downloaded and verified.
 * @param onError         Called if a non-cancellation error occurs.
 */
export async function startDownload(
  installationId: string,
  buildPath:      string,
  targetDir:      string,
  onProgress:     (p: DownloadProgress) => void,
  onComplete:     () => void,
  onError:        (message: string) => void,
): Promise<void> {
  // Abort any existing session for this installation
  cancelDownload(installationId);

  const session: DownloadSession = { cancelled: false, activeRequests: new Set() };
  activeSessions.set(installationId, session);

  const emit = (phase: DownloadProgress['phase'], partial: Omit<DownloadProgress, 'installationId' | 'phase'>) => {
    onProgress({ installationId, phase, ...partial });
  };

  try {
    // ── Step 1: Fetch checksum manifest ─────────────────────────────────────
    const cleanBuild  = buildPath.replace(/^\.\//, '');
    const checksumUrl = `${BASE_URL}/${cleanBuild}/checksums`;

    emit('checksums', { percent: 0, bytesReceived: 0, totalBytes: 0, filesDownloaded: 0, totalFiles: 0, currentFile: 'Fetching checksums…' });

    if (session.cancelled) throw new Error('Cancelled');

    const checksumText = await httpGet(checksumUrl);
    const entries      = parseChecksums(checksumText);

    if (entries.length === 0) throw new Error('Checksum manifest is empty or could not be parsed');

    // ── Step 2: Verify local copies ──────────────────────────────────────────
    emit('checksums', { percent: 0, bytesReceived: 0, totalBytes: 0, filesDownloaded: 0, totalFiles: entries.length, currentFile: 'Verifying local files…' });

    const toDownload: ChecksumEntry[] = [];
    for (let i = 0; i < entries.length; i++) {
      if (session.cancelled) throw new Error('Cancelled');

      const entry        = entries[i];
      const cleanRelPath = entry.relativePath.replace(/^\.\//, '');
      const localPath    = path.join(targetDir, ...cleanRelPath.split('/'));

      if (await needsDownload(localPath, entry.checksum)) toDownload.push(entry);

      // Emit periodic verification progress
      if (i % 20 === 0 || i === entries.length - 1) {
        const pct = Math.floor(((i + 1) / entries.length) * 100);
        emit('checksums', { percent: pct, bytesReceived: 0, totalBytes: 0, filesDownloaded: 0, totalFiles: entries.length, currentFile: `Verifying… (${i + 1}/${entries.length})` });
      }
    }

    if (session.cancelled) throw new Error('Cancelled');

    if (toDownload.length === 0) {
      emit('downloading', { percent: 100, bytesReceived: 0, totalBytes: 0, filesDownloaded: 0, totalFiles: 0, currentFile: 'Already up to date' });
      onComplete();
      activeSessions.delete(installationId);
      return;
    }

    // ── Step 3: Download missing / changed files ──────────────────────────
    const totalBytes = toDownload.reduce((sum, e) => sum + e.size, 0);
    let bytesReceived  = 0;
    let filesDownloaded = 0;

    const emitProgress = (currentFile: string) => {
      const percent = totalBytes > 0 ? Math.min(99, Math.floor((bytesReceived / totalBytes) * 100)) : 0;
      emit('downloading', { percent, bytesReceived, totalBytes, filesDownloaded, totalFiles: toDownload.length, currentFile });
    };

    emitProgress('Starting download…');

    // Limited-concurrency worker pool
    const queue: ChecksumEntry[] = [...toDownload];

    const runWorker = async (): Promise<void> => {
      while (queue.length > 0) {
        if (session.cancelled) throw new Error('Cancelled');

        const entry        = queue.shift()!;
        const cleanRelPath = entry.relativePath.replace(/^\.\//, '');
        const fileUrl      = `${BASE_URL}/${cleanBuild}/${cleanRelPath}`;
        const localPath    = path.join(targetDir, ...cleanRelPath.split('/'));

        emitProgress(cleanRelPath);

        await downloadFile(session, fileUrl, localPath, (bytes) => {
          bytesReceived += bytes;
          emitProgress(cleanRelPath);
        });

        filesDownloaded++;
        emitProgress(cleanRelPath);
      }
    };

    const workers: Promise<void>[] = [];
    const concurrency = Math.min(CONCURRENCY, toDownload.length);
    for (let i = 0; i < concurrency; i++) workers.push(runWorker());

    await Promise.all(workers);

    if (session.cancelled) throw new Error('Cancelled');

    emit('downloading', { percent: 100, bytesReceived, totalBytes, filesDownloaded, totalFiles: toDownload.length, currentFile: 'Download complete' });
    onComplete();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg !== 'Cancelled') {
      onError(msg);
    }
  } finally {
    activeSessions.delete(installationId);
  }
}

/** Abort an in-progress download session. Safe to call if no session is active. */
export function cancelDownload(installationId: string): void {
  const session = activeSessions.get(installationId);
  if (!session) return;

  session.cancelled = true;
  for (const req of session.activeRequests) {
    try { req.destroy(); } catch { /* ignore */ }
  }
  activeSessions.delete(installationId);
}

/** Returns true if a download is currently running for the given installation. */
export function isDownloading(installationId: string): boolean {
  return activeSessions.has(installationId);
}

