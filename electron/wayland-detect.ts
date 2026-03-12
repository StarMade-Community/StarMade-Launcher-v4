/**
 * Detects whether the current Linux session is running under Wayland.
 *
 * Exported as a standalone module so that the detection logic can be
 * unit-tested without importing the full Electron main process.
 *
 * Detection uses two independent indicators:
 *
 *   1. WAYLAND_DISPLAY – set by the Wayland compositor to the socket name
 *                        (e.g. "wayland-0").  Present whenever a Wayland
 *                        session is active, even inside a nested compositor.
 *   2. XDG_SESSION_TYPE – set to "wayland" by systemd / the display manager
 *                         for Wayland desktop sessions.
 *
 * Either indicator alone is sufficient to conclude we are on Wayland.
 */
export function isRunningOnWayland(env: NodeJS.ProcessEnv): boolean {
  return !!env.WAYLAND_DISPLAY || env.XDG_SESSION_TYPE === 'wayland';
}
