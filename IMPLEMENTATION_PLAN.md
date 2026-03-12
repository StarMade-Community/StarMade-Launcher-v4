# StarMade Launcher v4 — Implementation Plan

## Current State

The launcher is a **React + TypeScript + Vite** single-page application currently running as a pure
web front-end.  All critical launcher functionality is mocked or absent; only two live integrations
exist today.

### What Is Already Done ✅

| Area | Detail |
|------|--------|
| **UI / UX shell** | Full page layout — Play, Installations, News, Settings — with header, footer, modals, dropdowns, and icon picker |
| **Theming** | StarMade dark sci-fi colour palette, Exo 2 / Inter fonts, Tailwind utility classes |
| **Installation & Server CRUD** | In-memory create / edit / delete for installations and servers via `DataContext` |
| **Account switching** | Multiple accounts stored in context; active account reflected in header |
| **Version list** | Version selector in footer and installation form; correct StarMade version IDs |
| **Settings UI** | All four settings sections (Launcher, Accounts, Defaults, About) with form controls |
| **News feed** | `useNewsFetch` hook fetches and parses real StarMade Steam RSS via CORS proxy |
| **Discord integration** | Footer fetches live member / online count and invite URL from Discord Widget API |
| **Launch modal** | Confirmation modal with "launch anyway / terminate / cancel" options |
| **Launch progress bar** | Animated progress bar in footer during launch sequence |
| **TypeScript types** | All domain types defined in `types/index.ts` |
| **Branding** | No Minecraft references; all version numbers and paths use StarMade format |

### What Is Still Mocked or Missing ❌

| Area | Current State | Missing |
|------|--------------|---------|
| **Desktop shell** | Plain Vite web app | No Electron / Tauri integration |
| **Window controls** | Rendered but inert | Minimize / maximise / close do nothing |
| **Game launch** | Fake progress bar only | No process spawning |
| **Game download** | Absent | No version manifest, download, or extraction |
| **Account auth** | Mock accounts only | No OAuth or credential flow |
| **Java detection** | No logic | No JDK scanning or download |
| **Data persistence** | All in-memory | Settings, installations, accounts lost on restart |
| **Play page news** | Hardcoded mock array | Not wired to the real `useNewsFetch` hook |
| **Process detection** | Launch modal copy only | Cannot detect a running StarMade instance |

---

## Implementation Phases

---

### Phase 1 — Desktop Framework Integration

**Goal:** Turn the React app into a real cross-platform desktop application.

**Recommended stack:** [Electron](https://www.electronjs.org/) with
[electron-builder](https://www.electron.build/) for packaging.

#### Tasks

- [ ] Add `electron`, `electron-builder`, `concurrently`, and `wait-on` as dev dependencies
- [ ] Create `electron/main.ts` — BrowserWindow setup, menu, auto-updater stub
- [ ] Create `electron/preload.ts` — expose a typed `window.launcher` IPC bridge to the renderer
- [ ] Define IPC channel names in `electron/ipc-channels.ts` (shared constants)
- [ ] Update `package.json`:
	- Add `"main": "dist-electron/main.js"` entry
	- Add scripts: `electron:dev`, `electron:build`, `electron:preview`
	- Add `build` config block for `electron-builder` (Windows NSIS, macOS DMG, Linux AppImage)
- [ ] Update `vite.config.ts` to support the Electron renderer context
- [ ] Wire window-control buttons (`Header.tsx`) to `ipcRenderer.send('window:minimize')` etc.

#### Deliverables

- App opens in a frameless Electron window
- Minimize / maximise / close buttons work
- `window.launcher` API is available in the renderer

---

### Phase 2 — Data Persistence

**Goal:** Survive restarts.  All user-created data and settings must be saved to disk.

#### Tasks

- [ ] **Main process**: Add `electron-store` (or hand-rolled JSON via Node `fs`) as the persistence
  layer in `electron/store.ts`
- [ ] **IPC handlers** (main):
	- `store:get(key)` → returns stored value
	- `store:set(key, value)` → persists value
	- `store:delete(key)` → removes key
- [ ] **DataContext** (`contexts/DataContext.tsx`):
	- On mount, load accounts / installations / servers / versions from `window.launcher.store.get`
	- On every mutation (add / edit / delete), call `window.launcher.store.set`
- [ ] **Settings persistence** (`components/pages/Settings/`):
	- `LauncherSettings.tsx` — persist language, close-behaviour, auto-update toggle
	- `DefaultSettings.tsx` — persist default game directory, memory, JVM args, resolution
- [ ] **Migration helper**: version-stamp the store schema for future upgrades

#### Deliverables

- Installations, servers, accounts, and settings survive app restart

---

### Phase 3 — Version Manifest & Game Download

**Goal:** Fetch the real list of StarMade versions and download / install the game files.

#### Tasks

- [ ] **Research & document** the StarMade version manifest URL and file format
- [ ] **Main process** `electron/versions.ts`:
	- `versions:fetch` IPC — HTTP GET manifest, parse, return typed `Version[]`
	- Cache manifest locally (TTL-based)
- [ ] **Main process** `electron/downloader.ts`:
	- `download:start(versionId, targetDir)` IPC — streams game archive to a temp file
	- `download:progress` IPC event — emits `{ percent, bytesReceived, totalBytes }`
	- `download:verify` — checksum verification (SHA-256 or MD5 per manifest)
	- `download:extract` — unzips / untars to the installation directory
	- `download:cancel` — aborts in-flight download
- [ ] **Renderer** `DataContext.tsx`:
	- Replace hardcoded `versionsData` with live call to `versions:fetch` on startup
	- Expose `downloadVersion(versionId, path)` action
- [ ] **Installations page** (`components/pages/Installations/index.tsx`):
	- Show download progress bar on cards where version is not yet installed
	- Disable "Play" until download completes

#### Deliverables

- Version dropdown populated from live manifest
- Clicking "Create Installation" triggers a real download with live progress
- Downloaded files are verified and extracted

---

### Phase 4 — Java Detection & Management

**Goal:** Locate a suitable JDK automatically and let the user override it.

#### Tasks

- [ ] **Main process** `electron/java.ts`:
	- `java:detect` IPC — scan common install paths per OS, run `java -version`, parse output
	- `java:list` — return all detected JDKs with version and path
	- `java:download(version)` — download Adoptium / Temurin JDK (min Java 8, rec. Java 17)
- [ ] **LauncherSettings.tsx** (`Manage Java` section):
	- On mount, call `java:list` and display results
	- "Detect Java" button triggers `java:detect` and refreshes list
	- "Download Java" button opens download flow for a specific JDK version
	- Path field allows manual override with file-picker
- [ ] **InstallationForm.tsx**:
	- Java Executable Path field uses `java:list` results as suggestions in a datalist

#### Deliverables

- Launcher auto-detects installed JDKs on first run
- Users can download Adoptium JDK from within the launcher
- Per-installation JDK override persists

---

### Phase 5 — Game Launch

**Goal:** Actually start StarMade (or a StarMade server) as a child process.

#### Tasks

- [ ] **Main process** `electron/launcher.ts`:
	- `game:launch(installationId)` IPC:
		1. Resolve installation path, version, and Java settings from store
		2. Build JVM argument array (`-Xms`, `-Xmx`, custom JVM args, classpath)
		3. `child_process.spawn` the Java process with correct working directory
		4. Pipe stdout / stderr to a log buffer
	- `game:stop` IPC — send SIGTERM / taskkill to the child process
	- `game:status` IPC — return `{ running: boolean, pid?: number }`
	- `game:log` IPC event — stream log lines to renderer
	- `server:launch(serverId)` / `server:stop(serverId)` — same but with server startup flags
- [ ] **AppContext.tsx**:
	- Replace `startLaunching()` stub with real `window.launcher.game.launch(id)` call
	- Subscribe to `game:log` for a console output view (Phase 7)
	- On `game:status` change, update `isLaunching` state
- [ ] **LaunchConfirmModal.tsx**:
	- Wire "Terminate existing instance" button to `game:stop`
	- Wire "Check for running instance" to `game:status`
- [ ] **Footer.tsx**:
	- "Start Server" button calls `server:launch`

#### Deliverables

- "Launch" button starts StarMade as a real subprocess
- Progress bar reflects actual JVM startup (process running = 100%)
- "Start Server" starts a dedicated server process
- Existing-instance detection works via real PID check

---

### Phase 6 — Account Authentication

**Goal:** Allow players to log in with a real StarMade / Schine account.

#### Tasks

- [ ] **Research** the StarMade auth API (credentials → session token flow)
- [ ] **Main process** `electron/auth.ts`:
	- `auth:login(username, password)` IPC — POST credentials, store session token securely
	  (use `keytar` / OS credential store)
	- `auth:logout(accountId)` IPC — revoke / delete stored token
	- `auth:validate(accountId)` IPC — check stored token is still valid
- [ ] **AccountSettings.tsx**:
	- Wire "Add Account" button to open a login modal with username / password fields
	- Wire "Log Out" button to `auth:logout`
	- Show account validation status (token valid / expired)
- [ ] **Offline / guest mode**:
	- Allow launching without an account (no multiplayer)
	- Mark account as "(Offline)" in header

#### Deliverables

- Users can log in with a Schine account
- Session tokens stored securely in OS credential store
- Offline / guest mode available as fallback

---

### Phase 7 — Polish & Remaining UI Wiring

**Goal:** Connect the remaining unimplemented UI elements.

#### Tasks

- [ ] **Play page news** — replace hardcoded `newsData` array with data from `useNewsFetch` hook
- [ ] **Game console / log viewer** — add a collapsible log panel (or new Settings section) that
  streams stdout from the running game process
- [ ] **Auto-updater** — integrate `electron-updater`; show update banner in header when a new
  launcher version is available
- [ ] **File-picker dialogs** — wire the `FolderIcon` browse buttons in `InstallationForm.tsx` and
  `DefaultSettings.tsx` to `dialog.showOpenDialog` via IPC
- [ ] **"Check for updates" button** in `LauncherSettings.tsx` — trigger `versions:fetch` and
  compare against installed versions
- [ ] **Language support** — connect language dropdown to an i18n library (e.g. `i18next`)
- [ ] **Close-behaviour setting** — wire "hide to tray" option to `electron.app.hide()` and a
  system-tray icon

---

### Phase 8 — Packaging & Distribution

**Goal:** Produce installable binaries for Windows, macOS, and Linux.

#### Tasks

- [ ] Configure `electron-builder` targets:
	- Windows: NSIS installer + portable `.exe`
	- macOS: DMG + notarisation
	- Linux: AppImage + `.deb`
- [ ] Set up code signing (Windows Authenticode, macOS Developer ID)
- [ ] Create GitHub Actions workflow:
	- Build on push to `main`
	- Publish draft release with binaries on version tag
	- Run `electron-updater` feed from GitHub Releases
- [ ] Write end-to-end smoke test (Playwright + `spectron` or `playwright-electron`)

---

## Dependency Summary

The following packages will need to be added as the phases above are implemented.

| Package | Phase | Purpose |
|---------|-------|---------|
| `electron` | 1 | Desktop runtime |
| `electron-builder` | 1 | Cross-platform packaging |
| `concurrently`, `wait-on` | 1 | Dev script orchestration |
| `electron-store` | 2 | Persistent JSON settings on disk |
| `electron-updater` | 7/8 | Auto-update from GitHub Releases |
| `keytar` | 6 | Secure OS credential storage for tokens |
| `i18next`, `react-i18next` | 7 | Internationalisation |
| `@electron/notarize` | 8 | macOS notarisation during build |

---

## Risk & Open Questions

| Item | Risk | Notes |
|------|------|-------|
| StarMade version manifest URL | High | Needs reverse-engineering of `starmade-starter.jar`; game may no longer have an active CDN |
| StarMade auth API | High | Schine servers may be offline; fall back to offline mode |
| Java version compatibility | Medium | StarMade requires Java 8 on older versions; confirm per-version JDK requirements |
| CORS proxy reliability | Low | `useNewsFetch` uses `allorigins.win`; replace with Electron's native `net` module in Phase 1 |
| macOS notarisation | Low | Requires paid Apple Developer account |
