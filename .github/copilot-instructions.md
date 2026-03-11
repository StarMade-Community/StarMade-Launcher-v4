# Copilot Instructions for StarMade Launcher v4

## Project Overview

StarMade Launcher v4 is a modern, cross-platform desktop launcher for [StarMade](https://www.star-made.org/) — an open-world space sandbox game by Schine GmbH. It is built with **React 19**, **TypeScript 5**, **Vite 6**, and **Electron 41**, and follows a phased development plan documented in `IMPLEMENTATION_PLAN.md`.

The UI uses a dark sci-fi theme with Tailwind CSS (loaded via CDN) and custom color variables prefixed `starmade-*`.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| UI | React 19, TypeScript 5 |
| Bundler | Vite 6 |
| Desktop runtime | Electron 41 |
| Styling | Tailwind CSS (CDN), custom `starmade-*` color palette |
| Fonts | Exo 2, Inter (Google Fonts) |
| Packaging | electron-builder (NSIS / DMG / AppImage) |
| CI/CD | GitHub Actions — build + GitHub Pages deploy |

---

## Repository Structure

```
.
├── components/
│   ├── common/        # Shared UI: modals, forms, cards, icons, tooltips, dropdowns
│   ├── hooks/         # Custom React hooks (useNewsFetch, useOnClickOutside)
│   ├── layout/        # Header, Footer
│   └── pages/         # Play, Installations, News, Settings (each in its own subfolder)
├── contexts/          # AppContext (navigation, modal state) and DataContext (data CRUD)
├── data/              # Mock data (mockData.ts) — replaced by disk persistence in Phase 2
├── electron/          # Electron main process (main.ts), preload (preload.ts), IPC channels
├── types/             # Domain types (index.ts) and Electron IPC type declarations
├── utils/             # Utility helpers (e.g., getIconComponent)
├── App.tsx            # Root component (routing between pages)
├── index.tsx          # React entry point
├── index.html         # HTML shell
├── vite.config.ts     # Vite config (base './', outDir 'dist', path alias '@/*')
├── tsconfig.json      # TypeScript config for the renderer process
└── tsconfig.electron.json  # TypeScript config for the Electron main process
```

---

## Coding Conventions

### General
- All source files use **TypeScript** — avoid plain `.js` files.
- Prefer **explicit type annotations** on props and function return types.
- Use the path alias **`@/`** (resolves to repo root) for absolute imports instead of deep relative paths.

### React Components
- Use **PascalCase** for component filenames and exported names (e.g., `LaunchConfirmModal.tsx`).
- Annotate components as `React.FC<Props>` with a co-located `Props` interface.
- Place page-level components under `components/pages/<PageName>/index.tsx`.
- Place reusable components under `components/common/`.

### Hooks
- Custom hooks live in `components/hooks/` and use the **`use*` prefix** (e.g., `useNewsFetch`).

### State Management
- Global UI state (current page, modal visibility) lives in **`AppContext`**.
- Domain data (accounts, installations, servers, versions) lives in **`DataContext`**.
- Access context via the custom hooks `useApp()` and `useData()` — never consume context directly.
- Both contexts throw a descriptive error when used outside their provider.

### Electron / IPC
- All IPC channel names are defined as constants in **`electron/ipc-channels.ts`** — never use bare string literals for channel names.
- Renderer-to-main communication goes through the **context-isolated** `window.launcher` API exposed in `electron/preload.ts`.
- Keep the main process code in `electron/main.ts` organised with `─────` section headers.

### Styling
- Use **Tailwind utility classes** for layout and spacing.
- Use the custom `starmade-*` color palette (e.g., `bg-starmade-bg`, `text-starmade-accent`) to stay on-theme.
- Do **not** add inline `style` props unless Tailwind cannot express the style.

### Naming
- Constants use **UPPERCASE_SNAKE_CASE** (e.g., `IPC.WINDOW_MINIMIZE`).
- Interfaces/types use **PascalCase** (e.g., `ManagedItem`, `AppContextType`).
- Files that export a single default component use the component name as the filename.

---

## Development Workflow

```bash
# Install dependencies
npm install

# Web-only development server (no Electron)
npm run dev            # serves at http://localhost:3000

# Full Electron development (hot-reload)
npm run electron:dev

# Production build (web assets + Electron main process)
npm run electron:build

# Preview production web build in browser
npm run preview

# Preview production build in Electron (without packaging)
npm run electron:preview
```

> Vite is configured with `base: './'` and `outDir: 'dist'` (see `vite.config.ts`).
> The Electron main entry point is `dist-electron/main.js`.

---

## Testing

There is currently **no test framework** configured in this repository. End-to-end smoke tests using Playwright and Spectron are planned for Phase 7 of the implementation plan. When adding tests, follow these guidelines:

- Place test files alongside the code they test using the `.test.ts` / `.test.tsx` naming convention.
- Use **Vitest** as the unit/integration test runner (consistent with Vite).
- Use **Playwright** for end-to-end and Electron integration tests.

---

## Important Patterns

### Mock Data → Real Data
`data/mockData.ts` currently seeds all contexts with static data. Phase 2 will replace this with JSON files persisted in the user's `appData` directory via Electron IPC. Do not tightly couple new features to the mock data layer.

### News Feed
`components/hooks/useNewsFetch.ts` fetches the StarMade Steam RSS feed through a CORS proxy. When working on the news feature, ensure changes are resilient to network failures.

### Window Controls
The Electron window is **frameless** with custom title-bar buttons. Window minimize/maximize/close events flow through the `window.launcher.*` IPC bridge — never interact with `electron.remote` or `BrowserWindow` directly from renderer code.

---

## Phase Status (as of repo creation)

The project follows an 8-phase plan. Refer to `IMPLEMENTATION_PLAN.md` for full details.

| Phase | Description | Status |
|-------|-------------|--------|
| 0 | UI/UX scaffolding | ✅ Complete |
| 1 | Electron desktop integration | 🔧 In progress |
| 2 | Data persistence | ⬜ Pending |
| 3 | Version download & extraction | ⬜ Pending |
| 4 | Java detection & installation | ⬜ Pending |
| 5 | Game process launching | ⬜ Pending |
| 6 | Account authentication | ⬜ Pending |
| 7 | Polish & i18n | ⬜ Pending |
| 8 | Packaging & distribution | ⬜ Pending |
