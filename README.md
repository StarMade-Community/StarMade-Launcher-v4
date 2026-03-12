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
- **Account Switching** — Support for multiple accounts
- **Version Selection** — Switch between latest release, dev builds, and archived versions
- **Live Downloads** — Fetch and download StarMade versions directly from the official CDN
- **News Feed** — Live news pulled from the StarMade Steam page
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

- **Windows**: [StarMade-Launcher.exe](https://github.com/YOUR_ORG/StarMade-Launcher-v4/releases/latest)
- **macOS**: [StarMade-Launcher.dmg](https://github.com/YOUR_ORG/StarMade-Launcher-v4/releases/latest)
- **Linux**: [StarMade-Launcher.AppImage](https://github.com/YOUR_ORG/StarMade-Launcher-v4/releases/latest)

> **Note:** See the [Releases](https://github.com/YOUR_ORG/StarMade-Launcher-v4/releases) page for all versions and SHA-256 checksums.

---

## 🛠️ Development

### Prerequisites

- **Node.js** 20+ (LTS recommended)
- **npm** 10+

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

5. Review, test, and publish the draft release

---

## 📚 Documentation

- **[IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)** — Phase-by-phase development roadmap
- **[AGENTS.md](AGENTS.md)** — Codebase architecture and patterns
- **[CHANGELOG.md](CHANGELOG.md)** — Version history and release notes
- **[RELEASE.md](RELEASE.md)** — Release process and troubleshooting
- **[PHASE_3_SUMMARY.md](PHASE_3_SUMMARY.md)** — Download system implementation details
- **[PHASE_4_GUIDE.md](PHASE_4_GUIDE.md)** — Java auto-download implementation guide
- **[.github/copilot-instructions.md](.github/copilot-instructions.md)** — Coding conventions for contributors

---

## 🧪 Testing

Currently, there is no automated test suite. Phase 7 will add:
- Unit tests with Vitest
- E2E tests with Playwright
- CI test runs before releases

**Manual smoke testing:**
1. Launch the app
2. Create a new installation
3. Select a version and click Download
4. Verify progress bar tracks file downloads
5. Test cancel/resume functionality
6. Verify installed game appears with Play button

---

## Links

- **Official Website**: https://www.star-made.org/
- **Discord**: https://discord.gg/starmade
- **Steam**: https://store.steampowered.com/app/244770/StarMade/

## Contributing

Before contributing, please read the [Copilot / AI coding instructions](.github/copilot-instructions.md) — they document the project conventions, architecture, and development workflow that all contributors (human or AI) should follow.

## License

MIT © 2026 Schine, GmbH