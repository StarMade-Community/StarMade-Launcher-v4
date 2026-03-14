import fs from 'fs';
import path from 'path';
import { app } from 'electron';

// ─── Schema ──────────────────────────────────────────────────────────────────

/**
 * Current schema version.  Bump this whenever a breaking structural change is
 * made to the store layout and add a corresponding migration block below.
 */
const STORE_VERSION = 1;

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
    // Future migrations go here, e.g.:
    // if (version < 2) { stored.newField = 'defaultValue'; }
    stored.__version = STORE_VERSION;
  }
  return stored;
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

