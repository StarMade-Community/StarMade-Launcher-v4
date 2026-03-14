import React, { useEffect, useState } from 'react';
import { ChevronRightIcon } from '../../common/icons';

interface LicenseFileInfo {
    fileName: string;
    sizeBytes: number;
    modifiedMs: number;
}

const AboutSection: React.FC = () => {
    const [version, setVersion] = useState<string>('...');
    const [licensesOpen, setLicensesOpen] = useState(false);
    const [licenses, setLicenses] = useState<LicenseFileInfo[]>([]);
    const [selectedLicense, setSelectedLicense] = useState<string | null>(null);
    const [licenseContent, setLicenseContent] = useState('');
    const [licenseError, setLicenseError] = useState<string | null>(null);
    const [licenseStatus, setLicenseStatus] = useState<string | null>(null);
    const [licensesLoading, setLicensesLoading] = useState(false);

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
    ];

    const loadLicenses = async (): Promise<void> => {
        if (!window.launcher?.licenses?.list) {
            setLicenseError('License viewer is only available inside the desktop launcher.');
            return;
        }

        setLicensesLoading(true);
        setLicenseError(null);

        try {
            const files = await window.launcher.licenses.list();
            setLicenses(files);

            const first = files[0]?.fileName ?? null;
            setSelectedLicense(first);

            if (first && window.launcher?.licenses?.read) {
                const result = await window.launcher.licenses.read(first);
                if (result.error) {
                    setLicenseContent('');
                    setLicenseError(result.error);
                } else {
                    setLicenseContent(result.content);
                }
            } else {
                setLicenseContent('');
            }
        } catch (error) {
            setLicenseError(String(error));
            setLicenses([]);
            setSelectedLicense(null);
            setLicenseContent('');
        } finally {
            setLicensesLoading(false);
        }
    };

    const handleOpenLicenses = (): void => {
        setLicenseStatus(null);
        setLicenseError(null);
        setLicensesOpen(true);
        void loadLicenses();
    };

    const handleSelectLicense = async (fileName: string): Promise<void> => {
        if (!window.launcher?.licenses?.read) return;
        setSelectedLicense(fileName);
        setLicenseError(null);
        setLicenseStatus(null);

        const result = await window.launcher.licenses.read(fileName);
        if (result.error) {
            setLicenseContent('');
            setLicenseError(result.error);
            return;
        }

        setLicenseContent(result.content);
    };

    const handleCopyLicenses = async (): Promise<void> => {
        if (!window.launcher?.licenses?.copyToUserData) return;
        setLicenseError(null);
        setLicenseStatus(null);

        const result = await window.launcher.licenses.copyToUserData();
        if (!result.success) {
            setLicenseError(result.error ?? 'Failed to copy licenses to user data.');
            return;
        }

        setLicenseStatus(`Copied ${result.copiedCount} license file(s) to ${result.destinationDir ?? 'user data'}.`);
    };

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
                    <button
                        type="button"
                        onClick={handleOpenLicenses}
                        className="w-full flex justify-between items-center p-3 rounded-md bg-slate-800/60 hover:bg-slate-700/80 transition-colors group"
                    >
                        <span className="font-semibold text-left">Third-Party Licenses</span>
                        <ChevronRightIcon className="w-5 h-5 text-gray-400 group-hover:text-white transition-transform group-hover:translate-x-1" />
                    </button>
                </div>
            </div>

            <div className="text-center mt-8 text-sm text-gray-500">
                <p>Created by DukeofRealms</p>
                <p>Happy building, citizens!</p>
            </div>

            {licensesOpen && (
                <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-8">
                    <div className="w-full max-w-6xl h-[80vh] rounded-xl border border-white/10 bg-slate-950/95 flex flex-col">
                        <div className="flex items-center justify-between gap-3 p-4 border-b border-white/10">
                            <h2 className="font-display text-xl uppercase tracking-wider text-white">Third-Party Licenses</h2>
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => void handleCopyLicenses()}
                                    className="px-3 py-2 rounded-md bg-slate-800 hover:bg-slate-700 text-sm"
                                >
                                    Copy to User Data
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setLicensesOpen(false)}
                                    className="px-3 py-2 rounded-md bg-slate-800 hover:bg-slate-700 text-sm"
                                >
                                    Close
                                </button>
                            </div>
                        </div>

                        <div className="flex flex-1 min-h-0">
                            <aside className="w-80 border-r border-white/10 p-3 overflow-y-auto">
                                {licensesLoading && <p className="text-sm text-gray-300">Loading licenses...</p>}
                                {!licensesLoading && licenses.length === 0 && (
                                    <p className="text-sm text-gray-400">No bundled licenses were found.</p>
                                )}
                                <div className="space-y-1">
                                    {licenses.map((item) => (
                                        <button
                                            key={item.fileName}
                                            type="button"
                                            onClick={() => void handleSelectLicense(item.fileName)}
                                            className={`w-full text-left px-3 py-2 rounded-md text-sm ${selectedLicense === item.fileName ? 'bg-starmade-accent/20 text-white' : 'bg-slate-900/70 hover:bg-slate-800 text-gray-200'}`}
                                        >
                                            <p className="truncate">{item.fileName}</p>
                                            <p className="text-xs text-gray-400">{(item.sizeBytes / 1024).toFixed(1)} KB</p>
                                        </button>
                                    ))}
                                </div>
                            </aside>

                            <section className="flex-1 p-4 overflow-y-auto">
                                {licenseStatus && <p className="text-sm text-emerald-300 mb-3">{licenseStatus}</p>}
                                {licenseError && <p className="text-sm text-red-300 mb-3">{licenseError}</p>}
                                {!selectedLicense && !licenseError && (
                                    <p className="text-sm text-gray-400">Select a license file to view its contents.</p>
                                )}
                                {selectedLicense && (
                                    <>
                                        <p className="text-sm text-gray-300 mb-2">{selectedLicense}</p>
                                        <pre className="whitespace-pre-wrap break-words text-xs leading-relaxed text-gray-200 bg-black/40 rounded-md p-3 border border-white/10">
                                            {licenseContent}
                                        </pre>
                                    </>
                                )}
                            </section>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AboutSection;