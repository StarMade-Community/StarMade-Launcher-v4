import React, { useState } from 'react';
import { UserIcon, PlusIcon } from '../../common/icons';
import { useData } from '../../../contexts/DataContext';

type View = 'list' | 'login' | 'register' | 'guest';

const AccountSettings: React.FC = () => {
    const { accounts, activeAccount, setActiveAccount, loginAccount, logoutAccount, registerAccount, addGuestAccount } = useData();

    const [view, setView] = useState<View>('list');

    // Login form
    const [loginUsername, setLoginUsername] = useState('');
    const [loginPassword, setLoginPassword] = useState('');
    const [loginError,    setLoginError]    = useState('');
    const [loginLoading,  setLoginLoading]  = useState(false);

    // Register form
    const [regUsername,    setRegUsername]    = useState('');
    const [regEmail,       setRegEmail]       = useState('');
    const [regPassword,    setRegPassword]    = useState('');
    const [regPassword2,   setRegPassword2]   = useState('');
    const [regSubscribe,   setRegSubscribe]   = useState(true);
    const [regError,       setRegError]       = useState('');
    const [regSuccess,     setRegSuccess]     = useState('');
    const [regLoading,     setRegLoading]     = useState(false);

    // Guest form
    const [guestName,    setGuestName]    = useState('');
    const [guestError,   setGuestError]   = useState('');

    const resetForms = () => {
        setLoginUsername(''); setLoginPassword(''); setLoginError('');
        setRegUsername(''); setRegEmail(''); setRegPassword(''); setRegPassword2('');
        setRegError(''); setRegSuccess(''); setRegSubscribe(true);
        setGuestName(''); setGuestError('');
    };

    const goTo = (v: View) => { resetForms(); setView(v); };

    // ── Login ────────────────────────────────────────────────────────────────

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!loginUsername.trim() || !loginPassword) { setLoginError('Please fill in all fields.'); return; }
        setLoginError(''); setLoginLoading(true);
        const result = await loginAccount(loginUsername, loginPassword);
        setLoginLoading(false);
        if (result.success) {
            goTo('list');
        } else {
            setLoginError(result.error ?? 'Login failed.');
        }
    };

    // ── Register ─────────────────────────────────────────────────────────────

    const handleRegister = async (e: React.FormEvent) => {
        e.preventDefault();
        setRegError(''); setRegSuccess('');
        if (!regUsername.trim() || !regEmail.trim() || !regPassword) { setRegError('Please fill in all fields.'); return; }
        if (regPassword !== regPassword2) { setRegError('Passwords do not match.'); return; }
        setRegLoading(true);
        const result = await registerAccount(regUsername, regEmail, regPassword, regSubscribe);
        setRegLoading(false);
        if (result.success) {
            setRegSuccess('Account registered! Please confirm your email, then log in.');
            setRegUsername(''); setRegEmail(''); setRegPassword(''); setRegPassword2('');
        } else {
            setRegError(result.error ?? 'Registration failed.');
        }
    };

    // ── Guest ────────────────────────────────────────────────────────────────

    const handleGuest = (e: React.FormEvent) => {
        e.preventDefault();
        const name = guestName.trim();
        if (!name || name.length < 3) { setGuestError('Name must be at least 3 characters.'); return; }
        addGuestAccount(name);
        goTo('list');
    };

    // ── Shared input style ───────────────────────────────────────────────────

    const inputCls = 'w-full px-3 py-2 rounded-md bg-black/30 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-starmade-accent text-sm';
    const labelCls = 'block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1';
    const btnPrimary = 'w-full py-2 rounded-md bg-starmade-accent hover:bg-starmade-accent-hover transition-colors text-sm font-bold uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed';
    const btnSecondary = 'w-full py-2 rounded-md bg-slate-700 hover:bg-slate-600 transition-colors text-sm font-semibold uppercase tracking-wider';

    // ── Views ────────────────────────────────────────────────────────────────

    if (view === 'login') {
        return (
            <div>
                <div className="flex items-center gap-3 mb-6 pb-2 border-b-2 border-white/10">
                    <button onClick={() => goTo('list')} className="text-gray-400 hover:text-white transition-colors text-xs uppercase tracking-wider">← Back</button>
                    <h2 className="font-display text-xl font-bold uppercase tracking-wider text-white">Log In</h2>
                </div>
                <form onSubmit={handleLogin} className="max-w-sm space-y-4">
                    <div>
                        <label className={labelCls}>Username</label>
                        <input className={inputCls} value={loginUsername} onChange={e => setLoginUsername(e.target.value)} placeholder="Your username" autoComplete="username" />
                    </div>
                    <div>
                        <label className={labelCls}>Password</label>
                        <input className={inputCls} type="password" value={loginPassword} onChange={e => setLoginPassword(e.target.value)} placeholder="Your password" autoComplete="current-password" />
                    </div>
                    {loginError && <p className="text-red-400 text-sm">{loginError}</p>}
                    <button type="submit" className={btnPrimary} disabled={loginLoading}>
                        {loginLoading ? 'Logging in…' : 'Log In'}
                    </button>
                    <button type="button" className={btnSecondary} onClick={() => goTo('register')}>
                        Create Account
                    </button>
                    <button type="button" className="w-full text-gray-400 hover:text-white text-xs transition-colors" onClick={() => goTo('guest')}>
                        Continue as Guest
                    </button>
                </form>
            </div>
        );
    }

    if (view === 'register') {
        return (
            <div>
                <div className="flex items-center gap-3 mb-6 pb-2 border-b-2 border-white/10">
                    <button onClick={() => goTo('login')} className="text-gray-400 hover:text-white transition-colors text-xs uppercase tracking-wider">← Back</button>
                    <h2 className="font-display text-xl font-bold uppercase tracking-wider text-white">Create Account</h2>
                </div>
                <form onSubmit={handleRegister} className="max-w-sm space-y-4">
                    <div>
                        <label className={labelCls}>Username</label>
                        <input className={inputCls} value={regUsername} onChange={e => setRegUsername(e.target.value)} placeholder="Choose a username" autoComplete="username" />
                    </div>
                    <div>
                        <label className={labelCls}>Email</label>
                        <input className={inputCls} type="email" value={regEmail} onChange={e => setRegEmail(e.target.value)} placeholder="your@email.com" autoComplete="email" />
                    </div>
                    <div>
                        <label className={labelCls}>Password</label>
                        <input className={inputCls} type="password" value={regPassword} onChange={e => setRegPassword(e.target.value)} placeholder="Choose a password" autoComplete="new-password" />
                    </div>
                    <div>
                        <label className={labelCls}>Confirm Password</label>
                        <input className={inputCls} type="password" value={regPassword2} onChange={e => setRegPassword2(e.target.value)} placeholder="Repeat password" autoComplete="new-password" />
                    </div>
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                        <div
                            onClick={() => setRegSubscribe(s => !s)}
                            className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${regSubscribe ? 'bg-starmade-accent border-starmade-accent' : 'bg-black/30 border-white/20'}`}
                        >
                            {regSubscribe && <span className="text-white text-xs font-bold">✓</span>}
                        </div>
                        <span className="text-sm text-gray-300">Subscribe to newsletter</span>
                    </label>
                    {regError   && <p className="text-red-400 text-sm">{regError}</p>}
                    {regSuccess && <p className="text-green-400 text-sm">{regSuccess}</p>}
                    <button type="submit" className={btnPrimary} disabled={regLoading}>
                        {regLoading ? 'Registering…' : 'Create Account'}
                    </button>
                    {regSuccess && (
                        <button type="button" className={btnSecondary} onClick={() => goTo('login')}>
                            Go to Log In
                        </button>
                    )}
                </form>
            </div>
        );
    }

    if (view === 'guest') {
        return (
            <div>
                <div className="flex items-center gap-3 mb-6 pb-2 border-b-2 border-white/10">
                    <button onClick={() => goTo('login')} className="text-gray-400 hover:text-white transition-colors text-xs uppercase tracking-wider">← Back</button>
                    <h2 className="font-display text-xl font-bold uppercase tracking-wider text-white">Play as Guest</h2>
                </div>
                <p className="text-sm text-gray-400 mb-4">Choose a local player name to play offline. You can log in to a registry account later.</p>
                <form onSubmit={handleGuest} className="max-w-sm space-y-4">
                    <div>
                        <label className={labelCls}>Player Name</label>
                        <input className={inputCls} value={guestName} onChange={e => setGuestName(e.target.value)} placeholder="At least 3 characters" />
                    </div>
                    {guestError && <p className="text-red-400 text-sm">{guestError}</p>}
                    <button type="submit" className={btnPrimary}>
                        Continue as Guest
                    </button>
                </form>
            </div>
        );
    }

    // ── Account list (default view) ──────────────────────────────────────────

    return (
        <div>
            <div className="flex justify-between items-center mb-6 pb-2 border-b-2 border-white/10">
                <h2 className="font-display text-xl font-bold uppercase tracking-wider text-white">
                    Accounts
                </h2>
                <button
                    onClick={() => goTo('login')}
                    className="flex items-center gap-2 px-4 py-2 rounded-md bg-starmade-accent hover:bg-starmade-accent-hover transition-colors text-sm font-bold uppercase tracking-wider"
                >
                    <PlusIcon className="w-5 h-5" />
                    Add Account
                </button>
            </div>

            {accounts.length === 0 ? (
                <div className="text-center py-12 space-y-4">
                    <p className="text-gray-400">No accounts added yet.</p>
                    <div className="flex flex-col items-center gap-2">
                        <button onClick={() => goTo('login')} className="px-6 py-2 rounded-md bg-starmade-accent hover:bg-starmade-accent-hover transition-colors text-sm font-bold uppercase tracking-wider">
                            Log In
                        </button>
                        <button onClick={() => goTo('guest')} className="text-gray-400 hover:text-white text-xs transition-colors">
                            Continue as Guest
                        </button>
                    </div>
                </div>
            ) : (
                <div className="space-y-3">
                    {accounts.map(account => {
                        const isActive = account.id === activeAccount?.id;
                        const isGuest  = account.isGuest || account.id.startsWith('offline-');

                        return (
                            <div
                                key={account.id}
                                className={`flex items-center gap-4 p-4 rounded-lg border transition-colors ${
                                    isActive
                                        ? 'bg-starmade-accent/20 border-starmade-accent/80'
                                        : 'bg-black/20 border-white/10 hover:bg-white/5 hover:border-white/20'
                                }`}
                            >
                                <div className="w-12 h-12 bg-slate-800 rounded-full flex items-center justify-center border border-slate-600 flex-shrink-0">
                                    <UserIcon className="w-8 h-8 text-slate-300" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <h3 className={`text-lg font-bold truncate ${isActive ? 'text-white' : 'text-gray-300'}`}>{account.name}</h3>
                                    <p className="text-xs text-gray-500">
                                        {isGuest ? 'Guest / Offline' : (account.uuid ? `UUID: ${account.uuid}` : 'Registry Account')}
                                    </p>
                                </div>
                                <div className="flex items-center gap-2 flex-shrink-0">
                                    {isActive ? (
                                        <span className="px-3 py-1 text-xs font-bold uppercase tracking-wider rounded-full bg-green-500/30 text-green-300">
                                            Active
                                        </span>
                                    ) : (
                                        <button
                                            onClick={() => setActiveAccount(account)}
                                            className="px-3 py-1 rounded-md bg-slate-700 hover:bg-slate-600 transition-colors text-xs font-semibold uppercase tracking-wider"
                                        >
                                            Switch
                                        </button>
                                    )}
                                    <button
                                        onClick={() => logoutAccount(account.id)}
                                        className="px-3 py-1 rounded-md bg-red-900/40 hover:bg-red-800/60 border border-red-700/40 transition-colors text-xs font-semibold uppercase tracking-wider text-red-300"
                                    >
                                        {isGuest ? 'Remove' : 'Log Out'}
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default AccountSettings;
