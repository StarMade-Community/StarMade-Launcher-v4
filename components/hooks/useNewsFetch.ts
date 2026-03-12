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

const useNewsFetch = () => {
    const [news, setNews] = useState<NewsItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const retryCountRef = useRef(0);
    const abortControllerRef = useRef<AbortController | null>(null);

    useEffect(() => {
        let cancelled = false;

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
                const feedUrl = 'https://store.steampowered.com/feeds/news/app/244770/';
                const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(feedUrl)}`;
                const response = await fetch(proxyUrl, { signal });
                
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                const text = await response.text();
                
                const parser = new DOMParser();
                const xml = parser.parseFromString(text, 'application/xml');

                const parseError = xml.querySelector('parsererror');
                if (parseError) {
                    console.error('XML Parsing Error:', parseError.textContent);
                    throw new Error('Failed to parse the news feed. The format might have changed or the proxy failed.');
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

                if (!cancelled) {
                    setNews(parsedItems);
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
                    const retryDelaySec = Math.round(RETRY_DELAY_MS / 1000);
                    if (retryCountRef.current <= MAX_RETRIES) {
                        setError(`Failed to load the news feed. Retrying in ${retryDelaySec}s (attempt ${retryCountRef.current} of ${MAX_RETRIES})...`);
                        if (retryTimerRef.current !== null) {
                            clearTimeout(retryTimerRef.current);
                        }
                        retryTimerRef.current = setTimeout(() => {
                            if (!cancelled) {
                                fetchNews();
                            }
                        }, RETRY_DELAY_MS);
                    } else {
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
