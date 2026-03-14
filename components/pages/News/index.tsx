import React from 'react';
import { ChevronRightIcon } from '../../common/icons';
import useNewsFetch from '../../hooks/useNewsFetch';
import PageContainer from '../../common/PageContainer';
import { useApp } from '../../../contexts/AppContext';

const NewsContent: React.FC<{ text: string }> = ({ text }) => {
    // Split the text by [c]...[/c] tags, keeping the tags as part of the result array
    const parts = text.split(/(\[c\].*?\[\/c\])/g);

    return (
        <>
            {parts.map((part, i) => {
                if (part.startsWith('[c]') && part.endsWith('[/c]')) {
                    // This is a code block, render it as a <code> element
                    return (
                        <code
                            key={i}
                            className="bg-slate-800 text-starmade-text-accent font-mono py-0.5 px-1.5 rounded-sm text-xs"
                        >
                            {part.substring(3, part.length - 4)}
                        </code>
                    );
                }
                // This is a normal text part
                return part;
            })}
        </>
    );
};

const News: React.FC = () => {
    const { news, loading, error } = useNewsFetch();
    
    const LoadingSpinner: React.FC = () => (
        <div className="flex flex-col items-center justify-center gap-4 h-full">
            <span aria-hidden="true" className="h-4 w-4 animate-pulse rounded-full bg-white" />
            <p className="text-xl font-display text-white tracking-wider">Loading News...</p>
        </div>
    );

    const renderContent = () => {
        if (loading) {
            return <LoadingSpinner />;
        }
    
        if (error) {
            return (
                <div className="flex justify-center items-center h-full text-center">
                    <p className="text-xl font-display text-red-400">{error}</p>
                </div>
            );
        }

        return (
            <div className="flex-grow overflow-y-auto pr-4 space-y-6">
                {news.map(item => (
                    <a 
                        key={item.gid} 
                        href={item.link} 
                        target="_blank" 
                        rel="noopener noreferrer" 
                        className="block bg-black/20 p-4 rounded-lg group hover:bg-black/40 border border-transparent hover:border-white/10 transition-all"
                    >
                        <div className="flex flex-col md:flex-row gap-6">
                            {item.imageUrl && (
                                <img src={item.imageUrl} alt={item.title} className="w-full md:w-56 h-auto md:h-32 object-cover rounded-md flex-shrink-0" />
                            )}
                            <div className="flex-1">
                                <p className="text-sm text-gray-400 mb-1">{item.pubDate} by {item.author}</p>
                                <h2 className="font-display text-xl font-bold text-white group-hover:text-starmade-text-accent transition-colors mb-2">{item.title}</h2>
                                <p className="text-gray-300 text-sm leading-relaxed">
                                    <NewsContent text={item.contentSnippet} />
                                </p>
                                <div className="mt-3 flex items-center text-starmade-text-accent font-semibold text-sm">
                                    <span>Read More</span>
                                    <ChevronRightIcon className="w-4 h-4 ml-1 transform group-hover:translate-x-1 transition-transform" />
                                </div>
                            </div>
                        </div>
                    </a>
                ))}
            </div>
        );
    }

    return (
        <PageContainer>
            <div className="h-full flex flex-col">
                <h1 className="font-display text-3xl font-bold uppercase text-white mb-6 tracking-wider flex-shrink-0">
                    News Feed
                </h1>
                {renderContent()}
            </div>
        </PageContainer>
    );
};

export default News;
