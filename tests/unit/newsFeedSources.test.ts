// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { feedSources } from '../../components/hooks/useNewsFetch';

const RSS = '<rss><channel><item><title>Patch</title></item></channel></rss>';

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).launcher;
  vi.restoreAllMocks();
});

describe('news feed sources', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); });

  it('uses the main process first when running in Electron', async () => {
    const mainFetch = vi.fn().mockResolvedValue({ success: true, xml: RSS });
    (window as unknown as Record<string, unknown>).launcher = { news: { fetch: mainFetch } };

    const sources = feedSources();
    await expect(sources[0](new AbortController().signal)).resolves.toBe(RSS);

    expect(mainFetch).toHaveBeenCalledTimes(1);
    // No third-party proxy is contacted when the main process can do the job.
    expect(fetch).not.toHaveBeenCalled();
  });

  it('surfaces the main-process reason so the next source is tried', async () => {
    (window as unknown as Record<string, unknown>).launcher = {
      news: { fetch: vi.fn().mockResolvedValue({ success: false, error: 'HTTP 503 fetching the Steam news feed' }) },
    };

    await expect(feedSources()[0](new AbortController().signal))
      .rejects.toThrow('HTTP 503 fetching the Steam news feed');
  });

  it('falls back to the CORS proxies outside Electron', async () => {
    const sources = feedSources();
    expect(sources).toHaveLength(3);   // proxies only, no main-process source

    vi.mocked(fetch).mockResolvedValue({ ok: true, text: () => Promise.resolve(RSS) } as Response);
    await expect(sources[0](new AbortController().signal)).resolves.toBe(RSS);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
