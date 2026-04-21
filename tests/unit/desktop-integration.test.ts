import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';
import os   from 'os';
import fs   from 'fs';
import { buildDesktopEntry, registerAppImageDesktopIntegration } from '../../electron/desktop-integration.js';

// ─── buildDesktopEntry ────────────────────────────────────────────────────────

describe('buildDesktopEntry', () => {
  it('includes the provided AppImage path in the Exec line', () => {
    const entry = buildDesktopEntry('/home/user/StarMade-Launcher.AppImage');
    expect(entry).toContain('Exec=/home/user/StarMade-Launcher.AppImage %U');
  });

  it('uses the fixed icon name "starmade-launcher"', () => {
    const entry = buildDesktopEntry('/tmp/StarMade-Launcher.AppImage');
    expect(entry).toContain('Icon=starmade-launcher');
  });

  it('includes the required .desktop keys', () => {
    const entry = buildDesktopEntry('/tmp/StarMade-Launcher.AppImage');
    expect(entry).toContain('[Desktop Entry]');
    expect(entry).toContain('Type=Application');
    expect(entry).toContain('Name=StarMade Launcher');
    expect(entry).toContain('Categories=Game;');
    expect(entry).toContain('Terminal=false');
  });

  it('sets StartupWMClass to "starmade-launcher"', () => {
    const entry = buildDesktopEntry('/tmp/StarMade-Launcher.AppImage');
    expect(entry).toContain('StartupWMClass=starmade-launcher');
  });

  it('ends with a trailing newline', () => {
    const entry = buildDesktopEntry('/tmp/StarMade-Launcher.AppImage');
    expect(entry.endsWith('\n')).toBe(true);
  });

  it('handles AppImage paths with spaces', () => {
    const entry = buildDesktopEntry('/home/user/My Apps/StarMade-Launcher.AppImage');
    expect(entry).toContain('Exec=/home/user/My Apps/StarMade-Launcher.AppImage %U');
  });
});

// ─── registerAppImageDesktopIntegration ──────────────────────────────────────

describe('registerAppImageDesktopIntegration', () => {
  let tmpDir: string;

  beforeEach(() => {
    // Create a fresh temp directory for each test to act as the
    // xdgDataHome so we never touch the real ~/.local/share.
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xdg-test-'));

    // Create a fake resourcesPath with an icon.png so the function can
    // copy it without hitting a real AppImage.  We only need the file to
    // exist and be readable; icon content is irrelevant for these tests.
    fs.mkdirSync(path.join(tmpDir, 'resources'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'resources', 'icon.png'),
      Buffer.from([0x89, 0x50, 0x4e, 0x47]), // PNG magic bytes – content not validated
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates the icon file at the expected XDG path', () => {
    registerAppImageDesktopIntegration({
      appImagePath:  '/home/user/StarMade-Launcher.AppImage',
      resourcesPath: path.join(tmpDir, 'resources'),
      xdgDataHome:   tmpDir,
    });

    const iconDest = path.join(
      tmpDir, 'icons', 'hicolor', '256x256', 'apps', 'starmade-launcher.png',
    );
    expect(fs.existsSync(iconDest)).toBe(true);
  });

  it('creates the .desktop file at the expected XDG path', () => {
    registerAppImageDesktopIntegration({
      appImagePath:  '/home/user/StarMade-Launcher.AppImage',
      resourcesPath: path.join(tmpDir, 'resources'),
      xdgDataHome:   tmpDir,
    });

    const desktopDest = path.join(tmpDir, 'applications', 'starmade-launcher.desktop');
    expect(fs.existsSync(desktopDest)).toBe(true);
  });

  it('writes the AppImage path into the .desktop Exec line', () => {
    registerAppImageDesktopIntegration({
      appImagePath:  '/home/user/StarMade-Launcher.AppImage',
      resourcesPath: path.join(tmpDir, 'resources'),
      xdgDataHome:   tmpDir,
    });

    const content = fs.readFileSync(
      path.join(tmpDir, 'applications', 'starmade-launcher.desktop'),
      'utf8',
    );
    expect(content).toContain('Exec=/home/user/StarMade-Launcher.AppImage %U');
  });

  it('does nothing (no throw) when icon.png is missing', () => {
    // Remove the icon we set up in beforeEach
    fs.unlinkSync(path.join(tmpDir, 'resources', 'icon.png'));

    // Should not throw – errors are swallowed and logged as warnings
    expect(() =>
      registerAppImageDesktopIntegration({
        appImagePath:  '/home/user/StarMade-Launcher.AppImage',
        resourcesPath: path.join(tmpDir, 'resources'),
        xdgDataHome:   tmpDir,
      }),
    ).not.toThrow();

    // No icon or .desktop should have been written
    expect(fs.existsSync(path.join(tmpDir, 'applications', 'starmade-launcher.desktop'))).toBe(false);
  });
});
