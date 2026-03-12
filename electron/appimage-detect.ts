/**
 * Detects whether the app is running inside an AppImage squashfs mount.
 *
 * Exported as a standalone module so that the detection logic can be
 * unit-tested without importing the full Electron main process.
 *
 * Detection uses three independent indicators because the APPIMAGE env var
 * is not always propagated when the AppImage is launched from a file manager
 * or desktop environment on an external/non-OS drive:
 *
 *   1. APPIMAGE – set by the AppImage runtime to the path of the .AppImage file.
 *   2. APPDIR   – also set by the AppImage runtime to the squashfs mount directory.
 *   3. exe path – the running binary lives inside a /.mount_XXXX directory
 *                 whenever the AppImage runtime is active, even if env vars
 *                 were stripped by the launching environment.
 */
export function isRunningAsAppImage(
  env: NodeJS.ProcessEnv,
  exePath: string,
): boolean {
  return (
    !!env.APPIMAGE ||
    !!env.APPDIR ||
    exePath.includes('/.mount_')
  );
}
