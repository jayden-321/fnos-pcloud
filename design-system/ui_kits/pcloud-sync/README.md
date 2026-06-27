# pCloud NAS Sync — UI kit

An interactive, high-fidelity recreation of the **pCloud NAS Sync** product UI
(fnOS Docker app). It composes the design-system component primitives — it does
not re-implement them.

## Screens
- **Sync Tasks / Sync Tasks** (`TasksScreen`) — header actions, 7-up metrics strip,
  task cards, live queue table.
- **Sync Logs / Sync Logs** (`LogsScreen`) — filterable file-level log table.
- **Settings / Settings** (`SettingsScreen`) — per-task editors, pCloud authorization,
  sync rules, and the **pCloud speed test** panel (`SpeedTestPanel`).
- **Folder picker** (`FolderDialog`) — local / remote folder browser modal.

## Interactions
Tab switching, header action toasts, "create task" flow, folder-picker
navigation (drill in / up / select), log filtering by status + filename, and a
runnable speed test (start → running → result).

## Files
- `index.html` — entry point; loads React, the DS bundle, and the kit scripts.
- `kit.css` — product layout ported from `public/styles.css`; tokens come from
  the design system.
- `data.js` — realistic fake tasks, logs, totals, folder tree.
- `screens.jsx` — `Sidebar`, `TasksScreen`, `LogsScreen`, `SettingsScreen`,
  `SpeedTestPanel`, `FolderDialog`.
- `app.jsx` — tab state, toast, dialog wiring.

Language is English, matching the public repository copy.
