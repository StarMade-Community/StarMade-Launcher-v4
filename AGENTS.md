# AGENTS.md

## Project map (Electron + React)
- Renderer entry is `index.tsx` (`DataProvider` wraps `AppProvider`), so cross-page/state work usually touches `contexts/DataContext.tsx` and `contexts/AppContext.tsx`.
- Electron entry is `electron/main.ts`; all privileged operations (fs/network/process/auth/update) are main-process only.
- IPC contract is 3-part and must stay in sync: `electron/ipc-channels.ts` (channel names) -> `electron/preload.ts` (bridge surface) -> `types/electron.d.ts` (renderer typings).
- Shared app models live in `types/index.ts` (`ManagedItem`, `Version`, `PlaySession`, `DownloadStatus`); prefer extending these before adding ad-hoc shapes.

## Data flow and boundaries
- Renderer must guard Electron-only APIs; follow existing `hasStore/hasVersions/hasDownload/hasAuth` checks in `contexts/DataContext.tsx` for browser-mode safety.
- Persisted state is JSON store-backed via IPC (`store:get/set/delete`), with keys centralized in `DataContext` (`SK_*` constants).
- Download lifecycle is push-driven: renderer calls `window.launcher.download.start(...)`, then listens via `onProgress/onComplete/onError` (see `DataContext.tsx`).
- Launch flow is coordinated in `AppContext.startLaunching()`: Java precheck/download -> `window.launcher.game.launch(...)` -> session recording for quick-play widgets.
- Main process injects auth token on launch (`electron/main.ts` + `electron/auth.ts` + `electron/launcher.ts`); renderer never handles raw tokens.

## Core services to know before editing
- `electron/versions.ts`: fetches StarMade branch indices (`release/dev/pre/archive`), 5-min in-memory TTL cache, tolerant per-branch failures.
- `electron/downloader.ts`: checksum-first updater (SHA-1), atomic `.tmp` writes/renames, concurrent worker pool (`CONCURRENCY = 3`), cancellable sessions.
- `electron/java.ts`: version rule is StarMade `>= 0.300.x` -> Java 25, else Java 8; Java 25 requires extra JVM args.
- `electron/updater.ts`: GitHub releases updater; Windows/Linux support self-update, macOS intentionally falls back to releases page.
- `electron/store.ts`: single `launcher-store.json` with `__version` migration hook; writes are atomic temp-file renames.

## Build, run, test workflow
- Install + web UI only: `npm install` then `npm run dev` (Vite on port 3000 from `vite.config.ts`).
- Desktop dev mode: `npm run electron:dev` (runs Vite + compiles electron tsconfig + launches Electron).
- Production package build: `npm run electron:build` (outputs to `release/` per `package.json` electron-builder config).
- Tests: `npm test`, `npm run test:watch`, `npm run test:coverage`.
- Vitest default env is `node` (`vitest.config.ts`); component tests opt into jsdom per-file (`// @vitest-environment jsdom`, e.g. `tests/components/MemorySlider.test.tsx`).

## Project conventions observed in code
- Keep `window.launcher` API typed and minimal; add new APIs to preload + d.ts together, not directly in renderer.
- Prefer "safe fallback" behavior over hard failure (many main-process handlers return null/partial data instead of throwing).
- Keep filesystem writes atomic (`*.tmp` then rename) and avoid overwriting user-customized assets (see preset copy in `electron/main.ts`).
- Session identity is deterministic (`installation + server + port + mods`) to preserve pin/unpin behavior (`contexts/AppContext.tsx`).
- Existing code uses sectioned comments (`// ─── ... ───`) in core modules; follow that style for large additions.

## External integrations / risk points
- StarMade CDN endpoints use HTTP (`files.star-made.org`) in `electron/versions.ts` and `electron/downloader.ts`; preserve manifest parsing assumptions.
- Registry auth is OAuth ROPC against `registry.star-made.org` in `electron/auth.ts`; tokens are encrypted with `safeStorage` when available.
- Auto-update checks GitHub API (`StarMade-Community/StarMade-Launcher-v4`) in `electron/updater.ts`; asset selection is platform-specific.
- Linux-specific startup behavior (Wayland + no-sandbox/AppImage constraints) is handled in `electron/main.ts` and `afterPack.cjs`; avoid regressing these guards.

## Notes
- There is starmade source code available at "/home/garret/Documents/Projects/StarMade-Release/", which will be useful for looking up game internals and config/log path contracts.