import fs from 'fs';
import os from 'os';
import path from 'path';
import { gzipSync } from 'zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearSmdCache,
  downloadModForInstallation,
  listSmdMods,
  parseModpackManifest,
  sanitizeModFileName,
} from '../../electron/mods.js';

let previousSmdApiKey: string | undefined;
const tempDirs: string[] = [];

function createMetadataStore() {
  let value: unknown = undefined;
  return {
    get: () => value,
    set: (next: unknown) => {
      value = next;
    },
  };
}

function createInstallationDir(): string {
  const installationRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'starmade-mods-test-'));
  tempDirs.push(installationRoot);
  return installationRoot;
}

beforeEach(() => {
  previousSmdApiKey = process.env.SMD_API_KEY;
  process.env.SMD_API_KEY = 'test-api-key';
  clearSmdCache();
});

afterEach(() => {
  if (typeof previousSmdApiKey === 'string') {
    process.env.SMD_API_KEY = previousSmdApiKey;
  } else {
    delete process.env.SMD_API_KEY;
  }
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('sanitizeModFileName', () => {
  it('ensures .jar extension and strips path separators', () => {
    expect(sanitizeModFileName('..\\evil/path/my mod')).toBe('..-evil-path-my-mod.jar');
  });

  it('keeps existing .jar extension', () => {
    expect(sanitizeModFileName('cool-mod.jar')).toBe('cool-mod.jar');
  });

  it('falls back when input is empty', () => {
    expect(sanitizeModFileName('   ')).toBe('mod-download.jar');
  });

  it('collapses consecutive hyphens from version strings with separators', () => {
    expect(sanitizeModFileName('Resources-ReSourced-v0.9.7 -- Bussard.jar')).toBe('Resources-ReSourced-v0.9.7-Bussard.jar');
  });
});

describe('parseModpackManifest', () => {
  it('parses valid link-only modpack manifests', () => {
    const manifest = parseModpackManifest({
      format: 'starmade-modpack',
      version: 1,
      name: 'Test Pack',
      createdAt: '2026-03-14T00:00:00.000Z',
      sourceInstallation: { id: '1', name: 'Main', version: '0.205.1' },
      entries: [
        {
          name: 'Example Mod',
          fileName: 'example mod.jar',
          downloadUrl: 'https://example.com/mods/example-mod.jar',
          enabled: false,
        },
      ],
    });

    expect(manifest.name).toBe('Test Pack');
    expect(manifest.entries).toHaveLength(1);
    expect(manifest.entries[0].fileName).toBe('example-mod.jar');
    expect(manifest.entries[0].enabled).toBe(false);
  });

  it('defaults missing enabled to true', () => {
    const manifest = parseModpackManifest({
      format: 'starmade-modpack',
      version: 1,
      name: 'Defaults Pack',
      createdAt: '2026-03-14T00:00:00.000Z',
      entries: [
        {
          name: 'Example Mod',
          downloadUrl: 'https://example.com/mod.jar',
        },
      ],
    });

    expect(manifest.entries[0].enabled).toBe(true);
  });

  it('rejects unsupported format', () => {
    expect(() => parseModpackManifest({ format: 'other', version: 1, name: 'x', createdAt: 'now', entries: [] }))
      .toThrow('Unsupported manifest format.');
  });

  it('rejects invalid entry URLs', () => {
    expect(() => parseModpackManifest({
      format: 'starmade-modpack',
      version: 1,
      name: 'Bad URL Pack',
      createdAt: '2026-03-14T00:00:00.000Z',
      entries: [{ name: 'Bad', downloadUrl: 'file:///tmp/bad.jar' }],
    })).toThrow('must use an http/https downloadUrl');
  });
});

describe('listSmdMods', () => {
  it('returns all mods from the category regardless of tags, filtered by search query', async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({
        resources: [
          {
            resource_id: 1,
            title: 'StarLoader',
            username: 'System',
            tags: ['api/starloader'],
            download_count: 100,
            rating_avg: 4.0,
          },
          {
            resource_id: 2,
            title: 'Alpha Weapons',
            username: 'Duke',
            tag_line: 'Adds weapons',
            tags: ['api/starloader', 'weapons'],
            download_count: 50,
            rating_avg: 4.8,
            custom_fields: { Gameversion: '0.205.1' },
          },
          {
            resource_id: 3,
            title: 'Not StarLoader Mod',
            username: 'Other',
            tags: ['vanilla'],   // no starloader tag – must still be included
            download_count: 5,
            rating_avg: 3.0,
          },
        ],
      }),
    };

    vi.stubGlobal('fetch', vi.fn(async () => mockResponse as unknown as Response));

    // Search 'alpha' → only Alpha Weapons matches, tag presence is irrelevant
    const mods = await listSmdMods('alpha');
    expect(mods).toHaveLength(1);
    expect(mods[0].resourceId).toBe(2);
    expect(mods[0].name).toBe('Alpha Weapons');
    expect(mods[0].gameVersion).toBe('0.205.1');
  });

  it('includes mods with no tags when no search query is given', async () => {

    const mockResponse = {
      ok: true,
      json: async () => ({
        resources: [
          {
            resource_id: 42,
            title: 'BetterChambers',
            username: 'Author',
            tags: [],             // no tags at all – must still appear
            download_count: 12,
            rating_avg: 4.5,
          },
          {
            resource_id: 99,
            title: 'NoTagMod',
            username: 'Dev',
            download_count: 3,
            rating_avg: 3.0,
          },
        ],
      }),
    };

    vi.stubGlobal('fetch', vi.fn(async () => mockResponse as unknown as Response));

    const mods = await listSmdMods();
    expect(mods).toHaveLength(2);
    const ids = mods.map((m) => m.resourceId);
    expect(ids).toContain(42);
    expect(ids).toContain(99);
  });

  it('loads all pages from the category endpoint instead of only the first page', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/resource-categories/6/resources?page=2')) {
        return {
          ok: true,
          json: async () => ({
            resources: [
              { resource_id: 12, title: 'Third Mod', username: 'C', download_count: 5, rating_avg: 4.1 },
            ],
            pagination: { current_page: 2, last_page: 2, per_page: 20, shown: 1, total: 3 },
          }),
        } as unknown as Response;
      }

      return {
        ok: true,
        json: async () => ({
          resources: [
            { resource_id: 10, title: 'First Mod', username: 'A', download_count: 10, rating_avg: 4.0 },
            { resource_id: 11, title: 'Second Mod', username: 'B', download_count: 8, rating_avg: 3.8 },
          ],
          pagination: { current_page: 1, last_page: 2, per_page: 20, shown: 2, total: 3 },
        }),
      } as unknown as Response;
    }));

    const mods = await listSmdMods();
    expect(mods).toHaveLength(3);
    expect(mods.map((mod) => mod.resourceId)).toEqual([10, 11, 12]);
  });

  it('falls back to the cached category endpoint when the category API returns 403', async () => {
    const cachedPayload = gzipSync(Buffer.from(JSON.stringify({
      resources: [
        { resource_id: 42, title: 'BetterChambers', username: 'Author', download_count: 12, rating_avg: 4.5 },
        { resource_id: 99, title: 'Resources Reorganized', username: 'Dev', download_count: 8, rating_avg: 4.2 },
      ],
      pagination: { current_page: 1, last_page: 1, per_page: 200, shown: 2, total: 2 },
    })));

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/resource-categories/6/resources')) {
        return { ok: false, status: 403, text: async () => 'Forbidden' } as unknown as Response;
      }
      if (url.includes('/cached-api/resource-categories/6.json.gz')) {
        return {
          ok: true,
          arrayBuffer: async () => cachedPayload.buffer.slice(
            cachedPayload.byteOffset,
            cachedPayload.byteOffset + cachedPayload.byteLength,
          ),
        } as unknown as Response;
      }
      throw new Error(`Unexpected URL: ${url}`);
    }));

    const mods = await listSmdMods();
    expect(mods).toHaveLength(2);
    expect(mods.map((mod) => mod.resourceId)).toEqual([42, 99]);
  });

  it('last-resort /resources fallback keeps mods and excludes unrelated categories', async () => {
    let resourcesPage = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/resource-categories/6/resources')) {
        return { ok: false, status: 403, text: async () => 'Forbidden' } as unknown as Response;
      }
      if (url.includes('/cached-api/resource-categories/6.json.gz')) {
        return { ok: false, status: 500, text: async () => 'Cache unavailable' } as unknown as Response;
      }

      resourcesPage += 1;
      if (resourcesPage === 1) {
        return {
          ok: true,
          json: async () => ({
            resources: [
              { resource_id: 10, title: 'Mod In Category 6', username: 'A', resource_category_id: 6, download_count: 10, rating_avg: 4 },
              { resource_id: 11, title: 'Mod In Subcategory', username: 'B', resource_category_id: 12, Category: { parent_category_id: 6 }, download_count: 20, rating_avg: 5 },
            ],
            pagination: { current_page: 1, last_page: 2, per_page: 20, shown: 2, total: 3 },
          }),
        } as unknown as Response;
      }

      return {
        ok: true,
        json: async () => ({
          resources: [
            { resource_id: 12, title: 'Mod In Other Category', username: 'C', resource_category_id: 99, Category: { parent_category_id: 0 }, download_count: 30, rating_avg: 5 },
          ],
          pagination: { current_page: 2, last_page: 2, per_page: 20, shown: 1, total: 3 },
        }),
      } as unknown as Response;
    }));

    const mods = await listSmdMods();
    expect(mods).toHaveLength(2);
    expect(mods.map((mod) => mod.resourceId)).toEqual([11, 10]);
  });
});

describe('downloadModForInstallation', () => {
  it('sends XF-Api-Key headers to starmadedock download URLs', async () => {
    const installationPath = createInstallationDir();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'HEAD') {
        return {
          ok: true,
          headers: { get: () => null },
        } as unknown as Response;
      }

      expect(url).toContain('starmadedock.net');
      expect(init?.headers).toMatchObject({
        'XF-Api-Key': 'test-api-key',
      });

      return {
        ok: true,
        arrayBuffer: async () => new TextEncoder().encode('jar-bytes').buffer,
      } as unknown as Response;
    });

    vi.stubGlobal('fetch', fetchMock);

    const mod = await downloadModForInstallation({
      installationPath,
      launcherDir: installationPath,
      downloadUrl: 'https://starmadedock.net/resources/example/download',
      preferredFileName: 'Example.jar',
      source: 'smd',
      metadataStore: createMetadataStore(),
    });

    expect(mod.fileName).toBe('Example.jar');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not send XF-Api-Key headers to non-SMD URLs', async () => {
    const installationPath = createInstallationDir();
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'HEAD') {
        return {
          ok: true,
          headers: { get: () => null },
        } as unknown as Response;
      }

      expect(init?.headers).toBeUndefined();
      return {
        ok: true,
        arrayBuffer: async () => new TextEncoder().encode('jar-bytes').buffer,
      } as unknown as Response;
    });

    vi.stubGlobal('fetch', fetchMock);

    const mod = await downloadModForInstallation({
      installationPath,
      launcherDir: installationPath,
      downloadUrl: 'https://example.com/mods/example.jar',
      preferredFileName: 'Example.jar',
      source: 'modpack-import',
      metadataStore: createMetadataStore(),
    });

    expect(mod.fileName).toBe('Example.jar');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

