import { describe, it, expect } from 'vitest';
import { isRunningAsAppImage } from '../../electron/appimage-detect.js';
import { isRunningOnWayland } from '../../electron/wayland-detect.js';
import { parseVersionTxt } from '../../electron/legacy.js';

// ─── isRunningAsAppImage ──────────────────────────────────────────────────────

describe('isRunningAsAppImage', () => {
  it('returns true when APPIMAGE env var is set', () => {
    expect(isRunningAsAppImage({ APPIMAGE: '/mnt/drive/StarMadeLauncher.AppImage' }, '/usr/bin/app')).toBe(true);
  });

  it('returns true when APPDIR env var is set', () => {
    expect(isRunningAsAppImage({ APPDIR: '/tmp/.mount_StarMaEbqYcJ' }, '/usr/bin/app')).toBe(true);
  });

  it('returns true when exe path contains /.mount_ (squashfs mount)', () => {
    expect(isRunningAsAppImage({}, '/tmp/.mount_StarMaEbqYcJ/starmade-launcher')).toBe(true);
  });

  it('returns true for a deeper squashfs-mounted exe path', () => {
    expect(isRunningAsAppImage({}, '/tmp/.mount_AbCdEfGhIj/opt/StarMadeLauncher/starmade-launcher')).toBe(true);
  });

  it('returns false when none of the AppImage indicators are present', () => {
    expect(isRunningAsAppImage({}, '/usr/lib/starmade-launcher/starmade-launcher')).toBe(false);
  });

  it('returns false for a deb/rpm-installed binary path', () => {
    expect(isRunningAsAppImage({}, '/opt/StarMadeLauncher/starmade-launcher')).toBe(false);
  });

  it('returns true when all three indicators are present', () => {
    expect(isRunningAsAppImage(
      { APPIMAGE: '/mnt/drive/StarMadeLauncher.AppImage', APPDIR: '/tmp/.mount_StarMaEbqYcJ' },
      '/tmp/.mount_StarMaEbqYcJ/starmade-launcher',
    )).toBe(true);
  });

  it('returns false when APPIMAGE env var is an empty string', () => {
    expect(isRunningAsAppImage({ APPIMAGE: '' }, '/usr/lib/starmade-launcher/starmade-launcher')).toBe(false);
  });

  it('returns false when APPDIR env var is an empty string', () => {
    expect(isRunningAsAppImage({ APPDIR: '' }, '/usr/lib/starmade-launcher/starmade-launcher')).toBe(false);
  });
});

// ─── isRunningOnWayland ───────────────────────────────────────────────────────

describe('isRunningOnWayland', () => {
  it('returns true when WAYLAND_DISPLAY is set', () => {
    expect(isRunningOnWayland({ WAYLAND_DISPLAY: 'wayland-0' })).toBe(true);
  });

  it('returns true when XDG_SESSION_TYPE is "wayland"', () => {
    expect(isRunningOnWayland({ XDG_SESSION_TYPE: 'wayland' })).toBe(true);
  });

  it('returns true when both WAYLAND_DISPLAY and XDG_SESSION_TYPE=wayland are set', () => {
    expect(isRunningOnWayland({ WAYLAND_DISPLAY: 'wayland-0', XDG_SESSION_TYPE: 'wayland' })).toBe(true);
  });

  it('returns false when only XDG_SESSION_TYPE=x11 is set', () => {
    expect(isRunningOnWayland({ XDG_SESSION_TYPE: 'x11' })).toBe(false);
  });

  it('returns false when no Wayland indicators are present', () => {
    expect(isRunningOnWayland({})).toBe(false);
  });

  it('returns false when WAYLAND_DISPLAY is an empty string', () => {
    expect(isRunningOnWayland({ WAYLAND_DISPLAY: '' })).toBe(false);
  });

  it('returns true when WAYLAND_DISPLAY is set even if XDG_SESSION_TYPE is x11', () => {
    // WAYLAND_DISPLAY being set is the authoritative indicator
    expect(isRunningOnWayland({ WAYLAND_DISPLAY: 'wayland-1', XDG_SESSION_TYPE: 'x11' })).toBe(true);
  });
});

// ─── parseVersionTxt ─────────────────────────────────────────────────────────

describe('parseVersionTxt', () => {
  it('parses a standard version.txt entry', () => {
    expect(parseVersionTxt('0.205.1#20260311_181557')).toBe('0.205.1');
  });

  it('handles trailing newline', () => {
    expect(parseVersionTxt('0.205.1#20260311_181557\n')).toBe('0.205.1');
  });

  it('handles Windows-style line endings', () => {
    expect(parseVersionTxt('0.203.175#20231020_123456\r\n')).toBe('0.203.175');
  });

  it('returns null when there is no # character', () => {
    expect(parseVersionTxt('0.205.1')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseVersionTxt('')).toBeNull();
  });

  it('returns null for whitespace-only string', () => {
    expect(parseVersionTxt('   \n')).toBeNull();
  });

  it('returns null when version part is empty (# at start)', () => {
    expect(parseVersionTxt('#20260311_181557')).toBeNull();
  });

  it('returns null when version part is only whitespace', () => {
    expect(parseVersionTxt('   #20260311_181557')).toBeNull();
  });
});

