import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// ─── Mock electron before importing store ─────────────────────────────────────

const mockUserDataPath = path.join(os.tmpdir(), 'starmade-launcher-test-store');

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((_key: string) => mockUserDataPath),
  },
}));

// ─── We need a fresh module for each test because store.ts initialises
//     _data at module load time via the top-level `load()` call.
//     Re-importing after clearing the store file achieves isolation.

async function freshStore() {
  // Bust Vitest's module cache so `load()` runs again with whatever is on disk
  vi.resetModules();
  const mod = await import('../../electron/store.js');
  return mod;
}

function cleanupStoreDir() {
  if (fs.existsSync(mockUserDataPath)) {
    fs.rmSync(mockUserDataPath, { recursive: true, force: true });
  }
}

describe('store module', () => {
  beforeEach(() => {
    cleanupStoreDir();
  });

  describe('storeGet / storeSet', () => {
    it('returns undefined for a key that has never been set', async () => {
      const { storeGet } = await freshStore();
      expect(storeGet('nonexistent')).toBeUndefined();
    });

    it('stores and retrieves a string value', async () => {
      const { storeGet, storeSet } = await freshStore();
      storeSet('testKey', 'hello');
      expect(storeGet('testKey')).toBe('hello');
    });

    it('stores and retrieves a number value', async () => {
      const { storeGet, storeSet } = await freshStore();
      storeSet('count', 42);
      expect(storeGet('count')).toBe(42);
    });

    it('stores and retrieves an object value', async () => {
      const { storeGet, storeSet } = await freshStore();
      const obj = { a: 1, b: 'two', c: [3, 4] };
      storeSet('obj', obj);
      expect(storeGet('obj')).toEqual(obj);
    });

    it('overwrites an existing value', async () => {
      const { storeGet, storeSet } = await freshStore();
      storeSet('key', 'first');
      storeSet('key', 'second');
      expect(storeGet('key')).toBe('second');
    });

    it('persists values to disk (survives a module reload)', async () => {
      const { storeSet } = await freshStore();
      storeSet('persisted', 'value123');

      // Re-import to simulate a fresh process startup
      const { storeGet: storeGetFresh } = await freshStore();
      expect(storeGetFresh('persisted')).toBe('value123');
    });
  });

  describe('storeDelete', () => {
    it('removes a previously set key', async () => {
      const { storeGet, storeSet, storeDelete } = await freshStore();
      storeSet('toDelete', 'please remove me');
      storeDelete('toDelete');
      expect(storeGet('toDelete')).toBeUndefined();
    });

    it('is a no-op for a key that does not exist', async () => {
      const { storeDelete, storeGet } = await freshStore();
      expect(() => storeDelete('ghost')).not.toThrow();
      expect(storeGet('ghost')).toBeUndefined();
    });
  });
});
