import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

// ─── Mock electron ─────────────────────────────────────────────────────────────

const testUserDataPath    = path.join(os.tmpdir(), 'starmade-backup-test-userData');
const testAppDataPath     = path.join(os.tmpdir(), 'starmade-backup-test-appData');

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((key: string) => {
      if (key === 'userData') return testUserDataPath;
      if (key === 'appData')  return testAppDataPath;
      return os.tmpdir();
    }),
  },
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function cleanupDirs() {
  [testUserDataPath, path.join(testAppDataPath, 'StarMade-Launcher-Backups')].forEach(d => {
    if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
  });
}

async function freshBackup() {
  vi.resetModules();
  return import('../../electron/backup.js');
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('backup module', () => {
  beforeEach(() => {
    cleanupDirs();
    // Create a minimal userData directory with a fake store file
    fs.mkdirSync(testUserDataPath, { recursive: true });
    fs.writeFileSync(
      path.join(testUserDataPath, 'launcher-store.json'),
      JSON.stringify({ __version: 1, test: 'data' }),
    );
  });

  afterEach(() => {
    cleanupDirs();
  });

  describe('createBackup', () => {
    it('creates a backup directory with a copy of the store file', async () => {
      const { createBackup } = await freshBackup();
      const result = await createBackup();

      expect(result.success).toBe(true);
      expect(result.backupPath).toBeDefined();

      const storeBackup = path.join(result.backupPath!, 'launcher-store.json');
      expect(fs.existsSync(storeBackup)).toBe(true);

      const content = JSON.parse(fs.readFileSync(storeBackup, 'utf-8'));
      expect(content.test).toBe('data');
    });

    it('returns success=false when userData directory does not exist', async () => {
      fs.rmSync(testUserDataPath, { recursive: true, force: true });
      const { createBackup } = await freshBackup();
      const result = await createBackup();

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('listBackups', () => {
    it('returns an empty array when no backups exist', async () => {
      const { listBackups } = await freshBackup();
      const list = await listBackups();
      expect(list).toEqual([]);
    });

    it('returns backups sorted newest first', async () => {
      const { createBackup, listBackups } = await freshBackup();

      await createBackup();
      // Small delay so timestamps differ
      await new Promise(r => setTimeout(r, 5));
      await createBackup();

      const list = await listBackups();
      expect(list.length).toBe(2);
      // Newest first — compare name strings (ISO timestamp lexicographic order)
      expect(list[0].name > list[1].name).toBe(true);
    });

    it('includes name, path, and date fields', async () => {
      const { createBackup, listBackups } = await freshBackup();
      await createBackup();

      const list = await listBackups();
      expect(list).toHaveLength(1);
      expect(list[0]).toHaveProperty('name');
      expect(list[0]).toHaveProperty('path');
      expect(list[0]).toHaveProperty('date');
    });
  });

  describe('restoreBackup', () => {
    it('restores files from a backup to userData', async () => {
      const { createBackup, restoreBackup } = await freshBackup();

      // Create initial backup
      const backupResult = await createBackup();
      expect(backupResult.success).toBe(true);

      // Overwrite the store file with different content
      fs.writeFileSync(
        path.join(testUserDataPath, 'launcher-store.json'),
        JSON.stringify({ __version: 1, test: 'modified' }),
      );

      // Restore
      const restoreResult = await restoreBackup(backupResult.backupPath!);
      expect(restoreResult.success).toBe(true);

      // The file should have the original content again
      const content = JSON.parse(
        fs.readFileSync(path.join(testUserDataPath, 'launcher-store.json'), 'utf-8'),
      );
      expect(content.test).toBe('data');
    });

    it('returns success=false when the backup path does not exist', async () => {
      const { restoreBackup } = await freshBackup();
      const result = await restoreBackup('/nonexistent/path');
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
});
