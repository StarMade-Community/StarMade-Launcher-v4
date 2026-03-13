# TODO

## P0 - Server Panel integration (next)

- [ ] Wire `ServerPanel` fields to real server data sources instead of placeholders in `components/pages/ServerPanel/index.tsx`.
- [ ] Add selected-server context loading/fallback behavior (no server configured, missing server, deleted server).
- [ ] Prevent accidental edits in placeholder-only fields until save/write paths are implemented.
- [ ] Connect footer and server-card entry points to preserve the exact selected server state.

## P0 - Server lifecycle controls

- [ ] Hook **Start / Stop / Restart / Update Server** buttons to Electron IPC handlers.
- [ ] Show lifecycle state (`starting`, `running`, `stopping`, `stopped`, `error`) in the status panel.
- [ ] Disable/enable action buttons based on current lifecycle state.
- [ ] Add user-facing error states for failed start/stop/update operations.

## P0 - Logs tab (replace placeholders)

- [ ] Replace `placeholderLogs` with live stream data from launcher server/game log events.
- [ ] Keep log filter UX parity with `components/common/GameLogViewer.tsx`.
- [ ] Implement Clear / Open Folder / Export actions against real server log paths.
- [ ] Add bounded log buffering (cap entries) to avoid memory growth in long sessions.

## P1 - Configuration / Files / Database tabs

- [ ] Configuration tab: map exact game config paths and load/save workflow.
- [ ] Files tab: add server directory browser and safe file operations.
- [ ] Database tab: define supported operations and read-only vs write actions.
- [ ] Add confirmation prompts for destructive operations (delete/reset/overwrite).

## P1 - UI polish and responsiveness

- [ ] Finalize responsive behavior for narrow heights/widths in `ServerPanel`.
- [ ] Add loading/empty/error component states for each tab.
- [ ] Match spacing/typography/border treatments across launcher pages.
- [ ] Add small accessibility pass (labels, focus order, keyboard nav).

## P1 - Tests

- [ ] Add component tests for tab switching and Server Panel entry navigation.
- [ ] Add tests for log filtering behavior and empty-state rendering.
- [ ] Add tests for lifecycle button enabled/disabled states.
- [ ] Add integration tests for server action wiring once IPC is connected.

## P2 - Existing launcher backlog

- [ ] Account auth with StarMade registry hardening.
- [ ] Launcher auto-updating improvements and UX states.
- [ ] Detect/import older (pre-v4) launcher installations.
- [ ] Expand preset icons/backgrounds and ensure packaging coverage.
- [ ] Continue general UI improvements and bug fixes.

## Docs / release follow-ups

- [ ] Update `README.md` with Server Panel status and current limitations.
- [ ] Add a short developer note documenting expected config/log path contracts.
- [ ] Add release note entry when server lifecycle wiring lands.