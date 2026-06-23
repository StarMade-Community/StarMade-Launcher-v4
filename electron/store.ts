import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { resolveManagedInstallPath } from './install-paths.js';

// ─── Schema ──────────────────────────────────────────────────────────────────

/**
 * Current schema version.  Bump this whenever a breaking structural change is
 * made to the store layout and add a corresponding migration block below.
 */
const STORE_VERSION = 2;

/**
 * Stable, user-writable root that relative installation paths resolve against.
 *
 * Returns `<Documents>/My Games`, so the legacy default `./StarMade/Installations`
 * resolves to `<Documents>/My Games/StarMade/Installations` — a visible location
 * that survives the Windows portable build's temp-directory teardown.
 *
 * This mirrors the resolution performed by the main process; keep the two in
 * sync if the managed root ever changes.
 */
export function getManagedInstallRoot(): string {
  return path.join(app.getPath('documents'), 'My Games');
}

interface StoreData {
  __version: number;
  [key: string]: unknown;
}

// ─── Internal state ──────────────────────────────────────────────────────────

let _storePath: string | null = null;
let _data: StoreData = { __version: STORE_VERSION };

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getStorePath(): string {
  if (!_storePath) {
    _storePath = path.join(app.getPath('userData'), 'launcher-store.json');
  }
  return _storePath;
}

function load(): void {
  try {
    const filePath = getStorePath();
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw) as StoreData;
      _data = migrate(parsed);
    }
  } catch (err) {
    console.error('[store] Failed to load store, starting fresh:', err);
    _data = { __version: STORE_VERSION };
  }
}

function save(): void {
  try {
    const filePath = getStorePath();
    const tmpPath = `${filePath}.tmp`;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(tmpPath, JSON.stringify(_data, null, 2), 'utf-8');
    // Atomic replace: write to temp file first, then rename
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    console.error('[store] Failed to save store:', err);
  }
}

// ─── Migration ───────────────────────────────────────────────────────────────

/**
 * Apply sequential version-to-version migrations so that data written by an
 * older launcher version remains usable after an upgrade.
 */
function migrate(stored: StoreData): StoreData {
  const version = typeof stored.__version === 'number' ? stored.__version : 0;
  if (version < STORE_VERSION) {
    if (version < 2) {
      // v2: convert relative installation/server paths (and the default game
      // directory) to absolute paths.  Earlier builds persisted the relative
      // `./StarMade/Installations` default, which resolved against the process
      // working directory — the throwaway temp dir on the Windows portable
      // build — so downloaded files vanished on reboot.
      migrateRelativePathsToAbsolute(stored);
    }
    stored.__version = STORE_VERSION;
  }
  return stored;
}

/**
 * Rewrite any relative managed paths in the store to absolute paths rooted at
 * {@link getManagedInstallRoot}.  Absolute paths are left untouched, so the
 * pass is idempotent and safe for records the user explicitly placed elsewhere.
 */
function migrateRelativePathsToAbsolute(stored: StoreData): void {
  const managedRoot = getManagedInstallRoot();

  // Installations and servers: rewrite each record's `path`.
  for (const key of ['installations', 'servers']) {
    const items = stored[key];
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      if (item && typeof item === 'object' && typeof (item as { path?: unknown }).path === 'string') {
        const record = item as { path: string };
        const trimmed = record.path.trim();
        if (trimmed !== '' && !path.isAbsolute(trimmed)) {
          record.path = resolveManagedInstallPath(record.path, managedRoot);
        }
      }
    }
  }

  // Default settings: rewrite the persisted `gameDir` parent directory.
  for (const key of ['defaultInstallationSettings', 'defaultServerSettings']) {
    const settings = stored[key];
    if (settings && typeof settings === 'object' && typeof (settings as { gameDir?: unknown }).gameDir === 'string') {
      const record = settings as { gameDir: string };
      const trimmed = record.gameDir.trim();
      if (trimmed !== '' && !path.isAbsolute(trimmed)) {
        record.gameDir = resolveManagedInstallPath(record.gameDir, managedRoot);
      }
    }
  }
}

// ─── Initialise ──────────────────────────────────────────────────────────────

// Load persisted data the first time this module is imported by main.ts
load();

// ─── Public API ──────────────────────────────────────────────────────────────

export function storeGet(key: string): unknown {
  return _data[key];
}

export function storeSet(key: string, value: unknown): void {
  _data[key] = value;
  save();
}

export function storeDelete(key: string): void {
  delete _data[key];
  save();
}

/**
 * Wipe all persisted data and write an empty (version-only) store to disk.
 * The caller is responsible for relaunching the app afterwards so that all
 * in-memory module state is also reset.
 */
export function storeClearAll(): void {
  _data = { __version: STORE_VERSION };
  save();
}

