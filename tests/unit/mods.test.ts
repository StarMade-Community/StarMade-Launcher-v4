import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listSmdMods, parseModpackManifest, sanitizeModFileName } from '../../electron/mods.js';

let previousSmdApiKey: string | undefined;

beforeEach(() => {
  previousSmdApiKey = process.env.SMD_API_KEY;
  process.env.SMD_API_KEY = 'test-api-key';
});

afterEach(() => {
  if (typeof previousSmdApiKey === 'string') {
    process.env.SMD_API_KEY = previousSmdApiKey;
  } else {
    delete process.env.SMD_API_KEY;
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
  it('returns only StarLoader-tagged mods and filters out the core StarLoader entry', async () => {
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
            tags: ['vanilla'],
            download_count: 5,
            rating_avg: 3.0,
          },
        ],
      }),
    };

    vi.stubGlobal('fetch', vi.fn(async () => mockResponse as unknown as Response));

    const mods = await listSmdMods('alpha');
    expect(mods).toHaveLength(1);
    expect(mods[0].resourceId).toBe(2);
    expect(mods[0].name).toBe('Alpha Weapons');
    expect(mods[0].gameVersion).toBe('0.205.1');
  });

  it('accepts the newer plain "starloader" tag format', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Number.MAX_SAFE_INTEGER - 1);

    const mockResponse = {
      ok: true,
      json: async () => ({
        resources: [
          {
            resource_id: 42,
            title: 'BetterChambers',
            username: 'Author',
            tags: ['chambers', 'starloader'],
            download_count: 12,
            rating_avg: 4.5,
          },
        ],
      }),
    };

    vi.stubGlobal('fetch', vi.fn(async () => mockResponse as unknown as Response));

    const mods = await listSmdMods();
    expect(mods).toHaveLength(1);
    expect(mods[0].resourceId).toBe(42);
    expect(mods[0].name).toBe('BetterChambers');
  });
});

