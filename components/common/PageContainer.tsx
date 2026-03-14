import React from 'react';
import { CloseIcon, MaximizeIcon } from './icons';
import { useApp } from '../../contexts/AppContext';
import type { Page } from '../../types';

interface PageContainerProps {
    children: React.ReactNode;
    closeTarget?: Page;
    onPopOut?: () => void;
    resizable?: boolean;
}

const PageContainer: React.FC<PageContainerProps> = ({
    children,
    closeTarget = 'Play',
    onPopOut,
    resizable = false,
}) => {
    const { navigate } = useApp();

    return (
        <div className={`relative mx-auto flex flex-col bg-black/50 backdrop-blur-md border border-white/10 rounded-xl overflow-hidden animate-fade-in-scale ${
            resizable
                ? 'w-[min(96vw,1400px)] h-[min(84vh,920px)] min-w-[960px] min-h-[580px] max-h-[88vh] max-w-none resize'
                : 'w-full max-w-6xl h-full'
        }`}>
            <div className="absolute top-1 right-1 z-10 flex items-center gap-1">
                {onPopOut && (
                    <button
                        onClick={onPopOut}
                        className="p-1.5 rounded-md hover:bg-white/10 transition-colors"
                        aria-label="Pop out"
                        title="Pop out"
                    >
                        <MaximizeIcon className="w-4 h-4 text-gray-300" />
                    </button>
                )}
                <button
                    onClick={() => navigate(closeTarget)}
                    className="p-1.5 rounded-md hover:bg-starmade-danger/20 transition-colors"
                    aria-label="Close"
                >
                    <CloseIcon className="w-5 h-5 text-gray-400 hover:text-starmade-danger-light" />
                </button>
            </div>
            <div className="flex-grow p-6 flex flex-col min-h-0">
                {children}
            </div>
        </div>
    );
};

export default PageContainer;
