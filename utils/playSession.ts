import type { PlaySession } from '../types';

/** Port StarMade connects to when a direct-connect target omits one. */
const DEFAULT_UPLINK_PORT = 4242;

/**
 * Deterministic id for a session *target* — installation + uplink + mods.
 *
 * Relaunching the same target has to produce the same id, otherwise the record
 * is duplicated instead of updated and a pin loses its identity. An absent
 * uplink (an ordinary launch into the game's own menus) is a different target
 * from an explicit `-uplink localhost`, so the two must not collapse together.
 */
export function makeSessionId(
    installationId: string,
    uplink?: string,
    uplinkPort?: number,
    modIds?: string[],
): string {
    return [
        installationId,
        uplink ?? '',
        uplink ? String(uplinkPort ?? DEFAULT_UPLINK_PORT) : '',
        (modIds ?? []).slice().sort().join(','),
    ].join('::');
}

/**
 * Bring a stored session up to the current shape.
 *
 * Records written before singleplayer and direct-connect were distinguished
 * carry a fabricated `localhost:4242` uplink. Replaying one appends
 * `-uplink localhost 4242` to a launch that originally had no uplink at all,
 * so the game tries to connect to a server that isn't running. Their ids are
 * rebuilt too, so an old pin still matches the record a fresh launch writes.
 */
export function normalizePlaySession(session: PlaySession): PlaySession {
    if (session.sessionType !== 'singleplayer') return session;

    const { serverAddress: _address, serverPort: _port, ...rest } = session;
    return { ...rest, id: makeSessionId(session.installationId, undefined, undefined, session.modIds) };
}
