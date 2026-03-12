import { describe, it, expect } from 'vitest';
import { isRunningAsAppImage } from '../../electron/appimage-detect.js';

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
