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
A PM session also gets a **Sessions** toggle: the ticket's tasks in all projects (ticket
marker, or `emdash: <task id>` in the ticket file as `/oz-ticket-link` writes it; not the
PM session, not archived), with agent, project, live status and last activity. Needs-input
/ error rows come first (attention colors), then working, then the rest. Click opens the task.
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

**⚡ Flash** (a toggle in New / Edit ticket) is for urgent, short work (a quick
investigation or a quick build). It saves `priority: 0` (P0, sorted above P1) and dims
the P1-P4 picker. A new flash ticket starts at once: the same path as Start (active, PM
session `/oz-pm <id>`, Log `Started (flash ticket)`), then OZdash opens the session. In
Edit, Flash only changes the priority (no start). P0 cards, rows and the Ticket panel are
gold (`#F5C451`) with a soft glow and a `⚡ P0` chip. In the popup, ▲ stops at P1 and ▼
from P0 goes to P1.

**Agent palette** (`<vault>/context/agents.md`, a `| name | agent | model | effort | use for |`
table; code in `ozdash/api/agent-palette.ts`). The file is read each time, so edits apply at once.
- A ticket's PM session (Start, card open, flash) uses the `pm` row, with auto-approve. No
  file or no `pm` row (or an unknown agent in it): claude + opus.
- The New Task dialog (also "New task…" on a card) shows the rows as chips above the agent
  picker. A chip sets agent + model (+ effort) and turns auto-approve on for that agent.
- No permission prompts by default: MCP `create_task` defaults `autoApprove` to true (pass
  `false` to get prompts), and a terminal agent with no saved choice starts with the
  New Task "Auto-approve permissions" switch on (upstream: off).
- `create_task` accepts any `model` id the CLI knows (the plugin lists are only suggestions)
  and an `effort`. Command lines: claude `--dangerously-skip-permissions --model <m>
  --effort <e>`; codex `-c approval_policy=never -c sandbox_mode=danger-full-access
  --dangerously-bypass-hook-trust -m <m> -c model_reasoning_effort=<e>`; cursor `-f
  --approve-mcps --model <m>` (no effort flag: put it in the model id, for example
  `cursor-grok-4.6-high`). Effort applies in terminal mode only.

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
