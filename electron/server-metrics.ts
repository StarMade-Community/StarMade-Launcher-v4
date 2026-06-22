// ─── Server runtime metrics sampling ──────────────────────────────────────────
//
// Provides point-in-time CPU / memory samples for a running StarMade server so
// the Server Panel's Performance tab can render live graphs. Local servers are
// sampled from their tracked process id; remote Docker / SSH samples are taken
// by their respective backends.
//
// No native modules are used — local sampling shells out to `ps` on
// macOS/Linux and PowerShell on Windows.

import { spawn } from 'node:child_process';
import os from 'node:os';
import type { ServerMetricsSample } from './remote-backend-types.js';

/** Run a command, collecting stdout, and resolve with the exit result. */
function runCommand(
  cmd: string,
  args: string[],
  timeoutMs: number,
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      resolve({ ok: false, stdout: '', stderr: String(error) });
      return;
    }

    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok, stdout, stderr });
    };

    const timer = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch { /* ignore */ }
      finish(false);
    }, timeoutMs);

    proc.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
    proc.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
    proc.on('error', () => finish(false));
    proc.on('close', (code) => finish(code === 0));
  });
}

function unavailable(error: string): ServerMetricsSample {
  return { ok: false, timestamp: Date.now(), source: 'unavailable', error };
}

/**
 * Sample CPU% and resident memory for a local process by pid.
 * Returns a sample with source 'local'. cpuPercent is percent of a single core.
 */
export async function sampleLocalProcessMetrics(
  pid: number | undefined,
  uptimeMs?: number,
): Promise<ServerMetricsSample> {
  if (!pid || !Number.isInteger(pid) || pid <= 0) {
    return unavailable('Server process is not running.');
  }

  const cpuCores = os.cpus().length || 1;
  const memoryLimitBytes = os.totalmem();

  if (process.platform === 'win32') {
    // Win32_PerfFormattedData_PerfProc_Process gives an instantaneous
    // PercentProcessorTime (0..100*cores) and WorkingSetPrivate in bytes.
    const psScript =
      `$p = Get-CimInstance Win32_PerfFormattedData_PerfProc_Process -Filter "IDProcess=${pid}";` +
      `if ($p) { "$($p.PercentProcessorTime) $($p.WorkingSetPrivate)" }`;
    const result = await runCommand(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', psScript],
      6000,
    );
    if (!result.ok) return unavailable('Could not read process metrics (PowerShell unavailable?).');
    const parts = result.stdout.trim().split(/\s+/);
    const cpuTotal = Number.parseFloat(parts[0]);
    const rssBytes = Number.parseFloat(parts[1]);
    if (!Number.isFinite(rssBytes)) return unavailable('Server process is not running.');
    const memoryBytes = rssBytes;
    return {
      ok: true,
      timestamp: Date.now(),
      source: 'local',
      // PercentProcessorTime is summed across cores; report as single-core percent.
      cpuPercent: Number.isFinite(cpuTotal) ? cpuTotal : undefined,
      cpuCores,
      memoryBytes,
      memoryLimitBytes,
      memoryPercent: memoryLimitBytes > 0 ? (memoryBytes / memoryLimitBytes) * 100 : undefined,
      uptimeMs,
      scopeLabel: 'Local server process',
    };
  }

  // macOS / Linux: ps reports %cpu (single-core percent) and rss in KiB.
  const result = await runCommand('ps', ['-p', String(pid), '-o', '%cpu=,rss='], 6000);
  if (!result.ok) return unavailable('Server process is not running.');
  const parts = result.stdout.trim().split(/\s+/);
  const cpuPercent = Number.parseFloat(parts[0]);
  const rssKib = Number.parseFloat(parts[1]);
  if (!Number.isFinite(rssKib)) return unavailable('Server process is not running.');
  const memoryBytes = rssKib * 1024;
  return {
    ok: true,
    timestamp: Date.now(),
    source: 'local',
    cpuPercent: Number.isFinite(cpuPercent) ? cpuPercent : undefined,
    cpuCores,
    memoryBytes,
    memoryLimitBytes,
    memoryPercent: memoryLimitBytes > 0 ? (memoryBytes / memoryLimitBytes) * 100 : undefined,
    uptimeMs,
    scopeLabel: 'Local server process',
  };
}

// ─── Parsing helpers shared with the Docker backend ──────────────────────────

/**
 * Parse a human-readable byte size as printed by `docker stats`
 * (e.g. "1.5GiB", "512MiB", "1.2GB", "900kB"). Returns bytes or NaN.
 */
export function parseDockerByteSize(raw: string | undefined): number {
  if (!raw) return Number.NaN;
  const match = raw.trim().match(/^([\d.]+)\s*([a-zA-Z]+)?$/);
  if (!match) return Number.NaN;
  const value = Number.parseFloat(match[1]);
  if (!Number.isFinite(value)) return Number.NaN;
  const unit = (match[2] ?? 'B').toLowerCase();
  const factors: Record<string, number> = {
    b: 1,
    kb: 1e3, kib: 1024,
    mb: 1e6, mib: 1024 ** 2,
    gb: 1e9, gib: 1024 ** 3,
    tb: 1e12, tib: 1024 ** 4,
  };
  const factor = factors[unit] ?? 1;
  return value * factor;
}

/** Parse a percentage string like "12.34%" into a number, or NaN. */
export function parseDockerPercent(raw: string | undefined): number {
  if (!raw) return Number.NaN;
  return Number.parseFloat(raw.replace('%', '').trim());
}

/**
 * Convert a `docker stats --format '{{json .}}'` row into a ServerMetricsSample.
 * Field names follow Docker's stats JSON: CPUPerc, MemUsage, MemPerc, NetIO, PIDs.
 */
export function dockerStatsRowToSample(row: {
  CPUPerc?: string;
  MemUsage?: string;
  MemPerc?: string;
  NetIO?: string;
  PIDs?: string;
}): ServerMetricsSample {
  const cpuPercent = parseDockerPercent(row.CPUPerc);
  const memPercent = parseDockerPercent(row.MemPerc);

  // MemUsage is "used / limit".
  let memoryBytes = Number.NaN;
  let memoryLimitBytes = Number.NaN;
  if (row.MemUsage) {
    const [used, limit] = row.MemUsage.split('/').map((s) => s.trim());
    memoryBytes = parseDockerByteSize(used);
    memoryLimitBytes = parseDockerByteSize(limit);
  }

  // NetIO is "rx / tx".
  let netRxBytes = Number.NaN;
  let netTxBytes = Number.NaN;
  if (row.NetIO) {
    const [rx, tx] = row.NetIO.split('/').map((s) => s.trim());
    netRxBytes = parseDockerByteSize(rx);
    netTxBytes = parseDockerByteSize(tx);
  }

  const pids = Number.parseInt(row.PIDs ?? '', 10);

  return {
    ok: true,
    timestamp: Date.now(),
    source: 'docker',
    cpuPercent: Number.isFinite(cpuPercent) ? cpuPercent : undefined,
    memoryBytes: Number.isFinite(memoryBytes) ? memoryBytes : undefined,
    memoryLimitBytes: Number.isFinite(memoryLimitBytes) ? memoryLimitBytes : undefined,
    memoryPercent: Number.isFinite(memPercent) ? memPercent : undefined,
    netRxBytes: Number.isFinite(netRxBytes) ? netRxBytes : undefined,
    netTxBytes: Number.isFinite(netTxBytes) ? netTxBytes : undefined,
    pids: Number.isFinite(pids) ? pids : undefined,
    scopeLabel: 'Docker container',
  };
}

/**
 * Parse SSH host telemetry output (loadavg + free -b) into a host-level sample.
 * Expected stdout: first line `cat /proc/loadavg`, then `free -b` output.
 */
export function parseSshHostMetrics(stdout: string, cpuCores: number): ServerMetricsSample {
  const lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean);

  let cpuPercent: number | undefined;
  let memoryBytes: number | undefined;
  let memoryLimitBytes: number | undefined;

  for (const line of lines) {
    // loadavg: "0.52 0.58 0.59 1/345 12345"
    const loadMatch = line.match(/^([\d.]+)\s+[\d.]+\s+[\d.]+\s+\d+\/\d+\s+\d+$/);
    if (loadMatch) {
      const load1 = Number.parseFloat(loadMatch[1]);
      if (Number.isFinite(load1) && cpuCores > 0) {
        cpuPercent = Math.min(100, (load1 / cpuCores) * 100);
      }
      continue;
    }
    // free -b: "Mem:  total used free shared buff/cache available"
    const memMatch = line.match(/^Mem:\s+(\d+)\s+(\d+)\s+(\d+)/);
    if (memMatch) {
      memoryLimitBytes = Number.parseInt(memMatch[1], 10);
      memoryBytes = Number.parseInt(memMatch[2], 10);
    }
  }

  if (cpuPercent === undefined && memoryBytes === undefined) {
    return unavailable('Could not read host metrics over SSH.');
  }

  return {
    ok: true,
    timestamp: Date.now(),
    source: 'ssh',
    cpuPercent,
    cpuCores,
    memoryBytes,
    memoryLimitBytes,
    memoryPercent:
      memoryBytes !== undefined && memoryLimitBytes && memoryLimitBytes > 0
        ? (memoryBytes / memoryLimitBytes) * 100
        : undefined,
    scopeLabel: 'Remote host (SSH)',
  };
}

export function makeUnavailableSample(error: string): ServerMetricsSample {
  return unavailable(error);
}
