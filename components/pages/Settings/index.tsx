import React, { useState, useEffect } from 'react';
import { CogIcon, UserIcon, InformationCircleIcon, ArchiveIcon } from '../../common/icons';
import LauncherSettings from './LauncherSettings';
import AccountSettings from './AccountSettings';
import AboutSection from './AboutSection';
import DefaultSettings from './DefaultSettings';
import type { SettingsSection } from '../../../types';
import PageContainer from '../../common/PageContainer';

interface SettingsProps {
    initialSection?: SettingsSection;
}

const Settings: React.FC<SettingsProps> = ({ initialSection }) => {
    const [activeSection, setActiveSection] = useState<SettingsSection>(initialSection || 'launcher');

    useEffect(() => {
        if (initialSection) {
            setActiveSection(initialSection);
        }
    }, [initialSection]);

    const menuItems = [
        { id: 'launcher', label: 'Launcher Settings', icon: CogIcon },
        { id: 'defaults', label: 'Default Settings', icon: ArchiveIcon },
        { id: 'accounts', label: 'Accounts', icon: UserIcon },
        { id: 'about', label: 'About', icon: InformationCircleIcon },
    ];

    const renderSection = () => {
        switch (activeSection) {
            case 'launcher':
                return <LauncherSettings />;
            case 'defaults':
                return <DefaultSettings />;
            case 'accounts':
                return <AccountSettings />;
            case 'about':
                return <AboutSection />;
            default:
                return null;
        }
    };

    return (
        <PageContainer>
            <div className="flex flex-grow min-h-0 -m-6">
                <aside className="w-64 bg-black/20 border-r border-white/10 p-4 flex-shrink-0">
                    <h1 className="font-display text-2xl font-bold uppercase text-white mb-8 tracking-wider px-2 pt-2">
                        Settings
                    </h1>
                    <nav className="flex flex-col gap-2">
                        {menuItems.map(item => (
                            <button
                                key={item.id}
                                onClick={() => setActiveSection(item.id as SettingsSection)}
                                className={`
                                    flex items-center gap-4 px-3 py-2.5 rounded-md text-left transition-colors text-base font-semibold
                                    ${activeSection === item.id 
                                        ? 'bg-starmade-accent/20 text-white border-l-4 border-starmade-accent' 
                                        : 'text-gray-400 hover:bg-white/5 hover:text-white'
                                    }
                                `}
                            >
                                <item.icon className="w-6 h-6 flex-shrink-0" />
                                <span>{item.label}</span>
                            </button>
                        ))}
                    </nav>
                </aside>

                <main className="flex-1 p-8 overflow-y-auto">
                    {renderSection()}
                </main>
            </div>
        </PageContainer>
    );
};

export default Settings;
