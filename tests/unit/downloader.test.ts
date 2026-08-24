import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http   from 'http';
import fs     from 'fs';
import os     from 'os';
import path   from 'path';
import crypto from 'crypto';

import { startDownload } from '../../electron/downloader.js';

// ─── Fake CDN ────────────────────────────────────────────────────────────────
//
// Each fixture reproduces one real failure mode:
//   flaky.bin    truncates, then honours the Range header on the retry
//   norange.bin  truncates, then ignores the Range header on the retry
//   corrupt.bin  always serves the right number of wrong bytes
//   gone.bin     always 404s

const BODY = Buffer.from('abcdefgh'.repeat(16));           // 128 bytes
const HASH = crypto.createHash('sha1').update(BODY).digest('hex');
const BAD  = Buffer.alloc(BODY.length, 0x5a);              // right size, wrong bytes

let server: http.Server;
let hits:   Record<string, number>;
let ranges: Record<string, string[]>;

beforeEach(() => { hits = {}; ranges = {}; });

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const name = (req.url ?? '').split('/').pop()!;

    if (name === 'checksums') {
      const file = req.url!.split('/').slice(-2)[0] + '.bin';
      res.writeHead(200);
      res.end(`./${file} ${BODY.length} ${HASH}\n`);
      return;
    }

    hits[name] = (hits[name] ?? 0) + 1;
    const range = req.headers.range;
    if (range) (ranges[name] ??= []).push(range);

    if (name === 'gone.bin')    { res.writeHead(404); res.end(); return; }
    if (name === 'corrupt.bin') { res.writeHead(200); res.end(BAD); return; }

    // A plain (non-Range) fetch hangs up after a partial body. The destroy is
    // deferred until that write has actually reached the wire, otherwise the
    // client never sees the bytes and there is nothing to resume from.
    if (!range) {
      res.writeHead(200, { 'Content-Length': String(BODY.length) });
      res.write(BODY.subarray(0, 40), () => setTimeout(() => res.socket?.destroy(), 50));
      return;
    }

    // Retry: honour the Range header, unless this is the fixture that doesn't.
    if (range && name !== 'norange.bin') {
      const start = Number(/bytes=(\d+)-/.exec(range)![1]);
      res.writeHead(206, { 'Content-Range': `bytes ${start}-${BODY.length - 1}/${BODY.length}` });
      res.end(BODY.subarray(start));
      return;
    }

    res.writeHead(200);
    res.end(BODY);
  });

  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as { port: number };
  process.env.STARMADE_CDN_URL = `http://127.0.0.1:${port}`;
});

afterAll(() => new Promise<void>(r => server.close(() => r())));

function run(build: string, targetDir: string) {
  return new Promise<{ ok: boolean; error?: string; bytes: number }>((resolve) => {
    let bytes = 0;
    void startDownload(
      'test-install',
      `./build/${build}`,
      targetDir,
      (p) => { bytes = p.bytesReceived; },
      ()  => resolve({ ok: true, bytes }),
      (e) => resolve({ ok: false, error: e, bytes }),
    );
  });
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sm-dl-'));
}

describe('startDownload', () => {
  it('resumes a truncated file from where it stopped', async () => {
    const dir = tmpDir();

    const result = await run('flaky', dir);

    expect(result.ok).toBe(true);
    expect(hits['flaky.bin']).toBe(2);
    // The retry asked for only the missing tail, not the whole file again.
    expect(ranges['flaky.bin']).toEqual(['bytes=40-']);
    expect(fs.readFileSync(path.join(dir, 'flaky.bin'))).toEqual(BODY);
    expect(fs.existsSync(path.join(dir, 'flaky.bin.tmp'))).toBe(false);
    // Resumed bytes are counted once, not twice.
    expect(result.bytes).toBe(BODY.length);

    fs.rmSync(dir, { recursive: true, force: true });
  }, 20_000);

  it('starts over when the server ignores the Range header', async () => {
    const dir = tmpDir();

    const result = await run('norange', dir);

    expect(result.ok).toBe(true);
    expect(ranges['norange.bin']).toEqual(['bytes=40-']);       // asked...
    expect(fs.readFileSync(path.join(dir, 'norange.bin'))).toEqual(BODY);  // ...and coped
    expect(result.bytes).toBe(BODY.length);

    fs.rmSync(dir, { recursive: true, force: true });
  }, 20_000);

  it('rejects a file whose SHA-1 does not match and discards the partial', async () => {
    const dir = tmpDir();

    const result = await run('corrupt', dir);

    expect(result.ok).toBe(false);
    expect(result.error).toContain('corrupt.bin');
    expect(result.error).toContain('Checksum mismatch');
    expect(fs.existsSync(path.join(dir, 'corrupt.bin'))).toBe(false);
    // A poisoned partial must not be left behind for the next run to resume.
    expect(fs.existsSync(path.join(dir, 'corrupt.bin.tmp'))).toBe(false);

    fs.rmSync(dir, { recursive: true, force: true });
  }, 20_000);

  it('sweeps orphaned .tmp files but keeps the one it can resume', async () => {
    const dir = tmpDir();
    fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
    // Left by a build that no longer ships this path.
    fs.writeFileSync(path.join(dir, 'data', 'stale.bin.tmp'), 'junk');
    // A resumable partial for the file this build *does* ship.
    fs.writeFileSync(path.join(dir, 'flaky.bin.tmp'), BODY.subarray(0, 40));

    const result = await run('flaky', dir);

    expect(result.ok).toBe(true);
    expect(fs.existsSync(path.join(dir, 'data', 'stale.bin.tmp'))).toBe(false);
    // The seeded partial was resumed rather than swept: a single ranged
    // request for the missing tail, no full re-fetch.
    expect(hits['flaky.bin']).toBe(1);
    expect(ranges['flaky.bin']).toEqual(['bytes=40-']);
    expect(fs.readFileSync(path.join(dir, 'flaky.bin'))).toEqual(BODY);

    fs.rmSync(dir, { recursive: true, force: true });
  }, 20_000);

  it('reports a reason naming the file when a download is terminally broken', async () => {
    const dir = tmpDir();

    const result = await run('gone', dir);

    expect(result.ok).toBe(false);
    expect(result.error).toContain('gone.bin');
    expect(result.error).toContain('404');
    expect(hits['gone.bin']).toBe(1);        // 4xx is terminal, not retried
    expect(fs.existsSync(path.join(dir, 'gone.bin'))).toBe(false);

    fs.rmSync(dir, { recursive: true, force: true });
  }, 20_000);
});
