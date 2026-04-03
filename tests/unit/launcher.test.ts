import { describe, it, expect, vi } from 'vitest';

// Mock electron and Node-specific modules before importing launcher
vi.mock('electron', () => ({
  app: { quit: vi.fn() },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  shell: { openPath: vi.fn() },
}));

vi.mock('adm-zip', () => ({ default: vi.fn() }));
vi.mock('tar-stream', () => ({ default: { extract: vi.fn() } }));

import {
  buildLaunchArgs,
  isStderrError,
  parseStarMadeLogLine,
  redactLaunchArgs,
} from '../../electron/launcher.js';
import { LAUNCH_ARG_FIXTURES } from './fixtures/launcherArgs.fixtures';

describe('parseStarMadeLogLine', () => {
  it('parses a well-formed INFO log line', () => {
    const result = parseStarMadeLogLine('[2024-03-11 14:23:45] [INFO] Loading game data...');
    expect(result).toEqual({ level: 'INFO', message: 'Loading game data...' });
  });

  it('parses a WARNING log line', () => {
    const result = parseStarMadeLogLine('[2024-03-11 14:23:45] [WARNING] Low memory detected');
    expect(result).toEqual({ level: 'WARNING', message: 'Low memory detected' });
  });

  it('parses an ERROR log line', () => {
    const result = parseStarMadeLogLine('[2024-03-11 14:23:45] [ERROR] Failed to load texture');
    expect(result).toEqual({ level: 'ERROR', message: 'Failed to load texture' });
  });

  it('parses a FATAL log line', () => {
    const result = parseStarMadeLogLine('[2024-03-11 14:23:45] [FATAL] Unrecoverable crash');
    expect(result).toEqual({ level: 'FATAL', message: 'Unrecoverable crash' });
  });

  it('parses a DEBUG log line', () => {
    const result = parseStarMadeLogLine('[2024-03-11 14:23:45] [DEBUG] Debug message here');
    expect(result).toEqual({ level: 'DEBUG', message: 'Debug message here' });
  });

  it('is case-insensitive for level matching (normalises to uppercase)', () => {
    // The level is matched via toUpperCase() in the parser
    const result = parseStarMadeLogLine('[2024-03-11 14:23:45] [info] Lower case level');
    expect(result).toEqual({ level: 'INFO', message: 'Lower case level' });
  });

  it('returns null for an unrecognised log level', () => {
    const result = parseStarMadeLogLine('[2024-03-11 14:23:45] [VERBOSE] Something');
    expect(result).toBeNull();
  });

  it('returns null for a plain text line (no timestamp)', () => {
    const result = parseStarMadeLogLine('Just a plain log line');
    expect(result).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(parseStarMadeLogLine('')).toBeNull();
  });

  it('returns null for a line with only partial formatting', () => {
    expect(parseStarMadeLogLine('[2024-03-11 14:23:45] Missing level part')).toBeNull();
  });
});

describe('isStderrError', () => {
  // Lines that should be treated as errors
  it('identifies a NullPointerException line as an error', () => {
    expect(isStderrError('java.lang.NullPointerException: null')).toBe(true);
  });

  it('identifies "Exception in thread" as an error', () => {
    expect(isStderrError('Exception in thread "main" java.lang.RuntimeException')).toBe(true);
  });

  it('identifies a Caused-by line as an error', () => {
    expect(isStderrError('	Caused by: java.io.IOException: File not found')).toBe(true);
  });

  it('identifies a stack trace frame as an error', () => {
    expect(isStderrError('	at com.example.Foo.bar(Foo.java:42)')).toBe(true);
  });

  it('identifies an OutOfMemoryError line as an error', () => {
    expect(isStderrError('java.lang.OutOfMemoryError: Java heap space')).toBe(true);
  });

  it('identifies an [ERROR] prefixed line as an error', () => {
    expect(isStderrError('[ERROR] Something went wrong')).toBe(true);
  });

  it('identifies an [FATAL] prefixed line as an error', () => {
    expect(isStderrError('[FATAL] Critical failure')).toBe(true);
  });

  it('identifies an "ERROR:" prefixed line as an error', () => {
    expect(isStderrError('ERROR: Could not find module')).toBe(true);
  });

  // Lines that should NOT be treated as errors (normal JVM diagnostic output)
  it('does not flag a plain OpenGL info message', () => {
    expect(isStderrError('OpenGL vendor string: Intel Inc.')).toBe(false);
  });

  it('does not flag an LWJGL info line', () => {
    expect(isStderrError('LWJGL version 2.9.3 build 18')).toBe(false);
  });

  it('does not flag GC stats output', () => {
    expect(isStderrError('[GC (Allocation Failure) [PSYoungGen: 512K->64K]')).toBe(false);
  });

  it('does not flag an empty string', () => {
    expect(isStderrError('')).toBe(false);
  });

  it('does not flag a normal informational JVM line', () => {
    expect(isStderrError('Picked up _JAVA_OPTIONS: -Xmx512m')).toBe(false);
  });
});

describe('launch argument fixtures', () => {
  it.each(LAUNCH_ARG_FIXTURES)('builds args for %s', (fixture) => {
    const args = buildLaunchArgs(fixture.options);
    expect(args).toEqual(fixture.expectedArgs);
  });

  it.each(LAUNCH_ARG_FIXTURES)('redacts args for %s', (fixture) => {
    const args = buildLaunchArgs(fixture.options);
    const safeArgs = redactLaunchArgs(args, fixture.options.authToken);
    expect(safeArgs).toEqual(fixture.expectedSafeArgs);

    if (fixture.options.authToken) {
      expect(safeArgs.join(' ')).not.toContain(fixture.options.authToken);
    }
  });
});

