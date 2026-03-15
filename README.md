<div align="center">
<img width="1200" height="475" alt="StarMade Launcher Banner" src="https://www.star-made.org/images/bg1.jpg" />
</div>

# StarMade Launcher v4

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A modern, immersive launcher for [StarMade](https://www.star-made.org/) — the space sandbox game by Schine GmbH. Built with React 19, TypeScript 5, Vite 6, and Electron 41.

---

## ✨ Features

- **Installation Management** — Create, edit, and delete game instances with per-instance Java settings
- **Server Management** — Manage local StarMade server instances
- **Mod Manager** — Browse StarMade mods and modpacks, install/update them per installation, and manage enabled/disabled `.jar` mods
- **Account Switching** — Support for multiple accounts
- **Version Selection** — Switch between latest release, dev builds, and archived versions
- **Live Downloads** — Fetch and download StarMade versions directly from the official CDN
- **News Feed** — Live news pulled from the StarMade Steam page
- **Screenshot Management** — Manage and copy screenshots across multiple instances, and use them as backgrounds for both the launcher and game itself
- **Discord Integration** — Live member count and one-click join button
- **Settings** — Language, Java configuration, default game paths, and memory allocation
- **Cross-Platform** — Windows, macOS, and Linux support

## 📋 Notes

- **Automatic Updating** — The launcher will automatically check for updates and prompt you to download the latest version when available *(Phase 7 - coming soon)*
- **Java Version Switching** — The launcher automatically switches between Java 8 and 25 based on the version of StarMade you're running:
  - StarMade < 0.3 → Java 8
  - StarMade ≥ 0.3 → Java 25 (with required JVM args)
- **Auto-Download Java** — Required Java runtimes will be automatically downloaded

---

## 🚀 Download

Download the latest release for your platform:

- **Windows**: [StarMade-Launcher.exe](https://github.com/StarMade-Community/StarMade-Launcher-v4/releases/latest)
- **macOS**: [StarMade-Launcher.dmg](https://github.com/StarMade-Community/StarMade-Launcher-v4/releases/latest)
- **Linux**: [StarMade-Launcher.AppImage](https://github.com/StarMade-Community/StarMade-Launcher-v4/releases/latest)

> **Note:** See the [Releases](https://github.com/StarMade-Community/StarMade-Launcher-v4/releases) page for all versions and SHA-256 checksums.

---

## 🛠️ Development

### Prerequisites

- **Node.js** 22+ (LTS recommended)
- **npm** 10+

### SMD API Key (Required for SMD mod browsing/install)

The launcher reads the XenForo API key from environment variables in this order:

1. `SMD_API_KEY`
2. `SMD_XF_API_KEY`
3. `XENFORO_API_KEY`

For local development, set one of these in your shell before running Electron.

A template is included at `.env.example`. You can copy it to `.env` and fill in your key.

When running in Electron, the launcher will auto-load `.env.local` or `.env` (first match) if present.

For GitHub Actions builds, set a repository secret named `SMD_API_KEY`.

Do not commit API keys to this repository.

### Run Locally (Web Mode)

```bash
npm install
npm run dev
```

Open your browser at `http://localhost:3000` to see the UI without Electron.

### Run in Electron (Desktop Mode)

```bash
npm install
npm run electron:dev
```

This starts Vite, waits for it to be ready, compiles the Electron main process, and launches the desktop app with hot-reload.

### Build for Production

```bash
# Build renderer assets + Electron main process
npm run electron:build
```

Output is in the `release/` directory:
- Windows: `release/*.exe`
- macOS: `release/*.dmg`
- Linux: `release/*.AppImage`

### Preview Production Build (Without Packaging)

```bash
npm run electron:preview
```

Builds the app and runs it in Electron without creating installers.

---

## 📦 Creating a Release

See **[RELEASE.md](RELEASE.md)** for the full release process.

**Quick steps:**

1. Update version:
   ```bash
   npm run version:minor  # or :patch, :major
   ```

2. Update `CHANGELOG.md` with release notes

3. Commit and tag:
   ```bash
   git add package.json CHANGELOG.md
   git commit -m "chore: bump version to X.Y.Z"
   git tag -a vX.Y.Z -m "Release X.Y.Z"
   git push origin main --tags
   ```

4. GitHub Actions automatically:
   - ✅ Builds for Windows, macOS, and Linux
   - ✅ Creates a draft release with all artifacts
   - ✅ Generates SHA-256 checksums

   Required repository secrets for release builds:
   - `SMD_API_KEY` (XenForo API key used for SMD API access)

5. Review, test, and publish the draft release

---

## 🧪 Testing

The project uses [Vitest](https://vitest.dev/) for unit tests and [React Testing Library](https://testing-library.com/docs/react-testing-library/intro/) for component tests.

### Running tests

```bash
npm test              # run all tests once
npm run test:watch    # run tests in watch mode
npm run test:coverage # run tests and generate coverage report
```

### Test structure

```
tests/
  setup.ts                          # global test setup (@testing-library/jest-dom)
  unit/
    java.test.ts                    # getRequiredJavaVersion, getJvmArgsForJava, parseJavaVersion
    versions.test.ts                # parseBuildIndex (parsing, dedup, branch prefixes)
    launcher.test.ts                # parseStarMadeLogLine, isStderrError
    store.test.ts                   # storeGet, storeSet, storeDelete, disk persistence
  components/
    AboutSection.test.tsx           # rendering, links, attributes
    MemorySlider.test.tsx           # rendering, clamping, snapping, callbacks
```

**Manual smoke testing:**
1. Launch the app
2. Create a new installation
3. Select a version and click Download
4. Verify progress bar tracks file downloads
5. Test cancel/resume functionality
6. Verify installed game appears with Play button

---

## StarMote Troubleshooting

Current scope: StarMote in this launcher currently validates transport connectivity and basic session status, but does not yet complete full command-level protocol readiness.

### Quick checks

- Verify host/port and firewall rules first (client -> server TCP path).
- Use the Server Panel status text and reason code to classify failures.
- Enable debug tracing when needed:

```bash
STARMOTE_DEBUG=1 npm run electron:dev
```

### Reason codes and first actions

- `timeout` - server did not answer in time; verify host/port reachability and listening socket.
- `connect_failed` - TCP connect failed immediately; verify IP/DNS, port, and server uptime.
- `socket_error` - connection dropped after connect; inspect server logs and network stability.
- `closed` - remote side closed a previously connected socket; check server-side disconnect cause.
- `disconnected` - local/manual disconnect (or connect cancelled) was requested.
- `replaced` - a new connect attempt replaced an older in-flight/active session.

### Known limitation

- A `connected` transport state does not yet mean protocol-ready command flow.
- Planned follow-up work is tracked in `TODO.md` under section `## 2) Main-Process StarMote Protocol Layer` and section `## 3) Command Registry and Packet Handling`.

---

## Links

- **Official Website**: https://www.star-made.org/
- **Discord**: https://discord.gg/SXbkYpU
- **Steam**: https://store.steampowered.com/app/244770/StarMade/

## License

MIT © 2026 Schine, GmbH
