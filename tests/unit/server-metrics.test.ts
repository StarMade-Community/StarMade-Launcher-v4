import { describe, it, expect } from 'vitest';

import {
  parseDockerByteSize,
  parseDockerPercent,
  dockerStatsRowToSample,
  parseSshHostMetrics,
  makeUnavailableSample,
} from '../../electron/server-metrics.js';

describe('parseDockerByteSize', () => {
  it('parses binary (IEC) units', () => {
    expect(parseDockerByteSize('1KiB')).toBe(1024);
    expect(parseDockerByteSize('1MiB')).toBe(1024 ** 2);
    expect(parseDockerByteSize('1.5GiB')).toBeCloseTo(1.5 * 1024 ** 3);
  });

  it('parses decimal (SI) units', () => {
    expect(parseDockerByteSize('1kB')).toBe(1000);
    expect(parseDockerByteSize('2MB')).toBe(2_000_000);
  });

  it('handles whitespace and a bare byte value', () => {
    expect(parseDockerByteSize('512 B')).toBe(512);
    expect(parseDockerByteSize('900')).toBe(900);
  });

  it('returns NaN for unparseable input', () => {
    expect(Number.isNaN(parseDockerByteSize(undefined))).toBe(true);
    expect(Number.isNaN(parseDockerByteSize('--'))).toBe(true);
  });
});

describe('parseDockerPercent', () => {
  it('strips the percent sign', () => {
    expect(parseDockerPercent('12.34%')).toBeCloseTo(12.34);
    expect(parseDockerPercent('0.00%')).toBe(0);
  });

  it('returns NaN when missing', () => {
    expect(Number.isNaN(parseDockerPercent(undefined))).toBe(true);
  });
});

describe('dockerStatsRowToSample', () => {
  it('converts a full docker stats JSON row', () => {
    const sample = dockerStatsRowToSample({
      CPUPerc: '42.50%',
      MemUsage: '1.5GiB / 4GiB',
      MemPerc: '37.50%',
      NetIO: '1.2MB / 800kB',
      PIDs: '57',
    });

    expect(sample.ok).toBe(true);
    expect(sample.source).toBe('docker');
    expect(sample.cpuPercent).toBeCloseTo(42.5);
    expect(sample.memoryBytes).toBeCloseTo(1.5 * 1024 ** 3);
    expect(sample.memoryLimitBytes).toBeCloseTo(4 * 1024 ** 3);
    expect(sample.memoryPercent).toBeCloseTo(37.5);
    expect(sample.netRxBytes).toBe(1_200_000);
    expect(sample.netTxBytes).toBe(800_000);
    expect(sample.pids).toBe(57);
  });

  it('tolerates missing optional fields', () => {
    const sample = dockerStatsRowToSample({ CPUPerc: '5.00%' });
    expect(sample.ok).toBe(true);
    expect(sample.cpuPercent).toBeCloseTo(5);
    expect(sample.memoryBytes).toBeUndefined();
    expect(sample.pids).toBeUndefined();
  });
});

describe('parseSshHostMetrics', () => {
  it('derives CPU% from load average and memory from free -b', () => {
    const stdout = [
      '4',
      '2.00 1.50 1.20 1/345 9999',
      '              total        used        free      shared  buff/cache   available',
      'Mem:    8000000000  4000000000  1000000000   100000000  3000000000  3500000000',
      'Swap:   2000000000           0  2000000000',
    ].join('\n');

    const sample = parseSshHostMetrics(stdout, 4);
    expect(sample.ok).toBe(true);
    expect(sample.source).toBe('ssh');
    // load1 (2.0) / 4 cores * 100 = 50%
    expect(sample.cpuPercent).toBeCloseTo(50);
    expect(sample.memoryLimitBytes).toBe(8_000_000_000);
    expect(sample.memoryBytes).toBe(4_000_000_000);
    expect(sample.memoryPercent).toBeCloseTo(50);
  });

  it('caps CPU at 100% when load exceeds core count', () => {
    const sample = parseSshHostMetrics('8.00 4.00 2.00 2/100 555', 2);
    expect(sample.cpuPercent).toBe(100);
  });

  it('reports unavailable when nothing parses', () => {
    const sample = parseSshHostMetrics('garbage output', 4);
    expect(sample.ok).toBe(false);
    expect(sample.source).toBe('unavailable');
  });
});

describe('makeUnavailableSample', () => {
  it('builds a not-ok sample carrying the error', () => {
    const sample = makeUnavailableSample('nope');
    expect(sample.ok).toBe(false);
    expect(sample.source).toBe('unavailable');
    expect(sample.error).toBe('nope');
  });
});
