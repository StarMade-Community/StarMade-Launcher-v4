import React, { useState, useEffect } from 'react';

const MIN_MEMORY = 4096; // 4GB
const WARNING_THRESHOLD = 16384; // 16GB — warn above this
const STEP = 1024; // 1GB

interface MemorySliderProps {
    value: number; // in MB
    onChange: (value: number) => void; // in MB
}

const MemorySlider: React.FC<MemorySliderProps> = ({ value, onChange }) => {
    const [maxMemory, setMaxMemory] = useState<number>(WARNING_THRESHOLD);

    useEffect(() => {
        if (window.launcher?.app?.getSystemMemory) {
            window.launcher.app.getSystemMemory().then((totalMb) => {
                // Floor to nearest GB, minimum 4GB
                const flooredMb = Math.max(MIN_MEMORY, Math.floor(totalMb / STEP) * STEP);
                setMaxMemory(flooredMb);
            }).catch(() => {
                // Fall back to 16GB if unavailable
                setMaxMemory(WARNING_THRESHOLD);
            });
        }
    }, []);

    const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newValue = parseInt(e.target.value, 10);
        handleValueChange(newValue);
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newValue = parseInt(e.target.value, 10);
        if (!isNaN(newValue)) {
            handleValueChange(newValue);
        }
    };

    const handleValueChange = (newValue: number) => {
        const clampedValue = Math.max(MIN_MEMORY, Math.min(maxMemory, newValue));
        const snappedValue = Math.round(clampedValue / STEP) * STEP;
        onChange(snappedValue);
    }
    
    const getMemoryMarkers = () => {
        const markers = [];
        const interval = maxMemory <= 16384 ? 2048 : 4096;
        for (let i = MIN_MEMORY; i <= maxMemory; i += interval) {
            markers.push(i);
        }
        return markers;
    };
    
    const memoryPercentage = ((value - MIN_MEMORY) / (maxMemory - MIN_MEMORY)) * 100;
    const markers = getMemoryMarkers();
    const showWarning = maxMemory > WARNING_THRESHOLD && value > WARNING_THRESHOLD;

    return (
        <div className="flex flex-col gap-2 w-full" data-testid="memory-slider-root">
            <div className="w-full max-w-[640px] min-w-[520px]" data-testid="memory-slider-layout">
                <div className="flex items-center gap-4 w-full">
                    <div className="flex-1 min-w-[360px] px-3">
                        <div className="relative">
                            <div className="h-2 bg-slate-800/80 rounded-full border border-slate-700 overflow-hidden">
                                <div 
                                    className="h-full bg-gradient-to-r from-starmade-accent/60 to-starmade-accent transition-all duration-150"
                                    style={{ width: `${memoryPercentage}%` }}
                                />
                            </div>
                            <input
                                type="range"
                                min={MIN_MEMORY}
                                max={maxMemory}
                                step={STEP}
                                value={value}
                                onChange={handleSliderChange}
                                className="absolute top-0 w-full h-2 opacity-0 cursor-pointer"
                                style={{ margin: 0 }}
                            />
                            <div 
                                className="absolute top-1/2 w-5 h-5 bg-starmade-accent rounded-full border-2 border-white shadow-lg transform -translate-y-1/2 -translate-x-1/2 pointer-events-none transition-all duration-150"
                                style={{ left: `${memoryPercentage}%` }}
                            >
                                <div className="absolute inset-0 rounded-full bg-white/20" />
                            </div>
                        </div>
                        <div className="relative mt-4 h-8">
                            {markers.map((marker, index) => {
                                const markerPos = ((marker - MIN_MEMORY) / (maxMemory - MIN_MEMORY)) * 100;
                                // Alternate labels above/below to prevent overlap
                                const isEven = index % 2 === 0;
                                return (
                                    <div
                                        key={marker}
                                        className="absolute flex flex-col items-center transform -translate-x-1/2"
                                        style={{ left: `${markerPos}%`, top: isEven ? '0' : '12px' }}
                                    >
                                        <div className="w-px h-3 bg-slate-600 mb-1" />
                                        <span className="text-xs text-gray-400 font-mono whitespace-nowrap">
                                            {marker / 1024}GB
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                    <div className="w-36 shrink-0 flex items-center justify-end gap-2">
                        <input
                            type="number"
                            value={value}
                            onChange={handleInputChange}
                            min={MIN_MEMORY}
                            max={maxMemory}
                            step={STEP}
                            className="w-24 bg-slate-900/80 border border-slate-700 rounded-md px-3 py-2 text-center focus:outline-none focus:ring-2 focus:ring-starmade-accent"
                        />
                        <span className="text-sm text-gray-400">MB</span>
                    </div>
                </div>
            </div>
            {showWarning && (
                <p className="text-xs text-yellow-400/80 px-3">
                    ⚠ Allocating more than 16 GB is not recommended — it may cause instability or be ignored by the JVM.
                </p>
            )}
        </div>
    );
};

export default MemorySlider;
