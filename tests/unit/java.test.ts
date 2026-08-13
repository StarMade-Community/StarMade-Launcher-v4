import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Mock electron and its dependencies before importing the module under test
vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => path.join(os.tmpdir(), 'test-user-data')) },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  shell: { openPath: vi.fn(), openExternal: vi.fn() },
}));

vi.mock('adm-zip', () => ({
  default: vi.fn(),
}));

vi.mock('tar-stream', () => ({
  default: { extract: vi.fn() },
}));

import {
  getRequiredJavaVersion,
  getJvmArgsForJava,
  parseJavaVersion,
  parseJavaBitness,
  getSystemJavaSearchPaths,
  versionProbePath,
  ensureJava,
  JAVA_21_ARGS,
  JAVA_8_ARGS,
} from '@/electron/java.ts';

describe('getRequiredJavaVersion', () => {
  describe('legacy versions → Java 8', () => {
    it('returns 8 for version 0.203.175 (legacy build)', () => {
      expect(getRequiredJavaVersion('0.203.175')).toBe(8);
    });

    it('returns 8 for version 0.200.0', () => {
      expect(getRequiredJavaVersion('0.200.0')).toBe(8);
    });

    it('returns 8 for version 0.299.999 (just below 0.300)', () => {
      expect(getRequiredJavaVersion('0.299.999')).toBe(8);
    });

    it('returns 8 for a single-component version string', () => {
      expect(getRequiredJavaVersion('0')).toBe(8);
    });

    it('returns 8 for an empty version string', () => {
      expect(getRequiredJavaVersion('')).toBe(8);
    });

    it('returns 8 for a non-numeric version string', () => {
      expect(getRequiredJavaVersion('invalid')).toBe(8);
    });

    it('returns 8 for version "legacy"', () => {
      expect(getRequiredJavaVersion('legacy')).toBe(8);
    });
  });

  describe('new-era versions → Java 21', () => {
    it('returns 21 for version 0.300.0 (first version requiring Java 21)', () => {
      expect(getRequiredJavaVersion('0.300.0')).toBe(21);
    });

    it('returns 21 for version 0.302.101', () => {
      expect(getRequiredJavaVersion('0.302.101')).toBe(21);
    });

    it('returns 21 for version 0.399.0', () => {
      expect(getRequiredJavaVersion('0.399.0')).toBe(21);
    });

    it('returns 21 for version 1.0.0 (major >= 1)', () => {
      expect(getRequiredJavaVersion('1.0.0')).toBe(21);
    });

    it('returns 21 for version 1.5.3', () => {
      expect(getRequiredJavaVersion('1.5.3')).toBe(21);
    });

    it('returns 21 for version 2.0.0', () => {
      expect(getRequiredJavaVersion('2.0.0')).toBe(21);
    });

    it('returns 21 for version 0.400.307 (last legacy-scheme pre build)', () => {
      expect(getRequiredJavaVersion('0.400.307')).toBe(21);
    });
  });

  describe('current version scheme (0.4.x counter, introduced 2026-08)', () => {
    it('returns 21 for version 0.4.0', () => {
      expect(getRequiredJavaVersion('0.4.0')).toBe(21);
    });

    it('returns 21 for version 0.4.1', () => {
      expect(getRequiredJavaVersion('0.4.1')).toBe(21);
    });

    it('returns 21 for a future two-digit minor (0.10.0)', () => {
      expect(getRequiredJavaVersion('0.10.0')).toBe(21);
    });

    it('returns 21 for a two-component 0.5', () => {
      expect(getRequiredJavaVersion('0.5')).toBe(21);
    });
  });

  describe('legacy decimal versions are compared as fractions', () => {
    it('returns 8 for version 0.17 (2014-era build)', () => {
      expect(getRequiredJavaVersion('0.17')).toBe(8);
    });

    it('returns 8 for version 0.1801 (decimal 0.1801, not minor 1801)', () => {
      expect(getRequiredJavaVersion('0.1801')).toBe(8);
    });

    it('returns 8 for version 0.19624', () => {
      expect(getRequiredJavaVersion('0.19624')).toBe(8);
    });

    it('returns 8 for version 0.163', () => {
      expect(getRequiredJavaVersion('0.163')).toBe(8);
    });
  });
});

describe('getJvmArgsForJava', () => {
  it('returns JAVA_21_ARGS for Java 21', () => {
    expect(getJvmArgsForJava(21)).toEqual(JAVA_21_ARGS);
    expect(getJvmArgsForJava(21)).toContain('--add-opens=java.base/java.lang=ALL-UNNAMED');
    expect(getJvmArgsForJava(21)).toContain('--add-opens=java.base/java.util=ALL-UNNAMED');
    expect(getJvmArgsForJava(21)).toContain('--add-opens=java.base/java.io=ALL-UNNAMED');
  });

  it('returns JAVA_8_ARGS (empty array) for Java 8', () => {
    expect(getJvmArgsForJava(8)).toEqual(JAVA_8_ARGS);
    expect(getJvmArgsForJava(8)).toHaveLength(0);
  });
});

describe('parseJavaVersion', () => {
  it('parses Java 8 version string (1.8.x format)', () => {
    expect(parseJavaVersion('openjdk version "1.8.0_362"')).toBe(8);
  });

  it('parses Java 11 version string', () => {
    expect(parseJavaVersion('openjdk version "11.0.18" 2023-01-17')).toBe(11);
  });

  it('parses Java 17 version string', () => {
    expect(parseJavaVersion('java version "17.0.6"')).toBe(17);
  });

  it('parses Java 21 version string', () => {
    expect(parseJavaVersion('openjdk version "21.0.0"')).toBe(21);
  });

  it('returns null for a string without a quoted version', () => {
    expect(parseJavaVersion('something without version')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(parseJavaVersion('')).toBeNull();
  });

  it('parses multi-line java -version output (uses first match)', () => {
    const output = `openjdk version "17.0.6" 2023-01-17\nOpenJDK Runtime Environment`;
    expect(parseJavaVersion(output)).toBe(17);
  });
});

describe('parseJavaBitness', () => {
  it('detects 64-bit from OpenJDK 64-Bit Server VM line', () => {
    const output = [
      'openjdk version "21.0.0" 2023-09-19',
      'OpenJDK Runtime Environment Temurin-21.0.0+35 (build 21.0.0+35)',
      'OpenJDK 64-Bit Server VM Temurin-21.0.0+35 (build 21.0.0+35, mixed mode, sharing)',
    ].join('\n');
    expect(parseJavaBitness(output)).toBe(64);
  });

  it('detects 64-bit from Java HotSpot(TM) 64-Bit Server VM line', () => {
    const output = [
      'java version "1.8.0_362"',
      'Java(TM) SE Runtime Environment (build 1.8.0_362-b09)',
      'Java HotSpot(TM) 64-Bit Server VM (build 25.362-b09, mixed mode)',
    ].join('\n');
    expect(parseJavaBitness(output)).toBe(64);
  });

  it('detects 32-bit from a Client VM line (no "64-Bit")', () => {
    const output = [
      'java version "1.8.0_362"',
      'Java(TM) SE Runtime Environment (build 1.8.0_362-b09)',
      'Java HotSpot(TM) Client VM (build 25.362-b09, mixed mode)',
    ].join('\n');
    expect(parseJavaBitness(output)).toBe(32);
  });

  it('detects 32-bit from an OpenJDK Server VM line without "64-Bit"', () => {
    const output = [
      'openjdk version "1.8.0_362"',
      'OpenJDK Runtime Environment (build 1.8.0_362-b09)',
      'OpenJDK Server VM (build 25.362-b09, mixed mode)',
    ].join('\n');
    expect(parseJavaBitness(output)).toBe(32);
  });

  it('returns null when there is no VM description line', () => {
    expect(parseJavaBitness('openjdk version "21.0.0"')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(parseJavaBitness('')).toBeNull();
  });
});

describe('getSystemJavaSearchPaths', () => {
  // Expectations are derived with the same path module the implementation uses, so
  // assertions hold whether the test runs on Windows or the Linux CI runner (where
  // path.join uses forward slashes).
  const joinN = (...parts: string[]) => path.normalize(path.join(...parts));

  it('includes common vendor dirs beyond Adoptium on Windows (Corretto/Microsoft/Zulu)', () => {
    const programFiles = 'C:\\Program Files';
    const env = {
      ProgramFiles: programFiles,
      'ProgramFiles(x86)': 'C:\\Program Files (x86)',
    } as unknown as NodeJS.ProcessEnv;
    const paths = getSystemJavaSearchPaths(env, 'win32');
    expect(paths).toContain(joinN(programFiles, 'Amazon Corretto'));
    expect(paths).toContain(joinN(programFiles, 'Microsoft'));
    expect(paths).toContain(joinN(programFiles, 'Zulu'));
    expect(paths).toContain(joinN(programFiles, 'Eclipse Adoptium'));
  });

  it('covers per-user (LOCALAPPDATA) installs on Windows', () => {
    const localAppData = 'C:\\Users\\me\\AppData\\Local';
    const env = {
      ProgramFiles: 'C:\\Program Files',
      LOCALAPPDATA: localAppData,
    } as unknown as NodeJS.ProcessEnv;
    const paths = getSystemJavaSearchPaths(env, 'win32');
    expect(paths).toContain(joinN(localAppData, 'Programs', 'Eclipse Adoptium'));
  });

  it('derives Windows roots from env rather than a hardcoded C: drive', () => {
    const programFiles = 'D:\\Apps';
    const env = {
      ProgramFiles: programFiles,
      'ProgramFiles(x86)': 'D:\\Apps86',
    } as unknown as NodeJS.ProcessEnv;
    const paths = getSystemJavaSearchPaths(env, 'win32');
    expect(paths).toContain(joinN(programFiles, 'Amazon Corretto'));
    expect(paths.some(p => p.includes('C:\\') || p.includes('C:/'))).toBe(false);
  });

  it('includes JAVA_HOME so it is probed directly', () => {
    const env = { JAVA_HOME: '/opt/my-jdk' } as unknown as NodeJS.ProcessEnv;
    const paths = getSystemJavaSearchPaths(env, 'linux');
    expect(paths).toContain(path.normalize('/opt/my-jdk'));
  });

  it('returns the standard macOS/Linux roots', () => {
    expect(getSystemJavaSearchPaths({} as NodeJS.ProcessEnv, 'darwin'))
      .toContain(path.normalize('/Library/Java/JavaVirtualMachines'));
    expect(getSystemJavaSearchPaths({} as NodeJS.ProcessEnv, 'linux'))
      .toContain(path.normalize('/usr/lib/jvm'));
  });

  it('de-duplicates repeated roots', () => {
    const env = { JAVA_HOME: '/usr/lib/jvm' } as unknown as NodeJS.ProcessEnv;
    const paths = getSystemJavaSearchPaths(env, 'linux');
    expect(paths.filter(p => p === path.normalize('/usr/lib/jvm'))).toHaveLength(1);
  });
});

describe('versionProbePath', () => {
  it('returns a non-javaw path unchanged', () => {
    expect(versionProbePath('/opt/jdk/bin/java')).toBe('/opt/jdk/bin/java');
  });

  // The javaw → java.exe redirect is Windows-only; assert it where we run on Windows.
  if (process.platform === 'win32') {
    it('redirects javaw.exe to a sibling java.exe when present', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-test-'));
      try {
        fs.writeFileSync(path.join(dir, 'javaw.exe'), '');
        fs.writeFileSync(path.join(dir, 'java.exe'), '');
        expect(versionProbePath(path.join(dir, 'javaw.exe'))).toBe(path.join(dir, 'java.exe'));
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('falls back to javaw.exe when no sibling java.exe exists', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-test-'));
      try {
        const javaw = path.join(dir, 'javaw.exe');
        fs.writeFileSync(javaw, '');
        expect(versionProbePath(javaw)).toBe(javaw);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  }
});

describe('ensureJava', () => {
  const launcherDir = '/launcher';
  const ok = (version: number, arch: 64 | 32 | null = 64) =>
    async (p: string) => ({ version, path: p, arch });

  it('keeps a valid preferred path without resolving or downloading', async () => {
    const resolve = vi.fn();
    const download = vi.fn();
    const result = await ensureJava(21, launcherDir, { preferredPath: '/my/java' }, {
      exists: () => true,
      check: ok(21),
      resolve: resolve as never,
      download: download as never,
    });
    expect(result).toEqual({ path: '/my/java', downloaded: false, usedPreferred: true });
    expect(resolve).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
  });

  it('ignores a preferred path of the wrong major version and resolves instead', async () => {
    const download = vi.fn();
    const result = await ensureJava(21, launcherDir, { preferredPath: '/old/java8' }, {
      exists: () => true,
      check: ok(8),
      resolve: (async () => '/resolved/java21') as never,
      download: download as never,
    });
    expect(result).toEqual({ path: '/resolved/java21', downloaded: false, usedPreferred: false });
    expect(download).not.toHaveBeenCalled();
  });

  it('rejects a 32-bit preferred path and resolves instead', async () => {
    const result = await ensureJava(21, launcherDir, { preferredPath: '/x86/java' }, {
      exists: () => true,
      check: ok(21, 32),
      resolve: (async () => '/resolved/java21') as never,
      download: (async () => '/dl') as never,
    });
    expect(result.usedPreferred).toBe(false);
    expect(result.path).toBe('/resolved/java21');
  });

  it('downloads only when nothing is resolvable', async () => {
    const download = vi.fn(async () => '/downloaded/java21');
    const result = await ensureJava(21, launcherDir, {}, {
      exists: () => false,
      check: (async () => null) as never,
      resolve: (async () => null) as never,
      download: download as never,
    });
    expect(result).toEqual({ path: '/downloaded/java21', downloaded: true, usedPreferred: false });
    expect(download).toHaveBeenCalledOnce();
  });
});
