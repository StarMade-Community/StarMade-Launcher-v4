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

  describe('v2 relative-path migration', () => {
    /** Write a raw store file to disk so the next load() runs the migration. */
    function writeStoreFile(data: unknown) {
      fs.mkdirSync(mockUserDataPath, { recursive: true });
      fs.writeFileSync(
        path.join(mockUserDataPath, 'launcher-store.json'),
        JSON.stringify(data),
        'utf-8',
      );
    }

    const managedRoot = path.join(mockUserDataPath, 'My Games');

    it('rewrites relative installation/server paths to absolute on load', async () => {
      writeStoreFile({
        __version: 1,
        installations: [
          { id: '1', path: './StarMade/Installations/Alpha' },
          { id: '2', path: path.resolve('already', 'absolute') },
        ],
        servers: [{ id: '3', path: './StarMade/Servers/Beta' }],
      });

      const { storeGet } = await freshStore();

      const installs = storeGet('installations') as Array<{ id: string; path: string }>;
      expect(installs[0].path).toBe(path.resolve(managedRoot, './StarMade/Installations/Alpha'));
      // Absolute paths are left untouched.
      expect(installs[1].path).toBe(path.resolve('already', 'absolute'));

      const servers = storeGet('servers') as Array<{ id: string; path: string }>;
      expect(servers[0].path).toBe(path.resolve(managedRoot, './StarMade/Servers/Beta'));
      expect(storeGet('__version')).toBe(2);
    });

    it('rewrites the relative default gameDir to absolute', async () => {
      writeStoreFile({
        __version: 1,
        defaultInstallationSettings: { gameDir: './StarMade/Installations' },
        defaultServerSettings: { gameDir: './StarMade/Servers' },
      });

      const { storeGet } = await freshStore();

      const inst = storeGet('defaultInstallationSettings') as { gameDir: string };
      const srv = storeGet('defaultServerSettings') as { gameDir: string };
      expect(inst.gameDir).toBe(path.resolve(managedRoot, './StarMade/Installations'));
      expect(srv.gameDir).toBe(path.resolve(managedRoot, './StarMade/Servers'));
    });

    it('leaves an already-migrated (v2) store untouched', async () => {
      const relative = './StarMade/Installations/Gamma';
      writeStoreFile({
        __version: 2,
        installations: [{ id: '1', path: relative }],
      });

      const { storeGet } = await freshStore();

      const installs = storeGet('installations') as Array<{ id: string; path: string }>;
      // Already at v2 → migration must not run, so the value is preserved verbatim.
      expect(installs[0].path).toBe(relative);
    });
  });
});
