# AGENTS.md

## Big picture
- `index.tsx` wraps `App` in `AppProvider` and then `DataProvider`; most renderer state is reached through those two contexts.
- Navigation is state-driven, not router-based: `App.tsx` switches on `activePage` and passes `pageProps` into pages.
- Non-Play pages are framed by `components/common/PageContainer.tsx`, which also wires the close button back to `Play`.
- `contexts/AppContext.tsx` owns UI state (active page, launch modal, fake launch progress); `contexts/DataContext.tsx` owns domain state (accounts, installations, servers, versions).
- `types/index.ts` is the source of truth for shared shapes; `ManagedItem` is reused for both installations and servers, with optional `port` for server-only data.

## Electron / renderer boundary
- Treat React code as browser-only. Renderer components should call the context-isolated `window.launcher` API from `electron/preload.ts` instead of importing Electron or Node APIs.
- Add new IPC names only in `electron/ipc-channels.ts`; `components/layout/Header.tsx` is the reference pattern for `window:minimize`, `window:maximize`, and `window:close`.
- Keep `electron/main.ts` as the owner of frameless-window behavior, external-link handling, and IPC handlers. Preserve its `// ─── ... ───` section layout when expanding it.
- Whenever the preload surface changes, update `types/electron.d.ts` in the same change so renderer typings stay aligned.

## What is live today vs mocked
- Live integrations today are limited: Steam news RSS in `components/hooks/useNewsFetch.ts`, Discord widget fetch in `components/layout/Footer.tsx`, and Electron window controls.
- Most launcher behavior is still mocked/in-memory: `DataContext.tsx` seeds from `data/mockData.ts`, `AppContext.tsx` simulates launch progress, and `components/pages/Play/index.tsx` still renders hardcoded news cards.
- Mock paths in `data/mockData.ts` and form defaults are Windows-style placeholders even on Linux/macOS; do not treat them as real platform defaults.

## Repo-specific coding patterns
- Use `useApp()` and `useData()` instead of consuming contexts directly; both hooks intentionally throw if used outside their provider.
- Follow the existing file layout: page entrypoints live at `components/pages/<Page>/index.tsx`, while reusable UI belongs in `components/common/`.
- Match surrounding import style. The `@/` alias is configured in `vite.config.ts` and `tsconfig.json`, but much of the current code still uses relative imports; keep diffs local and consistent.
- Tailwind utility classes are the default styling mechanism. Inline `style` is only used where Tailwind cannot express the behavior cleanly (for example `WebkitAppRegion`, `backgroundImage`, and SVG `clipPath`).
- Preserve the StarMade theme conventions already in use: `starmade-*` color utilities, dark translucent panels, and uppercase `font-display` headings.

## Development workflows
- Install dependencies with `npm install`.
- Browser-only UI loop: `npm run dev` (Vite serves on `http://localhost:3000`).
- Full desktop loop: `npm run electron:dev` (runs Vite, waits for port 3000, compiles Electron TypeScript, then launches Electron).
- Renderer production build: `npm run build`.
- Desktop/package build: `npm run electron:build`; local Electron preview of the built app: `npm run electron:preview`.
- Electron code compiles separately with `tsconfig.electron.json` into `dist-electron/`; renderer assets build into `dist/`.
- There is currently no `test` or `lint` script in `package.json`; validate changes with smoke testing in the browser and/or Electron mode for the files you touched.

## Source for V2
There is code for the old launcher in the `v2_src` folder. Look there for reference on how the old launcher worked.