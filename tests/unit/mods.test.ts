import { describe, expect, it } from 'vitest';
import { parseModpackManifest, sanitizeModFileName } from '../../electron/mods.js';

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

