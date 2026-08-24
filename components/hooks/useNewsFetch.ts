import { useState, useEffect, useRef } from 'react';

export interface NewsItem {
    gid: string;
    title: string;
    link: string;
    pubDate: string;
    author: string;
    imageUrl: string | null;
    contentSnippet: string;
}

const RETRY_DELAY_MS = 5000;
const MAX_RETRIES = 5;
/** How long a successful fetch stays fresh before we refetch on next mount. */
const CACHE_TTL_MS = 5 * 60 * 1000;
/** Abort a single proxy attempt that hangs, so we fall through to the next one
 * instead of leaving the feed stuck on "Loading…" forever. */
const REQUEST_TIMEOUT_MS = 10000;

const FEED_URL = 'https://store.steampowered.com/feeds/news/app/244770/';

/** Returns the feed as raw RSS XML, or throws. */
type FeedSource = (signal: AbortSignal) => Promise<string>;

/**
 * The main process fetches the feed directly — it isn't subject to CORS, so no
 * third party is involved and nothing can rate-limit us.
 */
const viaMainProcess: FeedSource = async () => {
    const result = await window.launcher.news.fetch();
    if (!result.success || !result.xml) {
        throw new Error(result.error ?? 'Main-process news fetch failed.');
    }
    return result.xml;
};

/**
 * Public CORS proxies. Only reachable when the UI runs in a plain browser
 * (`vite dev`) rather than Electron: they are free services that are down often
 * enough that relying on them is what made the feed almost always fail.
 */
const PROXIES: ((url: string) => string)[] = [
    (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    (url) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
    (url) => `https://thingproxy.freeboard.io/fetch/${url}`,
];

const viaProxy = (buildProxyUrl: (url: string) => string): FeedSource => async (signal) => {
    const response = await fetch(buildProxyUrl(FEED_URL), { signal });
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    return response.text();
};

/** Sources tried in order, best first. */
export const feedSources = (): FeedSource[] => [
    ...(typeof window !== 'undefined' && window.launcher?.news ? [viaMainProcess] : []),
    ...PROXIES.map(viaProxy),
];

// Module-level cache shared across every useNewsFetch() instance. Because the
// News and Play pages each call this hook and get unmounted/remounted as the
// user navigates (or as the Play page re-renders when switching installs), the
// cache lets a remounted component reuse already-loaded news instead of
// refetching from scratch through the flaky proxy — which is what caused the
// feed to randomly revert to "failed to load" after a successful load.
let cachedNews: NewsItem[] = [];
let cacheTimestamp = 0;

const useNewsFetch = () => {
    const [news, setNews] = useState<NewsItem[]>(cachedNews);
    const [loading, setLoading] = useState(cachedNews.length === 0);
    const [error, setError] = useState<string | null>(null);
    const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const retryCountRef = useRef(0);
    const abortControllerRef = useRef<AbortController | null>(null);

    useEffect(() => {
        let cancelled = false;

        // If we already have fresh cached news, show it and skip the refetch.
        if (cachedNews.length > 0 && Date.now() - cacheTimestamp < CACHE_TTL_MS) {
            setNews(cachedNews);
            setLoading(false);
            setError(null);
            return;
        }

        const fetchNews = async () => {
            // Abort any in-flight request before starting a new one
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
            }
            abortControllerRef.current = new AbortController();
            const { signal } = abortControllerRef.current;

            setLoading(true);
            setError(null);
            try {
                // Try each source in turn; only give up (and trigger a retry)
                // once every source has failed for this attempt.
                let xml: Document | null = null;
                let lastError: unknown = null;
                for (const source of feedSources()) {
                    // Per-attempt timeout chained to the outer abort signal, so a
                    // hung source doesn't stall the whole fetch.
                    const timeoutController = new AbortController();
                    const onAbort = () => timeoutController.abort();
                    signal.addEventListener('abort', onAbort);
                    const timeoutId = setTimeout(() => timeoutController.abort(), REQUEST_TIMEOUT_MS);
                    try {
                        const text = await source(timeoutController.signal);

                        const parser = new DOMParser();
                        const candidate = parser.parseFromString(text, 'application/xml');
                        if (candidate.querySelector('parsererror')) {
                            throw new Error('Feed source returned a non-XML body.');
                        }
                        // A valid RSS payload must contain at least one item; an
                        // empty body parses "successfully" but is useless, so
                        // treat it as a failure and move to the next source.
                        if (candidate.querySelectorAll('item').length === 0) {
                            throw new Error('Feed source returned an empty feed.');
                        }
                        xml = candidate;
                        break;
                    } catch (sourceError) {
                        // Propagate a real cancellation; otherwise record and try the next source.
                        if (signal.aborted) throw sourceError;
                        lastError = sourceError;
                        console.warn('News source failed, trying next:', sourceError);
                    } finally {
                        clearTimeout(timeoutId);
                        signal.removeEventListener('abort', onAbort);
                    }
                }

                if (!xml) {
                    throw lastError ?? new Error('Every news source failed.');
                }

                const items = xml.querySelectorAll('item');

                const parsedItems: NewsItem[] = Array.from(items).map(item => {
                    const title = item.querySelector('title')?.textContent || 'No title';
                    const link = item.querySelector('link')?.textContent || '#';
                    const pubDate = item.querySelector('pubDate')?.textContent || '';
                    const author = item.querySelector('author')?.textContent || 'Unknown author';
                    const gid = item.querySelector('guid')?.textContent || '';
                    const descriptionHTML = item.querySelector('description')?.textContent || '';

                    const descContainer = document.createElement('div');
                    descContainer.innerHTML = descriptionHTML;
                    
                    const img = descContainer.querySelector('img');
                    const imageUrl = img ? img.src : null;
                    
                    if (img) img.remove();
                    const contentSnippet = descContainer.textContent?.trim().substring(0, 200) + '...' || 'No content';

                    return {
                        gid,
                        title,
                        link,
                        pubDate: new Date(pubDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
                        author,
                        imageUrl,
                        contentSnippet,
                    };
                });

                // Always refresh the shared cache, even if this instance has
                // since unmounted, so the next mount gets the latest news.
                cachedNews = parsedItems;
                cacheTimestamp = Date.now();

                if (!cancelled) {
                    setNews(parsedItems);
                    setError(null);
                    retryCountRef.current = 0;
                    if (retryTimerRef.current !== null) {
                        clearTimeout(retryTimerRef.current);
                        retryTimerRef.current = null;
                    }
                }
            } catch (e: unknown) {
                // Ignore errors caused by intentional request cancellation
                if (e instanceof DOMException && e.name === 'AbortError') {
                    return;
                }
                console.error("News fetch error:", e);
                if (!cancelled) {
                    retryCountRef.current += 1;
                    // Only surface the error screen when we have nothing to show.
                    // If a previous load already populated the feed, keep showing
                    // it and retry quietly in the background instead of reverting.
                    const hasNewsToShow = cachedNews.length > 0;
                    const retryDelaySec = Math.round(RETRY_DELAY_MS / 1000);
                    if (retryCountRef.current <= MAX_RETRIES) {
                        if (!hasNewsToShow) {
                            setError(`Failed to load the news feed. Retrying in ${retryDelaySec}s (attempt ${retryCountRef.current} of ${MAX_RETRIES})...`);
                        }
                        if (retryTimerRef.current !== null) {
                            clearTimeout(retryTimerRef.current);
                        }
                        retryTimerRef.current = setTimeout(() => {
                            if (!cancelled) {
                                fetchNews();
                            }
                        }, RETRY_DELAY_MS);
                    } else if (!hasNewsToShow) {
                        setError('Failed to load the news feed. Please check your internet connection and try again later.');
                    }
                }
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        };

        fetchNews();

        return () => {
            cancelled = true;
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
                abortControllerRef.current = null;
            }
            if (retryTimerRef.current !== null) {
                clearTimeout(retryTimerRef.current);
                retryTimerRef.current = null;
            }
        };
    }, []);

    return { news, loading, error };
};

export default useNewsFetch;
