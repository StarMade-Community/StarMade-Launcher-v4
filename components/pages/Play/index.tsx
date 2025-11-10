import React from 'react';
import { ChevronRightIcon } from '../../common/icons';
import { useApp } from '../../../contexts/AppContext';

interface NewsItem {
    id: number;
    title: string;
    category: string;
    date: string;
    imageUrl: string;
    isHero?: boolean;
}

const newsData: NewsItem[] = [
    {
        id: 1,
        title: 'Universe Reset & New Features Deployed',
        category: 'GAME UPDATES',
        date: 'JUNE 14, 2024',
        imageUrl: 'https://i.imgur.com/biwBbge.png',
        isHero: true,
    },
    {
        id: 2,
        title: 'Mod Spotlight: Resources ReSourced',
        category: 'MODS',
        date: 'JUNE 10, 2024',
        imageUrl: 'https://starmadedock.net/attachments/starmade-screenshot-0073-png.59078/',
    },
    {
        id: 3,
        title: 'Dev Diary: Upcoming Faction System Rework',
        category: 'DEVELOPMENT',
        date: 'JUNE 5, 2024',
        imageUrl: 'https://starmadedock.net/attachments/1-png.64246/',
    },
    {
        id: 4,
        title: 'StarMade Server Hosting Guide',
        category: 'GUIDES',
        date: 'MAY 28, 2024',
        imageUrl: 'https://starmadedock.net/attachments/starmade-screenshot-0001-png.60943/',
    },
];

const HeroNewsCard: React.FC<{ item: NewsItem }> = ({ item }) => (
    <div
        className="col-span-2 row-span-3 h-[450px] bg-black/20 rounded-lg p-3 border border-transparent hover:border-white/10 transition-all cursor-pointer group"
    >
        <div 
            className="w-full h-full rounded-md overflow-hidden relative flex flex-col justify-end p-6 bg-cover bg-center transition-transform group-hover:scale-105"
            style={{ backgroundImage: `url(${item.imageUrl})` }}
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
    </div>
);

const SmallNewsCard: React.FC<{ item: NewsItem }> = ({ item }) => (
    <div className="bg-black/20 p-3 rounded-lg flex gap-4 items-center group cursor-pointer hover:bg-black/40 border border-transparent hover:border-white/10 transition-all">
        <img src={item.imageUrl} alt={item.title} className="w-28 h-20 object-cover rounded-md" />
        <div className="flex-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-starmade-text-accent">{item.category}</p>
            <h3 className="font-semibold text-white leading-tight mt-1 group-hover:text-green-300 transition-colors">{item.title}</h3>
            <p className="text-xs text-gray-400 mt-2">{item.date}</p>
        </div>
    </div>
);


const Play: React.FC = () => {
    const { navigate } = useApp();
    const heroItem = newsData.find(item => item.isHero);
    const otherItems = newsData.filter(item => !item.isHero);

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
                    {otherItems.map(item => <SmallNewsCard key={item.id} item={item} />)}
                </div>
            </div>
        </div>
    );
};

export default Play;
