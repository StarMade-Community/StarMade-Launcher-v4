/**
 * Launcher settings & user-data backup / restore utilities.
 *
 * Backups are stored as timestamped copies of the Electron userData directory
 * inside a sibling `StarMade-Launcher-Backups` folder under appData.
 * The folder layout is:
 *
 *   <appData>/
 *     StarMade Launcher v4/          ← Electron userData (live)
 *     StarMade-Launcher-Backups/
 *       2025-06-01T12-00-00-000Z/    ← timestamped snapshot
 *       2025-06-02T08-30-00-000Z/
 *
 * Keeping backups outside the live userData directory prevents them from
 * being overwritten when a restore is performed.
 */

import fs   from 'fs';
import path from 'path';
import { app } from 'electron';

// ─── Constants ────────────────────────────────────────────────────────────────

const BACKUP_DIR_NAME = 'StarMade-Launcher-Backups';

/** Maximum number of automatic backups to retain before pruning the oldest. */
const MAX_BACKUPS = 10;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BackupEntry {
  /** Backup identifier (ISO timestamp with colons replaced by hyphens). */
  name: string;
  /** Absolute path to the backup directory. */
  path: string;
  /** Human-readable creation date (ISO 8601). */
  date: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getBackupDir(): string {
  return path.join(app.getPath('appData'), BACKUP_DIR_NAME);
}

/**
 * Recursively copy all files and directories from `src` to `dest`.
 * `dest` is created if it does not exist.
 */
function copyDirRecursive(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath  = path.join(src,  entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Delete the oldest backups when the total count exceeds `MAX_BACKUPS`.
 */
function pruneOldBackups(): void {
  try {
    const backupDir = getBackupDir();
    if (!fs.existsSync(backupDir)) return;
    const entries = fs.readdirSync(backupDir, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name)
      .sort(); // ISO timestamps sort lexicographically → oldest first

    while (entries.length > MAX_BACKUPS) {
      const oldest = entries.shift()!;
      fs.rmSync(path.join(backupDir, oldest), { recursive: true, force: true });
    }
  } catch {
    // Non-fatal — pruning is best-effort
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Create a timestamped backup of the launcher's userData directory.
 * Returns the path to the newly created backup directory on success.
 */
export async function createBackup(): Promise<{ success: boolean; backupPath?: string; error?: string }> {
  try {
    const userDataPath = app.getPath('userData');
    const backupDir    = getBackupDir();

    // ISO timestamp with filesystem-safe characters
    const timestamp  = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(backupDir, timestamp);

    fs.mkdirSync(backupPath, { recursive: true });
    copyDirRecursive(userDataPath, backupPath);

    pruneOldBackups();

    return { success: true, backupPath };
  } catch (err) {
    console.error('[backup] createBackup failed:', err);
    return { success: false, error: String(err) };
  }
}

/**
 * List all available backups, newest first.
 */
export async function listBackups(): Promise<BackupEntry[]> {
  try {
    const backupDir = getBackupDir();
    if (!fs.existsSync(backupDir)) return [];

    const entries = fs.readdirSync(backupDir, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name)
      .sort()
      .reverse(); // newest first

    return entries.map(name => ({
      name,
      path: path.join(backupDir, name),
      // Convert the filename back to a readable ISO date string
      date: name.replace(
        /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/,
        '$1-$2-$3T$4:$5:$6.$7Z',
      ),
    }));
  } catch (err) {
    console.error('[backup] listBackups failed:', err);
    return [];
  }
}

/**
 * Restore a backup by copying it over the live userData directory.
 * The caller is responsible for restarting the app afterwards so that
 * re-loaded modules pick up the restored data.
 *
 * @param backupPath  Absolute path to the backup directory to restore.
 */
export async function restoreBackup(backupPath: string): Promise<{ success: boolean; error?: string }> {
  try {
    if (!fs.existsSync(backupPath)) {
      return { success: false, error: `Backup not found: ${backupPath}` };
    }

    const userDataPath = app.getPath('userData');
    copyDirRecursive(backupPath, userDataPath);

    return { success: true };
  } catch (err) {
    console.error('[backup] restoreBackup failed:', err);
    return { success: false, error: String(err) };
  }
}
