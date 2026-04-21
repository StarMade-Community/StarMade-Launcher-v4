import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';

// Mock electron before importing versions.ts (versions.ts imports java.ts
// which imports fs/https etc. — those are Node built-ins and are fine)
vi.mock('electron', () => {
  const tempUserDataPath = path.join(os.tmpdir(), 'test-user-data');
  return {
    app: { getPath: vi.fn(() => tempUserDataPath) },
  };
});

vi.mock('adm-zip', () => ({ default: vi.fn() }));
vi.mock('tar-stream', () => ({ default: { extract: vi.fn() } }));

import { parseBuildIndex, invalidateVersionCache } from '../../electron/versions.js';

describe('parseBuildIndex', () => {
  beforeEach(() => {
    invalidateVersionCache();
  });

  it('returns an empty array for empty input', () => {
    expect(parseBuildIndex('', 'release')).toEqual([]);
  });

  it('skips blank lines', () => {
    expect(parseBuildIndex('\n\n\n', 'release')).toEqual([]);
  });

  it('skips comment lines starting with #', () => {
    const text = '# This is a comment\n# Another comment';
    expect(parseBuildIndex(text, 'release')).toEqual([]);
  });

  it('parses a valid release entry correctly', () => {
    const text = '0.203.175#20231020_123456 ./build/starmade-build_20231020_123456';
    const results = parseBuildIndex(text, 'release');

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      id: '0.203.175',
      name: '0.203.175',
      type: 'release',
      build: '20231020_123456',
      buildPath: './build/starmade-build_20231020_123456',
      requiredJavaVersion: 8,
    });
  });

  it('adds branch prefix for non-release types', () => {
    const text = '0.203.175#20231020_123456 ./build/starmade-build_20231020_123456';

    const devResults = parseBuildIndex(text, 'dev');
    expect(devResults[0].name).toBe('Dev 0.203.175');

    const preResults = parseBuildIndex(text, 'pre');
    expect(preResults[0].name).toBe('Pre 0.203.175');

    const archiveResults = parseBuildIndex(text, 'archive');
    expect(archiveResults[0].name).toBe('Archive 0.203.175');
  });

  it('deduplicates consecutive duplicate entries', () => {
    const line = '0.203.175#20231020_123456 ./build/starmade-build_20231020_123456';
    const text = `${line}\n${line}\n${line}`;
    const results = parseBuildIndex(text, 'release');
    expect(results).toHaveLength(1);
  });

  it('keeps entries with different build timestamps', () => {
    const text = [
      '0.203.175#20231020_123456 ./build/starmade-build_20231020_123456',
      '0.203.175#20231021_000000 ./build/starmade-build_20231021_000000',
    ].join('\n');
    const results = parseBuildIndex(text, 'release');
    expect(results).toHaveLength(2);
  });

  it('skips entries that have no space separator', () => {
    const text = '0.203.175#20231020_123456';
    expect(parseBuildIndex(text, 'release')).toEqual([]);
  });

  it('skips entries that have no # in the build id', () => {
    const text = '0.203.175 ./build/starmade-build_20231020_123456';
    expect(parseBuildIndex(text, 'release')).toEqual([]);
  });

  it('skips entries where buildPath contains a # character', () => {
    const text = '0.203.175#20231020_123456 ./build/starmade#build';
    expect(parseBuildIndex(text, 'release')).toEqual([]);
  });

  it('assigns requiredJavaVersion 21 for modern versions (>= 0.300.x)', () => {
    const text = '0.302.101#20240115_090000 ./build/starmade-build_20240115_090000';
    const results = parseBuildIndex(text, 'release');
    expect(results[0].requiredJavaVersion).toBe(21);
  });

  it('assigns requiredJavaVersion 8 for legacy versions (< 0.300.x)', () => {
    const text = '0.203.175#20231020_123456 ./build/starmade-build_20231020_123456';
    const results = parseBuildIndex(text, 'release');
    expect(results[0].requiredJavaVersion).toBe(8);
  });

  it('parses multiple entries in order', () => {
    const text = [
      '0.203.175#20231020_123456 ./build/starmade-build_20231020_123456',
      '0.203.174#20231019_000000 ./build/starmade-build_20231019_000000',
      '0.203.173#20231018_000000 ./build/starmade-build_20231018_000000',
    ].join('\n');
    const results = parseBuildIndex(text, 'release');
    expect(results).toHaveLength(3);
    expect(results.map(r => r.id)).toEqual(['0.203.175', '0.203.174', '0.203.173']);
  });

  it('handles mixed valid and invalid lines', () => {
    const text = [
      '# comment',
      '',
      '0.203.175#20231020_123456 ./build/starmade-build_20231020_123456',
      'malformed-no-space',
      '0.203.174#20231019_000000 ./build/starmade-build_20231019_000000',
    ].join('\n');
    const results = parseBuildIndex(text, 'release');
    expect(results).toHaveLength(2);
  });
});
