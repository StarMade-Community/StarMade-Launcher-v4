import React, { useState, useRef } from 'react';
import { UserIcon, ChevronDownIcon, MinimizeIcon, MaximizeIcon, CloseIcon, CogIcon, UserPlusIcon, ArrowRightOnRectangleIcon, CheckCircleIcon } from '../common/icons';
import useOnClickOutside from '../hooks/useOnClickOutside';
import type { Page } from '../../types';
import { useApp } from '../../contexts/AppContext';
import { useData } from '../../contexts/DataContext';

const UserProfile: React.FC = () => {
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const { navigate } = useApp();
    const { accounts, activeAccount, setActiveAccount } = useData();

    useOnClickOutside(dropdownRef, () => setIsOpen(false));

    if (!activeAccount) {
        return null;
    }

    return (
        <div className="relative" ref={dropdownRef}>
            <div onClick={() => setIsOpen(!isOpen)} className="flex items-center gap-3 cursor-pointer group">
                <div className="w-10 h-10 bg-slate-800/50 rounded-full flex items-center justify-center group-hover:bg-slate-700/70 transition-colors border border-slate-700">
                    <UserIcon className="w-6 h-6 text-slate-400" />
                </div>
                <div>
                    <h3 className="font-semibold text-white">{activeAccount.name}</h3>
                </div>
                <ChevronDownIcon className={`w-4 h-4 text-gray-400 group-hover:text-white transition-all ${isOpen ? 'rotate-180' : ''}`} />
            </div>

            {isOpen && (
                <div className="absolute top-full mt-2 w-72 bg-slate-900/90 backdrop-blur-sm border border-slate-700 rounded-md shadow-lg overflow-hidden z-20">
                    <div className="p-2">
                        <p className="px-2 py-1 text-xs font-semibold text-gray-400 uppercase tracking-wider">ACCOUNTS</p>
                        <ul>
                            {accounts.map(account => (
                                <li key={account.id}>
                                    <button
                                        onClick={() => {
                                            setActiveAccount(account);
                                            setIsOpen(false);
                                        }}
                                        className="w-full flex items-center gap-3 px-2 py-2 text-left rounded-md hover:bg-slate-700/50 transition-colors"
                                    >
                                        <div className="w-8 h-8 bg-slate-800 rounded-full flex items-center justify-center border border-slate-600">
                                            <UserIcon className="w-5 h-5 text-slate-400" />
                                        </div>
                                        <span className="text-sm text-white flex-1">{account.name}</span>
                                        {activeAccount.id === account.id && <CheckCircleIcon className="w-5 h-5 text-starmade-accent" />}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </div>
                    <hr className="border-slate-700/50" />
                     <div className="p-2">
                         <ul>
                            <li>
                                <button
                                    onClick={() => {
                                        navigate('Settings', { initialSection: 'accounts' });
                                        setIsOpen(false);
                                    }}
                                    className="w-full flex items-center gap-3 px-2 py-2 text-left rounded-md hover:bg-slate-700/50 transition-colors text-sm text-gray-300 hover:text-white"
                                >
                                    <CogIcon className="w-5 h-5" />
                                    <span>Manage Accounts</span>
                                </button>
                            </li>
                             <li>
                                <button className="w-full flex items-center gap-3 px-2 py-2 text-left rounded-md hover:bg-slate-700/50 transition-colors text-sm text-gray-300 hover:text-white">
                                    <UserPlusIcon className="w-5 h-5" />
                                    <span>Add Account</span>
                                </button>
                            </li>
                             <li>
                                <button className="w-full flex items-center gap-3 px-2 py-2 text-left rounded-md hover:bg-slate-700/50 transition-colors text-sm text-gray-300 hover:text-white">
                                    <ArrowRightOnRectangleIcon className="w-5 h-5" />
                                    <span>Log Out</span>
                                </button>
                            </li>
                         </ul>
                     </div>
                </div>
            )}
        </div>
    );
};

const WindowControls: React.FC = () => (
    <div className="flex items-center gap-2">
        <button className="p-2 rounded-md hover:bg-white/5 transition-colors">
            <MinimizeIcon className="w-5 h-5 text-gray-400" />
        </button>
        <button className="p-2 rounded-md hover:bg-white/5 transition-colors">
            <MaximizeIcon className="w-5 h-5 text-gray-400" />
        </button>
        <button className="p-2 rounded-md hover:bg-starmade-danger/20 transition-colors">
            <CloseIcon className="w-5 h-5 text-gray-400 hover:text-starmade-danger-light" />
        </button>
    </div>
);

const Navigation: React.FC = () => {
    const { activePage, navigate } = useApp();
    const navItems: Page[] = ['Play', 'Installations', 'News'];

    return (
        <nav className="flex items-center gap-10">
            {navItems.map(item => (
                <button 
                    key={item} 
                    onClick={() => navigate(item)}
                    className={`
                        font-display uppercase tracking-widest transition-colors duration-200 relative pb-2
                        ${activePage === item ? 'text-white' : 'text-gray-500 hover:text-gray-300'}
                    `}
                >
                    {item}
                    {activePage === item && (
                        <div className="absolute bottom-0 left-0 w-full h-1 bg-starmade-accent rounded-full shadow-[0_0_8px_0px_#227b86]"></div>
                    )}
                </button>
            ))}
        </nav>
    );
};

const Header: React.FC = () => {
  const { navigate } = useApp();
  return (
    <header className="relative z-30 flex justify-between items-center px-6 py-3 bg-black/20 backdrop-blur-sm border-b border-white/5" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
      <div className="flex-1 flex justify-start" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <div className="flex items-center gap-3">
            <UserProfile />
            <button 
              onClick={() => navigate('Settings')}
              className="p-2 rounded-full hover:bg-white/10 transition-colors" 
              aria-label="Settings"
            >
                <CogIcon className="w-6 h-6 text-gray-400 hover:text-white transition-colors" />
            </button>
        </div>
      </div>
      <div className="flex-1 flex justify-center" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <Navigation />
      </div>
      <div className="flex-1 flex justify-end" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <WindowControls />
      </div>
    </header>
  );
};

export default Header;
