"use strict";

/**
 * afterPack hook – injects --no-sandbox for Linux AppImage builds.
 *
 * WHY THIS IS NEEDED
 * ==================
 * Chromium's SUID sandbox check happens at the C++ level, during browser-process
 * initialization, *before* V8 starts and before any JavaScript runs.  By the time
 * main.js executes and calls `app.commandLine.appendSwitch('no-sandbox')`, the
 * process has already tried (and fatally failed) to verify that chrome-sandbox
 * has mode 4755 / is owned by root.
 *
 * Inside an AppImage the squashfs image is mounted read-only by an unprivileged
 * user, so the chrome-sandbox binary can never have the required SUID-root
 * permissions.  The flag must therefore be present on the *original* argv when
 * the binary is exec'd.
 *
 * HOW IT WORKS
 * ============
 * After electron-builder packs the app into `appOutDir` (but before it assembles
 * the AppImage), this hook:
 *   1. Renames the real Electron binary  →  `<name>.bin`
 *   2. Writes a tiny shell wrapper named `<name>` that calls `<name>.bin --no-sandbox "$@"`
 *
 * electron-builder's AppRun script calls `exec "$APPDIR/<executableName>"`.
 * That now runs the shell wrapper, which adds --no-sandbox before handing off to
 * the real binary.  Both files end up inside the AppImage squashfs, so the
 * wrapper can locate the binary via $APPDIR.
 *
 * This hook only runs on Linux builds; other platforms are unaffected.
 */

const fs   = require("fs");
const path = require("path");

module.exports = async function afterPack(context) {
  const { electronPlatformName, appOutDir, packager } = context;

  if (electronPlatformName !== "linux") return;

  const executableName  = packager.executableName;          // e.g. "starmade-launcher"
  const realBinaryName  = `${executableName}.bin`;           // e.g. "starmade-launcher.bin"

  const binaryPath      = path.join(appOutDir, executableName);
  const realBinaryPath  = path.join(appOutDir, realBinaryName);

  if (!fs.existsSync(binaryPath)) {
    console.warn(`[afterPack] Warning: expected binary not found at ${binaryPath}. Skipping wrapper.`);
    return;
  }

  // Step 1 – rename the real Electron binary.
  fs.renameSync(binaryPath, realBinaryPath);

  // Step 2 – write the shell wrapper in its place.
  //
  // $APPDIR is set by the AppImage runtime before AppRun is called.
  // We fall back to resolving the script's own directory for direct (non-AppImage) invocations.
  const wrapperScript = `#!/bin/sh
# Auto-generated wrapper – see afterPack.cjs in the project root.
#
# The chrome-sandbox binary inside an AppImage squashfs mount can never have
# SUID-root permissions (mode 4755), so --no-sandbox is always required when
# running as an AppImage.  This wrapper ensures the flag is present on the
# original argv before the Electron/Chromium binary starts.
_dir="\${APPDIR:-\$(cd "\$(dirname "\$0")" && pwd)}"
exec "\$_dir/${realBinaryName}" --no-sandbox "\$@"
`;

  fs.writeFileSync(binaryPath, wrapperScript, { mode: 0o755 });

  console.log(`[afterPack] --no-sandbox wrapper created:   ${binaryPath}`);
  console.log(`[afterPack] Real Electron binary moved to:  ${realBinaryPath}`);
};

