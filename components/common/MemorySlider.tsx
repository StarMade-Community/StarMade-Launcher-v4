import React from 'react';

const MIN_MEMORY = 2048; // 2GB
const MAX_MEMORY = 16384; // 16GB
const STEP = 1024; // 1GB

interface MemorySliderProps {
    value: number; // in MB
    onChange: (value: number) => void; // in MB
}

const MemorySlider: React.FC<MemorySliderProps> = ({ value, onChange }) => {
    
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
        const clampedValue = Math.max(MIN_MEMORY, Math.min(MAX_MEMORY, newValue));
        const snappedValue = Math.round(clampedValue / STEP) * STEP;
        onChange(snappedValue);
    }
    
    const getMemoryMarkers = () => {
        const markers = [];
        const interval = MAX_MEMORY <= 16384 ? 2048 : 4096;
        for (let i = MIN_MEMORY; i <= MAX_MEMORY; i += interval) {
            markers.push(i);
        }
        return markers;
    };
    
    const memoryPercentage = ((value - MIN_MEMORY) / (MAX_MEMORY - MIN_MEMORY)) * 100;
    const markers = getMemoryMarkers();

    return (
        <div className="flex items-center gap-4 w-full">
            <div className="flex-1 px-3">
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
                        max={MAX_MEMORY}
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
                <div className="relative mt-2 h-4">
                    {markers.map((marker) => {
                        const markerPos = ((marker - MIN_MEMORY) / (MAX_MEMORY - MIN_MEMORY)) * 100;
                        return (
                            <div
                                key={marker}
                                className="absolute flex flex-col items-center transform -translate-x-1/2"
                                style={{ left: `${markerPos}%` }}
                            >
                                <div className="w-px h-2 bg-slate-600 mb-1" />
                                <span className="text-xs text-gray-500">
                                    {marker / 1024}GB
                                </span>
                            </div>
                        );
                    })}
                </div>
            </div>
            <div className="flex items-center gap-2">
                <input
                    type="number"
                    value={value}
                    onChange={handleInputChange}
                    min={MIN_MEMORY}
                    max={MAX_MEMORY}
                    step={STEP}
                    className="w-24 bg-slate-900/80 border border-slate-700 rounded-md px-3 py-2 text-center focus:outline-none focus:ring-2 focus:ring-starmade-accent"
                />
                <span className="text-sm text-gray-400">MB</span>
            </div>
        </div>
    );
};

export default MemorySlider;
