/**
 * XDG desktop integration for the Linux AppImage build.
 *
 * WHY THIS IS NEEDED
 * ==================
 * When the launcher auto-updates itself by replacing the AppImage binary on
 * disk (via `cp -f`), the desktop-integration entries managed by external
 * tools such as appimaged or AppImageLauncher become stale.  Those tools
 * typically track AppImages by their content hash: once the binary changes the
 * old hash no longer matches, the old icon/desktop entries are orphaned, and
 * the file manager falls back to a generic icon until the user manually
 * re-runs the AppImage or the daemon rescans.
 *
 * HOW IT WORKS
 * ============
 * `registerAppImageDesktopIntegration` is called once at startup (only on
 * Linux, only when packaged, only when running as an AppImage).  It:
 *
 *   1. Copies the bundled `resources/icon.png` into the user's XDG icon
 *      theme directory (`~/.local/share/icons/hicolor/256x256/apps/`).
 *   2. Writes a `.desktop` entry to `~/.local/share/applications/` that
 *      points at the current AppImage path and references the installed icon.
 *   3. Optionally refreshes the desktop database / icon cache so that the
 *      change takes effect in already-running file managers without needing a
 *      logout/login.
 *
 * Using a fixed icon name (`starmade-launcher`) and a fixed `.desktop`
 * filename means the entry is stable across updates — no hash-based name
 * changes — and the file manager always shows the correct StarMade icon.
 */

import fs   from 'fs';
import path from 'path';
import os   from 'os';
import { spawn } from 'child_process';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DesktopIntegrationOptions {
  /** Absolute path to the AppImage file currently on disk. */
  appImagePath: string;
  /** Absolute path to the Electron `resources/` directory inside the AppImage. */
  resourcesPath: string;
  /**
   * Override for `$XDG_DATA_HOME`.  Defaults to `~/.local/share` when absent.
   * Exposed for unit-testing without touching the real file system.
   */
  xdgDataHome?: string;
}

// ─── Pure helpers (unit-testable) ─────────────────────────────────────────────

/**
 * Build the content of the `.desktop` entry for the launcher.
 *
 * The `Exec` line uses `%U` so the file can be passed a URI argument by
 * desktop environments / file managers that support it.
 */
export function buildDesktopEntry(appImagePath: string): string {
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=StarMade Launcher',
    'Comment=Modern cross-platform launcher for StarMade',
    `Exec=${appImagePath} %U`,
    'Icon=starmade-launcher',
    'Categories=Game;',
    'StartupWMClass=starmade-launcher',
    'Terminal=false',
  ].join('\n') + '\n';
}

// ─── File-system integration ──────────────────────────────────────────────────

/**
 * Register (or re-register) the launcher's icon and `.desktop` entry in the
 * current user's XDG directories.
 *
 * Errors are caught and logged as warnings so that a failure here never
 * prevents the launcher itself from starting.
 */
export function registerAppImageDesktopIntegration(
  opts: DesktopIntegrationOptions,
): void {
  try {
    const { appImagePath, resourcesPath } = opts;

    const dataHome = opts.xdgDataHome ??
      (process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'));

    const iconDir  = path.join(dataHome, 'icons', 'hicolor', '256x256', 'apps');
    const appsDir  = path.join(dataHome, 'applications');

    fs.mkdirSync(iconDir, { recursive: true });
    fs.mkdirSync(appsDir, { recursive: true });

    // 1. Install the icon from the AppImage's bundled resources.
    const iconSrc  = path.join(resourcesPath, 'icon.png');
    const iconDest = path.join(iconDir, 'starmade-launcher.png');
    if (!fs.existsSync(iconSrc)) {
      console.warn('[desktop-integration] icon.png not found at', iconSrc);
      return;
    }
    fs.copyFileSync(iconSrc, iconDest);

    // 2. Write the .desktop entry.
    const desktopDest = path.join(appsDir, 'starmade-launcher.desktop');
    fs.writeFileSync(desktopDest, buildDesktopEntry(appImagePath), 'utf8');

    // 3. Refresh the desktop database / icon cache so the change is visible
    //    without requiring the user to log out and back in.  Both commands are
    //    optional extras — the icon and .desktop file are already written above,
    //    so failure here (e.g. tools not installed) is non-fatal.  We use
    //    fire-and-forget semantics (no await, no exit-code check) because these
    //    are best-effort refresh calls; the launcher must not block or crash if
    //    they are unavailable or take a long time.
    const refreshDb = spawn('update-desktop-database', [appsDir], { stdio: 'ignore' });
    refreshDb.on('error', () => { /* tool not installed – ignore */ });
    refreshDb.unref();

    const refreshIcons = spawn('gtk-update-icon-cache', [
      '-q', '-t', '-f', path.join(dataHome, 'icons', 'hicolor'),
    ], { stdio: 'ignore' });
    refreshIcons.on('error', () => { /* tool not installed – ignore */ });
    refreshIcons.unref();

  } catch (err) {
    console.warn('[desktop-integration] Registration failed:', err);
  }
}
