import React, { useState } from 'react';
import type { PlaySession } from '../../types';
import { PlayIcon, CloseIcon } from './icons';
import { useApp } from '../../contexts/AppContext';
import { useData } from '../../contexts/DataContext';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Format an ISO timestamp as a human-readable "time ago" string. */
function timeAgo(isoTimestamp: string): string {
    const diff = Date.now() - new Date(isoTimestamp).getTime();
    const minutes = Math.floor(diff / 60_000);
    if (minutes < 1)  return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24)   return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7)     return `${days}d ago`;
    return new Date(isoTimestamp).toLocaleDateString();
}

// ─── Pin icon (not in the shared icons file) ──────────────────────────────────

const PinIcon: React.FC<{ className?: string; filled?: boolean }> = ({ className, filled }) => (
    <svg
        className={className}
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth={filled ? 0 : 1.5}
    >
        {filled ? (
            <path d="M15.75 2.25a.75.75 0 0 1 .75.75v.378a.75.75 0 0 1-.75.75H8.25a.75.75 0 0 1-.75-.75V3a.75.75 0 0 1 .75-.75h7.5ZM9 6.75l-3 8.25h12L15 6.75H9Zm2.25 10.5v3.75a.75.75 0 0 0 1.5 0V17.25h-1.5Z" />
        ) : (
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 2.25H8.25M12 6.75v10.5m0 0-3.75 3 .75-4.5L6 14.25l3.75-.75M12 17.25l3.75 3-.75-4.5 3-1.5-3.75-.75" />
        )}
    </svg>
);

// ─── SP / MP icons ────────────────────────────────────────────────────────────

const SinglePlayerIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
    </svg>
);

const MultiPlayerIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" />
    </svg>
);

// ─── Session card ─────────────────────────────────────────────────────────────

interface SessionCardProps {
    session: PlaySession;
    isLastPlayed?: boolean;
    isPinned?: boolean;
    onPlay: (session: PlaySession) => void;
    onPin: (session: PlaySession) => void;
    onUnpin: (sessionId: string) => void;
}

const SessionCard: React.FC<SessionCardProps> = ({
    session,
    isLastPlayed,
    isPinned,
    onPlay,
    onPin,
    onUnpin,
}) => {
    const [hovered, setHovered] = useState(false);

    return (
        <div
            className="relative flex flex-col gap-1 p-2.5 rounded-lg bg-black/50 border border-white/10 hover:border-white/20 hover:bg-black/60 transition-all cursor-pointer group min-w-[120px] max-w-[150px]"
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            onClick={() => onPlay(session)}
            title={`${session.installationName} · ${session.sessionType === 'singleplayer' ? 'Singleplayer' : `Multiplayer (${session.serverAddress})`}`}
        >
            {/* Badge */}
            {isLastPlayed && (
                <span className="absolute -top-2 left-2 text-[9px] font-bold uppercase tracking-widest text-starmade-accent bg-black/80 border border-starmade-accent/40 rounded px-1 py-px">
                    Last Played
                </span>
            )}

            {/* Installation name */}
            <p className="text-xs font-semibold text-white leading-tight truncate">
                {session.installationName}
            </p>

            {/* Session type + time */}
            <div className="flex items-center gap-1 text-gray-400">
                {session.sessionType === 'singleplayer' ? (
                    <SinglePlayerIcon className="w-3 h-3 flex-shrink-0 text-green-400" />
                ) : (
                    <MultiPlayerIcon className="w-3 h-3 flex-shrink-0 text-blue-400" />
                )}
                <span className="text-[10px] truncate">
                    {session.sessionType === 'singleplayer' ? 'Singleplayer' : session.serverAddress}
                </span>
            </div>
            <p className="text-[10px] text-gray-500">{timeAgo(session.timestamp)}</p>

            {/* Hover overlay: play button */}
            {hovered && (
                <div className="absolute inset-0 rounded-lg bg-black/60 flex items-center justify-center gap-1">
                    <button
                        className="p-1.5 rounded-md bg-starmade-accent/80 hover:bg-starmade-accent transition-colors"
                        onClick={(e) => { e.stopPropagation(); onPlay(session); }}
                        aria-label="Play session"
                        title="Play"
                    >
                        <PlayIcon className="w-4 h-4 text-white" />
                    </button>
                    {isPinned ? (
                        <button
                            className="p-1.5 rounded-md bg-white/10 hover:bg-white/20 transition-colors"
                            onClick={(e) => { e.stopPropagation(); onUnpin(session.id); }}
                            aria-label="Unpin session"
                            title="Unpin"
                        >
                            <CloseIcon className="w-4 h-4 text-gray-300" />
                        </button>
                    ) : (
                        <button
                            className="p-1.5 rounded-md bg-white/10 hover:bg-white/20 transition-colors"
                            onClick={(e) => { e.stopPropagation(); onPin(session); }}
                            aria-label="Pin session"
                            title="Pin for quick access"
                        >
                            <PinIcon className="w-4 h-4 text-gray-300" />
                        </button>
                    )}
                </div>
            )}
        </div>
    );
};

// ─── Widget ───────────────────────────────────────────────────────────────────

/**
 * Compact bottom-right overlay displayed on the Play page.
 *
 * Layout:  [LAST PLAYED card]  [pinned 1]  [pinned 2]  [pinned 3]  [pinned 4]
 *
 * - Clicking any card immediately opens the launch modal pre-configured for
 *   that session (uplink address, port, mod IDs).
 * - Hovering over a card reveals play and pin/unpin buttons.
 * - Sessions are recorded automatically after each successful game launch.
 */
const LastPlayedWidget: React.FC = () => {
    const { launchSession } = useApp();
    const { lastPlayedSession, pinnedSessions, pinSession, unpinSession } = useData();

    // Nothing to show if there are no sessions at all.
    if (!lastPlayedSession && pinnedSessions.length === 0) return null;

    // Deduplicate: if the last-played is already pinned show it only in the
    // "last played" slot so users don't see the same card twice.
    const pinnedToShow = pinnedSessions.filter(
        s => s.id !== lastPlayedSession?.id,
    );

    return (
        <div className="fixed bottom-20 right-4 z-20 flex flex-col items-end gap-1">
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500 pr-1">
                Quick Play
            </p>
            <div className="flex items-end gap-2 flex-wrap justify-end max-w-[700px]">
                {lastPlayedSession && (
                    <SessionCard
                        key={lastPlayedSession.id}
                        session={lastPlayedSession}
                        isLastPlayed
                        isPinned={pinnedSessions.some(s => s.id === lastPlayedSession.id)}
                        onPlay={launchSession}
                        onPin={pinSession}
                        onUnpin={unpinSession}
                    />
                )}
                {pinnedToShow.map(session => (
                    <SessionCard
                        key={session.id}
                        session={session}
                        isPinned
                        onPlay={launchSession}
                        onPin={pinSession}
                        onUnpin={unpinSession}
                    />
                ))}
            </div>
        </div>
    );
};

export default LastPlayedWidget;
