import React, { useState, useEffect } from 'react';
import { ChevronRightIcon } from '../../common/icons';
import { useApp } from '../../../contexts/AppContext';
import useNewsFetch from '../../hooks/useNewsFetch';
import { getBackgroundList } from '../../hooks/useRandomBackground';

interface DisplayNewsItem {
    id: string;
    title: string;
    category: string;
    date: string;
    imageUrl: string;
    link: string;
}

/**
 * Categorize a news item based on its title.
 * Checks for version-number patterns (e.g. "0.204.703", "v3.0.9") first so
 * that update posts aren't mis-filed as COMMUNITY.
 */
const categorizeNews = (title: string): string => {
    const t = title.toLowerCase();

    // Any title containing a version-number-like token is an update
    if (/v?\d+\.\d+[.\d]*/.test(t)) return 'GAME UPDATES';

    if (t.includes('update') || t.includes('patch') ||
        t.includes('release') || t.includes('hotfix')) return 'GAME UPDATES';

    if (t.includes('launcher')) return 'GAME UPDATES';

    if (t.includes('dev diary') || t.includes('development') ||
        t.includes('dev blog')) return 'DEVELOPMENT';

    if (t.includes('mod') || t.includes('spotlight')) return 'MODS';

    if (t.includes('guide') || t.includes('tutorial') ||
        t.includes('how to')) return 'GUIDES';

    return 'COMMUNITY';
};

const HeroNewsCard: React.FC<{ item: DisplayNewsItem }> = ({ item }) => (
    <a
        href={item.link}
        target="_blank"
        rel="noopener noreferrer"
        className="col-span-2 row-span-3 h-[450px] bg-black/20 rounded-lg p-3 border border-transparent hover:border-white/10 transition-all cursor-pointer group"
    >
        <div 
            className="w-full h-full rounded-md overflow-hidden relative flex flex-col justify-end p-6 bg-cover bg-center transition-transform group-hover:scale-105"
            style={{ 
                backgroundImage: item.imageUrl ? `url(${item.imageUrl})` : 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
                backgroundColor: '#0f172a'
            }}
        >
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent group-hover:from-black/90 transition-all"></div>
            <div className="relative z-10 text-white">
                <p className="text-sm font-semibold uppercase tracking-widest text-starmade-text-accent">{item.category}</p>
                <h2 className="font-display text-4xl font-bold mt-2 mb-3">{item.title}</h2>
                <p className="text-xs text-gray-300 uppercase tracking-wider">{item.date}</p>
            </div>
            <div className="absolute top-4 right-4 bg-black/30 p-2 rounded-full opacity-0 group-hover:opacity-100 transition-opacity transform group-hover:translate-x-0 translate-x-2">
                <ChevronRightIcon className="w-6 h-6 text-white" />
            </div>
        </div>
    </a>
);

const SmallNewsCard: React.FC<{ item: DisplayNewsItem }> = ({ item }) => (
    <a
        href={item.link}
        target="_blank"
        rel="noopener noreferrer"
        className="bg-black/20 p-3 rounded-lg flex gap-4 items-center group cursor-pointer hover:bg-black/40 border border-transparent hover:border-white/10 transition-all"
    >
        <div 
            className="w-28 h-20 rounded-md bg-cover bg-center flex-shrink-0"
            style={{ 
                backgroundImage: item.imageUrl ? `url(${item.imageUrl})` : 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
                backgroundColor: '#1e293b'
            }}
        />
        <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-starmade-text-accent">{item.category}</p>
            <h3 className="font-semibold text-white leading-tight mt-1 group-hover:text-green-300 transition-colors line-clamp-2">{item.title}</h3>
            <p className="text-xs text-gray-400 mt-2">{item.date}</p>
        </div>
    </a>
);

const Play: React.FC = () => {
    const { navigate } = useApp();
    const { news, loading, error } = useNewsFetch();
    const [fallbackImages, setFallbackImages] = useState<string[]>([]);

    // Load the background pool once so we can assign random images to imageless news cards
    useEffect(() => {
        getBackgroundList().then(list => setFallbackImages(list));
    }, []);

    // Convert RSS news to display format with categories
    // fallbackImages.slice(1) — index 0 is reserved for the app background
    const newsBackgrounds = fallbackImages.slice(1);
    const displayNews: DisplayNewsItem[] = news.map((item, i) => ({
        id: item.gid,
        title: item.title,
        category: categorizeNews(item.title),
        date: item.pubDate,
        imageUrl: item.imageUrl || (newsBackgrounds.length > 0
            ? newsBackgrounds[i % newsBackgrounds.length]
            : ''),
        link: item.link,
    }));

    // Find the latest "GAME UPDATES" news for the hero section
    const heroItem = displayNews.find(item => item.category === 'GAME UPDATES') || displayNews[0];
    
    // Get other news (not game updates) for the sidebar, max 3
    const sidebarItems = displayNews
        .filter(item => item.id !== heroItem?.id)
        .slice(0, 3);

    if (loading) {
        return (
            <div className="w-full max-w-6xl mx-auto">
                <div className="flex justify-between items-center mb-6">
                    <h1 className="font-display text-3xl font-bold uppercase text-white tracking-wider">
                        Latest News
                    </h1>
                </div>
                <div className="grid grid-cols-3 gap-6">
                    <div className="col-span-2 row-span-3 h-[450px] bg-black/20 rounded-lg animate-pulse" />
                    <div className="col-span-1 flex flex-col gap-4">
                        <div className="h-32 bg-black/20 rounded-lg animate-pulse" />
                        <div className="h-32 bg-black/20 rounded-lg animate-pulse" />
                        <div className="h-32 bg-black/20 rounded-lg animate-pulse" />
                    </div>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="w-full max-w-6xl mx-auto">
                <div className="flex justify-between items-center mb-6">
                    <h1 className="font-display text-3xl font-bold uppercase text-white tracking-wider">
                        Latest News
                    </h1>
                </div>
                <div className="bg-red-900/20 border border-red-500/50 rounded-lg p-6 text-center">
                    <p className="text-red-400">{error}</p>
                    <p className="text-gray-400 text-sm mt-2">Please check your internet connection</p>
                </div>
            </div>
        );
    }

    return (
        <div className="w-full max-w-6xl mx-auto">
             <div className="flex justify-between items-center mb-6">
                <h1 className="font-display text-3xl font-bold uppercase text-white tracking-wider">
                    Latest News
                </h1>
                <button
                    onClick={() => navigate('News')}
                    className="flex items-center gap-2 text-gray-300 hover:text-white transition-colors text-sm font-semibold uppercase tracking-wider"
                >
                    <span>View All News</span>
                    <ChevronRightIcon className="w-4 h-4" />
                </button>
            </div>
            <div className="grid grid-cols-3 gap-6">
                {heroItem && <HeroNewsCard item={heroItem} />}
                <div className="col-span-1 flex flex-col gap-4">
                    {sidebarItems.map(item => <SmallNewsCard key={item.id} item={item} />)}
                </div>
            </div>
        </div>
    );
};

export default Play;
