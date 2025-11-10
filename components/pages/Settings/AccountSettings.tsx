import React from 'react';
import { UserIcon, PlusIcon } from '../../common/icons';
import { useData } from '../../../contexts/DataContext';

const AccountSettings: React.FC = () => {
    const { accounts, activeAccount, setActiveAccount } = useData();
    
    return (
        <div>
            <div className="flex justify-between items-center mb-6 pb-2 border-b-2 border-white/10">
                <h2 className="font-display text-xl font-bold uppercase tracking-wider text-white">
                    Accounts
                </h2>
                <div className="flex items-center gap-2">
                    <button className="px-4 py-2 rounded-md bg-slate-700 hover:bg-slate-600 transition-colors text-sm font-semibold uppercase tracking-wider">
                        Log Out
                    </button>
                    <button className="flex items-center gap-2 px-4 py-2 rounded-md bg-starmade-accent hover:bg-starmade-accent-hover transition-colors text-sm font-bold uppercase tracking-wider">
                        <PlusIcon className="w-5 h-5" />
                        Add Account
                    </button>
                </div>
            </div>
            
            <div className="space-y-3">
                {accounts.map(account => {
                    const isActive = account.id === activeAccount?.id;

                    if (isActive) {
                        return (
                            <div key={account.id} className="flex items-center gap-4 p-4 rounded-lg bg-starmade-accent/20 border border-starmade-accent/80">
                                <div className="w-12 h-12 bg-slate-800 rounded-full flex items-center justify-center border border-slate-600">
                                    <UserIcon className="w-8 h-8 text-slate-300" />
                                </div>
                                <div className="flex-1">
                                    <h3 className="text-lg font-bold text-white">{account.name}</h3>
                                    <p className="text-sm text-gray-400">UUID: {account.uuid}</p>
                                </div>
                                <div>
                                    <span className="px-3 py-1 text-xs font-bold uppercase tracking-wider rounded-full bg-green-500/30 text-green-300">
                                        Active
                                    </span>
                                </div>
                            </div>
                        );
                    }

                    return (
                        <button
                            key={account.id}
                            onClick={() => setActiveAccount(account)}
                            className="w-full flex items-center gap-4 p-4 rounded-lg bg-black/20 border border-white/10 text-left transition-colors hover:bg-white/5 hover:border-white/20"
                        >
                            <div className="w-12 h-12 bg-slate-800 rounded-full flex items-center justify-center border border-slate-700">
                                <UserIcon className="w-8 h-8 text-slate-400" />
                            </div>
                            <div className="flex-1">
                                <h3 className="text-lg font-semibold text-gray-300">{account.name}</h3>
                                <p className="text-sm text-gray-500">UUID: {account.uuid}</p>
                            </div>
                        </button>
                    );
                })}
            </div>
        </div>
    );
};

export default AccountSettings;
