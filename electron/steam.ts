/**
 * Steam launch-environment detection.
 *
 * Steam exports environment variables into processes it launches.  We use these
 * to detect when the launcher is running inside Steam's "Gaming Mode" — the
 * full-screen, controller-first shell used by Big Picture and the Steam Deck.
 *
 * Gaming Mode requires fundamentally different lifecycle/window behaviour from
 * the desktop Steam client (see electron/main.ts), because Steam tracks the
 * launcher process itself as the running game and composites it through
 * gamescope.  Everything that depends on this detection is gated so that the
 * normal desktop / macOS experience is completely unaffected.
 */

/**
 * True when the launcher was started by Steam in Big Picture / Gaming Mode.
 *
 * - `SteamTenfoot` is set by the classic Big Picture ("10-foot") UI.
 * - `SteamGamepadUI` is set by the newer Big Picture / Steam Deck Gaming Mode.
 *
 * We deliberately do NOT key off bare `SteamDeck`, which is also set when the
 * Deck is in *Desktop* mode — there, normal windowed behaviour is correct.
 *
 * The `env` argument is injectable purely to keep this function pure/testable;
 * callers should use the default (`process.env`).
 */
export function isSteamGamingMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SteamTenfoot === '1' || env.SteamGamepadUI === '1';
}
