import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as os from 'os';

// ─── Mock electron ─────────────────────────────────────────────────────────────

vi.mock('electron', () => ({
  app: {
    getVersion: vi.fn(() => '4.0.0'),
    getPath: vi.fn((_key: string) => path.join(os.tmpdir(), 'starmade-updater-test')),
  },
  shell: {
    openExternal: vi.fn(() => Promise.resolve()),
  },
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a minimal GitHub release object */
function makeRelease(tag: string, prerelease = false, draft = false) {
  return {
    tag_name: tag,
    prerelease,
    draft,
    body: `Release notes for ${tag}`,
    assets: [],
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('checkForUpdates', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns available=false when already on the latest stable version', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => makeRelease('v4.0.0'),
    } as Response);

    const { checkForUpdates } = await import('../../electron/updater.js');
    const result = await checkForUpdates();

    expect(result.available).toBe(false);
    expect(result.latestVersion).toBe('4.0.0');
    expect(result.currentVersion).toBe('4.0.0');
  });

  it('returns available=true when a newer stable release exists', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => makeRelease('v4.1.0'),
    } as Response);

    const { checkForUpdates } = await import('../../electron/updater.js');
    const result = await checkForUpdates();

    expect(result.available).toBe(true);
    expect(result.latestVersion).toBe('4.1.0');
    expect(result.isPreRelease).toBe(false);
  });

  it('fetches all-releases endpoint when includePreReleases is true', async () => {
    const releases = [
      makeRelease('v4.2.0-beta.1', true),
      makeRelease('v4.1.0', false),
    ];

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => releases,
    } as Response);

    const { checkForUpdates } = await import('../../electron/updater.js');
    const result = await checkForUpdates({ includePreReleases: true });

    // Should pick the first non-draft release (the pre-release)
    expect(result.available).toBe(true);
    expect(result.latestVersion).toBe('4.2.0-beta.1');
    expect(result.isPreRelease).toBe(true);

    // Verify the all-releases endpoint was called
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/releases'),
      expect.any(Object),
    );
    const calledUrl = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).not.toContain('/releases/latest');
  });

  it('skips draft releases when includePreReleases is true', async () => {
    const releases = [
      makeRelease('v4.3.0-draft', false, true /* draft */),
      makeRelease('v4.2.0-beta.1', true),
    ];

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => releases,
    } as Response);

    const { checkForUpdates } = await import('../../electron/updater.js');
    const result = await checkForUpdates({ includePreReleases: true });

    // Should skip the draft and pick the pre-release
    expect(result.latestVersion).toBe('4.2.0-beta.1');
    expect(result.isPreRelease).toBe(true);
  });

  it('uses /releases/latest endpoint when includePreReleases is false (default)', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => makeRelease('v4.1.0'),
    } as Response);

    const { checkForUpdates } = await import('../../electron/updater.js');
    await checkForUpdates({ includePreReleases: false });

    const calledUrl = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).toContain('/releases/latest');
  });

  it('throws when the GitHub API returns a non-OK status', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 403,
    } as Response);

    const { checkForUpdates } = await import('../../electron/updater.js');
    await expect(checkForUpdates()).rejects.toThrow('HTTP 403');
  });

  it('throws when the all-releases response is an empty array', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    } as Response);

    const { checkForUpdates } = await import('../../electron/updater.js');
    await expect(checkForUpdates({ includePreReleases: true })).rejects.toThrow();
  });
});
