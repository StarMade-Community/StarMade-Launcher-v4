import { describe, it, expect, vi } from 'vitest';

// Mock electron and its dependencies before importing the module under test
vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp/test-user-data') },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  shell: { openPath: vi.fn(), openExternal: vi.fn() },
}));

vi.mock('adm-zip', () => ({
  default: vi.fn(),
}));

vi.mock('tar-stream', () => ({
  extract: vi.fn(),
}));

import {
  getRequiredJavaVersion,
  getJvmArgsForJava,
  parseJavaVersion,
  JAVA_25_ARGS,
  JAVA_8_ARGS,
} from '../../electron/java.js';

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

  describe('new-era versions → Java 25', () => {
    it('returns 25 for version 0.300.0 (first version requiring Java 25)', () => {
      expect(getRequiredJavaVersion('0.300.0')).toBe(25);
    });

    it('returns 25 for version 0.302.101', () => {
      expect(getRequiredJavaVersion('0.302.101')).toBe(25);
    });

    it('returns 25 for version 0.399.0', () => {
      expect(getRequiredJavaVersion('0.399.0')).toBe(25);
    });

    it('returns 25 for version 1.0.0 (major >= 1)', () => {
      expect(getRequiredJavaVersion('1.0.0')).toBe(25);
    });

    it('returns 25 for version 1.5.3', () => {
      expect(getRequiredJavaVersion('1.5.3')).toBe(25);
    });

    it('returns 25 for version 2.0.0', () => {
      expect(getRequiredJavaVersion('2.0.0')).toBe(25);
    });
  });
});

describe('getJvmArgsForJava', () => {
  it('returns JAVA_25_ARGS for Java 25', () => {
    expect(getJvmArgsForJava(25)).toEqual(JAVA_25_ARGS);
    expect(getJvmArgsForJava(25)).toContain('--add-opens=java.base/jdk.internal.misc=ALL-UNNAMED');
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

  it('parses Java 25 version string', () => {
    expect(parseJavaVersion('openjdk version "25.0.0"')).toBe(25);
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
