/**
 * Game file downloader for the StarMade CDN.
 *
 * Download flow (mirrors v2 launcher `src/services/updater.coffee`):
 *   1. Fetch the checksum manifest for the chosen build path.
 *   2. For each listed file, compare its SHA-1 against the local copy.
 *   3. Download every file that is missing or has a mismatched checksum,
 *      retrying with HTTP Range resume and verifying the SHA-1 before the
 *      file is moved into place.
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
/** Overridable so tests (and mirrors) can point elsewhere. Read per-call. */
const baseUrl = () => process.env.STARMADE_CDN_URL || BASE_URL;
/** Maximum concurrent file downloads. */
const CONCURRENCY = 3;
/** Attempts per file before giving up (transient network errors are common). */
const MAX_ATTEMPTS = 3;

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

const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

function downloadFile(
  session:          DownloadSession,
  url:              string,
  destPath:         string,
  expectedSize:     number,
  expectedChecksum: string,
  resumeFrom:       number,
  onTotalBytes:     (total: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (session.cancelled) { reject(new Error('Cancelled')); return; }

    try {
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
    } catch (err) {
      reject(err);
      return;
    }

    const tmpPath = `${destPath}.tmp`;
    let writeStream: fs.WriteStream | null = null;
    let settled = false;

    // The partial `.tmp` is deliberately left in place: the next attempt
    // resumes from it. Only `downloadWithRetry` decides when to discard one.
    // `end()` rather than `destroy()` so buffered bytes reach disk and the
    // resume starts from the true offset; `settled` keeps the resulting
    // 'finish' event from resolving a download that actually failed.
    const fail = (err: Error, flush = true) => {
      if (settled) return;
      settled = true;
      if (flush && writeStream && !writeStream.destroyed) writeStream.end();
      else writeStream?.destroy();
      reject(err);
    };

    /** Size check, then SHA-1, then the atomic rename into place. */
    const finalise = async (): Promise<void> => {
      const actualSize = fs.statSync(tmpPath).size;
      if (expectedSize > 0 && actualSize !== expectedSize) {
        // A connection dropped mid-transfer can still close the stream
        // cleanly, so the byte count is the first thing to check.
        throw new Error(`Incomplete download (${actualSize} of ${expectedSize} bytes)`);
      }
      if (expectedChecksum) {
        const actual = await sha1File(tmpPath);
        if (actual !== expectedChecksum) {
          throw new Error(`Checksum mismatch (expected ${expectedChecksum}, got ${actual})`);
        }
      }
      fs.renameSync(tmpPath, destPath); // atomic replace
    };

    const req = http.get(
      url,
      {
        timeout: 60_000,
        headers: resumeFrom > 0 ? { Range: `bytes=${resumeFrom}-` } : {},
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status !== 200 && status !== 206) {
          fail(new Error(`HTTP ${status} downloading ${url}`));
          res.resume();
          return;
        }

        // 206 means the server honoured the Range header. A plain 200 in reply
        // to a Range request means it ignored it and is resending the whole
        // file, so the partial must be overwritten rather than appended to.
        const offset = status === 206 ? resumeFrom : 0;

        writeStream = fs.createWriteStream(tmpPath, { flags: offset > 0 ? 'a' : 'w' });
        // Registered before any write: the stream can fail (EACCES, ENOSPC, a
        // Windows file lock) and an unhandled 'error' event would take down
        // the whole main process.
        // Don't try to flush a stream that is itself the thing that failed.
        writeStream.on('error', (err) => fail(err, false));

        let received = 0;
        res.on('data', (chunk: Buffer) => {
          received += chunk.length;
          onTotalBytes(offset + received);
        });
        res.on('error', fail);

        writeStream.on('finish', () => {
          if (settled) return;
          if (session.cancelled) { settled = true; reject(new Error('Cancelled')); return; }

          finalise()
            .then(() => { settled = true; resolve(); })
            .catch(fail);
        });

        res.pipe(writeStream);
      },
    );

    req.on('error', fail);

    req.on('timeout', () => {
      req.destroy();
      fail(new Error('Download timed out'));
    });

    session.activeRequests.add(req);
    req.on('close', () => session.activeRequests.delete(req));
  });
}

/**
 * `downloadFile` with bounded retries, resuming from whatever the previous
 * attempt managed to write. A leftover `.tmp` from an earlier launcher run is
 * resumed too — if it turns out to be stale, the SHA-1 check rejects it and the
 * next attempt starts clean.
 *
 * Client errors (HTTP 4xx) are terminal; retrying a 404 never helps.
 */
async function downloadWithRetry(
  session:          DownloadSession,
  url:              string,
  destPath:         string,
  expectedSize:     number,
  expectedChecksum: string,
  onBytes:          (n: number) => void,
): Promise<void> {
  const tmpPath = `${destPath}.tmp`;

  // `downloadFile` reports absolute per-file totals; the caller counts deltas.
  let credited = 0;
  const report = (total: number) => { onBytes(total - credited); credited = total; };

  const discardPartial = () => { try { fs.unlinkSync(tmpPath); } catch { /* ignore */ } };

  for (let attempt = 1; ; attempt++) {
    let resumeFrom = 0;
    try {
      const size = fs.statSync(tmpPath).size;
      // An over-long partial can only be junk — a truncated manifest entry or a
      // stale file from another build.
      if (expectedSize > 0 && size >= expectedSize) discardPartial();
      else resumeFrom = size;
    } catch { /* no partial to resume */ }

    report(resumeFrom);

    try {
      await downloadFile(session, url, destPath, expectedSize, expectedChecksum, resumeFrom, report);
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);

      // A hash mismatch means the bytes on disk are wrong, not merely
      // incomplete — resuming from them would fail forever.
      if (msg.startsWith('Checksum mismatch')) {
        discardPartial();
        report(0);
      }

      if (session.cancelled || msg === 'Cancelled' || attempt >= MAX_ATTEMPTS || /^HTTP 4/.test(msg)) {
        throw err;
      }
      console.warn(`[downloader] attempt ${attempt}/${MAX_ATTEMPTS} failed for ${url}: ${msg}`);
      await delay(500 * 2 ** (attempt - 1));
    }
  }
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
    const checksumUrl = `${baseUrl()}/${cleanBuild}/checksums`;

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

    // Sweep orphaned `.tmp` files: partials are kept after a failure so the
    // next run can resume them, but one whose file is now verified good — or
    // that belongs to a path this build no longer ships — is dead weight.
    const resumable = new Set(
      toDownload.map(e => path.join(targetDir, ...e.relativePath.replace(/^\.\//, '').split('/')) + '.tmp'),
    );
    try {
      for (const rel of fs.readdirSync(targetDir, { recursive: true }) as string[]) {
        if (!rel.endsWith('.tmp')) continue;
        const tmpPath = path.join(targetDir, rel);
        if (!resumable.has(tmpPath)) fs.rmSync(tmpPath, { force: true });
      }
    } catch (err) {
      console.warn('[downloader] could not sweep .tmp files:', err);
    }

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
        const fileUrl      = `${baseUrl()}/${cleanBuild}/${cleanRelPath}`;
        const localPath    = path.join(targetDir, ...cleanRelPath.split('/'));

        emitProgress(cleanRelPath);

        try {
          await downloadWithRetry(session, fileUrl, localPath, entry.size, entry.checksum, (bytes) => {
            bytesReceived += bytes;
            emitProgress(cleanRelPath);
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg === 'Cancelled') throw err;
          throw new Error(`${cleanRelPath}: ${msg}`);
        }

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
      // Stop the sibling workers first: their in-flight progress events would
      // otherwise arrive after onError and overwrite the error state, leaving
      // the UI stuck on a frozen progress bar with no reason shown.
      cancelDownload(installationId);
      console.error(`[downloader] ${installationId} failed:`, msg);
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

