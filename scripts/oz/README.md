# OZdash (Oleg's Emdash fork)

This fork adds the built-in MCP server (upstream PR #3086) and two more tools for an
outside "manager" agent: `send_task_message` and `get_task_status`.

The fork builds as **OZdash** (`release/mac-arm64/OZdash.app`). It keeps the old ids
`com.emdash.oz` and data dir `emdash-oz`, so it never shares data with the official
Emdash app. Auto-update is off.

The sidebar shows the "PM" project first: the local project at `~/Projects/work`
(override with the env var `OZDASH_PM_PROJECT_PATH`).

The PM project opens on a **Tickets** board (code in
`apps/emdash-desktop/src/core/features/ozdash`). It reads
`~/Projects/work/vault/tickets/*/ticket.md` (override with `OZDASH_VAULT_PATH`) and
updates when the files change. Columns: Needs Oleg, Active, Waiting. **Parked** and
**Archive** are toggle panels on the right (open/closed is remembered; a search shows
matching rows even in a closed panel). Click a card or a parked row to open the ticket
popup: priority ▲/▼, **Edit**, the Goal with Show more, and actions (card: Park, Open session,
which opens the PM session or starts one with `/oz-pm <id>`). A parked row has Start and Archive (-> dropped); an
archived row has Restore (-> parked). Each write changes the ticket and then syncs the
vault repo (add, commit, pull --rebase --autostash, push).
"New task…" on an open card starts a task for the ticket in another project.
Cards, rows and a task's Ticket panel have a read-only P-chip (P1-P4); ▲/▼ to change
it (debounced into one write) are only in the ticket popup. Cards have a
**Park** button and the Goal (3 lines); drag a card to reorder it within its priority
group (writes `rank:` 10, 20, 30…). Colors per priority: `ozdash/api/priority-palette.ts`.
Each ticket shows a pixel icon: its `icon.svg`, else a sprite made from its id. OZdash
generates missing `icon.svg` files in the background with the Claude CLI (haiku, no
tools, one at a time); turn this off with `OZDASH_TICKET_ICONS=off`.
A task that is a ticket's PM session or child task gets a **Ticket** toggle in its
titlebar (next to Changes / Files / Conversations): a right sidebar tab with the ticket.
**Edit** (popup and Ticket panel) opens the New ticket form prefilled from the file
(title, Goal, priority). Save rewrites only the changed fields in place (a new priority
clears `rank:`), sets `updated:`, adds the Log line `Edited in OZdash (<fields>)` and
syncs once. The folder keeps its name. If the title, Goal or priority changed on disk
since the form opened, Save shows an error and writes nothing.

Lifecycle: a ticket becomes `active` (Log `Started (<reason>)`) as soon as it gets a
session: Start / card open, a linked PM session, or a child task (OZ Tickets, "New
task…", MCP `create_task` with `ticket`). Waiting and blocked tickets stay as they are.
A legacy `status: draft` reads as `parked`.

In the PM project, "new task" (sidebar "+", ⌘N, the board, the task list) is
**New ticket** (title, description, priority P1-P4, default P3): it writes
`vault/tickets/<id>-<slug>/ticket.md` (parked, no PM session)
and syncs once. A PM task that no ticket points to shows "no ticket"; its header chip
can link it to a ticket or create a ticket for it (that ticket is active).

- Build: `scripts/oz/build-mac.sh` (needs Node 24 and pnpm 10.28 on PATH). Run `scripts/oz/make-signing-cert.sh` once first, so every build has a valid signature. macOS still asks once for keychain access after each rebuild (no Apple Team ID); click Always Allow.
- Icons: `icon-app.swift` and `icon-light.swift` draw the OZ versions of
  `src/assets/images/emdash/emdash.png` and `icon-light.png` from the upstream
  originals. Run with `swift <script> <upstream png> <out png>`. Make the `.icns`
  with `sips` + `iconutil` (sizes 16 to 1024).
- Branding: `make-branding.sh` rebuilds the OZdash wordmark (`ozdash-wordmark.py` ->
  `ozdash-wordmark.svg`), the DMG background (`dmg-background.py` ->
  `build/dmg-background.tiff`, 1x + 2x) and the dev-build icon (`icon-dev.swift` ->
  `emdash-dev.png`). Needs `rsvg-convert` (`brew install librsvg`). The wordmark paths in
  `emdash-logo.tsx` and the boot splash in `renderer/index.html` come from
  `python3 scripts/oz/ozdash-wordmark.py --paths`.
