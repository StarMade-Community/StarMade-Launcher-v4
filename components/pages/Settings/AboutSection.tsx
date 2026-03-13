import React, { useEffect, useState } from 'react';
import { ChevronRightIcon } from '../../common/icons';

const AboutSection: React.FC = () => {
    const [version, setVersion] = useState<string>('...');

    useEffect(() => {
        const getVersion = window.launcher?.updater?.getVersion;
        if (!getVersion) {
            setVersion('unknown');
            return;
        }

        getVersion().then(setVersion).catch(() => setVersion('unknown'));
    }, []);

    const links = [
        { name: "Official Website", url: "https://www.star-made.org/" },
        { name: "Community Discord", url: "https://discord.gg/SXbkYpU" },
        { name: "Report an Issue", url: "https://github.com/StarMade-Community/StarMade-Launcher-v4/issues" },
        { name: "Third-Party Licenses", url: "#" },
    ]

    return (
        <div>
            <div className="text-center mb-8">
                <h1 className="font-display text-4xl font-bold text-white">StarMade Launcher</h1>
                <p className="text-lg text-gray-400 mt-1">Version {version}</p>
            </div>
            
            <div className="bg-black/20 p-6 rounded-lg border border-white/10 max-w-lg mx-auto">
                 <h2 className="font-display text-xl font-bold uppercase tracking-wider text-white mb-4">
                    Credits & Information
                </h2>
                <p className="text-gray-300 mb-6">
                    The official launcher for StarMade, designed to provide a modern and feature-rich experience.
                    All game assets and the StarMade name are property of Schine GmbH.
                </p>

                <h3 className="font-semibold text-white mb-3">Useful Links</h3>
                <div className="space-y-2">
                    {links.map(link => (
                         <a 
                            key={link.name} 
                            href={link.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex justify-between items-center p-3 rounded-md bg-slate-800/60 hover:bg-slate-700/80 transition-colors group"
                        >
                            <span className="font-semibold">{link.name}</span>
                            <ChevronRightIcon className="w-5 h-5 text-gray-400 group-hover:text-white transition-transform group-hover:translate-x-1" />
                        </a>
                    ))}
                </div>
            </div>

            <div className="text-center mt-8 text-sm text-gray-500">
                <p>Created by DukeofRealms</p>
                <p>Happy building, citizens!</p>
            </div>
        </div>
    );
};

export default AboutSection;