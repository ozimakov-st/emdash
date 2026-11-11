# 03 PM project and tickets

The "work" repo (`~/Projects/work`) is a project in OZdash called the **PM project**. Its
tasks are PM sessions, one per ticket. The PM project opens on a **Tickets board** that
reads and writes the ticket files in the vault.

```
~/Projects/work/vault/tickets/12-add-scim/ticket.md   <- one ticket
~/Projects/work/vault/tickets/12-add-scim/icon.svg    <- its pixel icon (generated)
~/Projects/work/vault/templates/ticket.md             <- template for New ticket
```

## Requirements

### PM project

| ID | Requirement | Why |
|---|---|---|
| TK-1 | The local project at `~/Projects/work` (env `OZDASH_PM_PROJECT_PATH`) is the PM project. Match = local project whose normalized path equals that path (`~` expanded, no symlink resolve). SSH projects never match. | One fixed place for PM sessions. |
| TK-2 | The PM project is always first in the sidebar, with a Briefcase icon, a `PM` badge and its name in muted text. Dragging another project above it does not move it. | Always in reach. |
| TK-3 | The PM project's main panel has a first pill tab **Tickets** (selected by default) and a wider page (`max-w-6xl`). The PM sidebar row has a Tickets button on hover. | The board is the PM home. |
| TK-4 | In the PM project every "new task" path shows the **New ticket** form instead: sidebar "+", Cmd+N, command palette (title "New Ticket"), board toolbar, Tasks tab button and empty state, and "create task from PR / workspace". | A PM task is always a ticket's PM session. |

### Ticket file and vault sync

| ID | Requirement | Why |
|---|---|---|
| TK-5 | Tickets are read from `<vault>/tickets/*/ticket.md`; vault = `OZDASH_VAULT_PATH` or `~/Projects/work/vault`. The list updates on file changes (`fs.watch` recursive, 400 ms debounce; 5 s polling fallback). Files without frontmatter, id or a known status are skipped and listed as warnings on the board. | Vault is the source of truth. |
| TK-6 | Edits change only the touched lines in place: other keys, comments after values, CRLF, blank lines and other sections stay byte-for-byte. Missing keys are inserted in vault order. Every edit appends one Log line `- YYYY-MM-DD HH:MM: <text>` at the end of `## Log` (section added if missing). | PM sessions and humans edit the same files. |
| TK-7 | Every write is followed by one vault sync, run one at a time: `git add -- vault`, `git commit -m <msg> -- vault` (only when staged), `git pull --rebase --autostash`, `git push`. On pull failure: `git rebase --abort`, no push, show a warning (the change stays committed locally). Git runs with argument lists, `GIT_TERMINAL_PROMPT=0`, 60 s timeout. | Vault repo stays in sync with other machines and the PM. |
| TK-8 | Statuses: `parked | active | waiting | blocked | done | dropped`. A legacy `draft` reads as `parked`. Archived = `done` or `dropped`. | Lifecycle decided by Oleg. |

### Board

| ID | Requirement | Why |
|---|---|---|
| TK-9 | Columns: **Needs Oleg** (`blocked` or `needs_oleg: yes`), **Active**, **Waiting**. **Parked** and **Archive** are toggle side panels on the right (open/closed remembered; default Parked open, Archive closed). A parked ticket stays in Parked even with open questions. | Focus on work in progress. |
| TK-10 | Search (toolbar) matches `#id`, title and full file text, in columns and panels. A closed panel with matches shows anyway ("search matches"). | Find any ticket. |
| TK-11 | Sort everywhere: priority (P0 first, missing = P3), then `rank` (missing after ranked), then `updated` newest first, then id. | Stable, manual order. |
| TK-12 | Cards show icon, `#id`, read-only P-chip, title, Goal (3 lines), next step, waiting on, open-question count, updated; soft priority colors (P0 electric gold `#F5C451`, P1 rose `#EBA6C0`, P2 orchid `#C3A6F0`, P3 periwinkle `#93B4EE`, P4 slate `#9CA6B5`), text contrast WCAG AA. | Calm, readable board (not a traffic light). |
| TK-13 | Clicking any card or parked row opens the **ticket popup**: priority ▲/▼ (the only place to change it from the board), Goal with Show more / Show less, Edit, and actions (card: Park, Open session; parked row: Start, Archive). Archive rows have only Restore (no popup). | One place for ticket actions; no stray revive. |
| TK-14 | Priority ▲/▼ shows the new value at once and writes 1 s after the last click (one write, one sync, Log `Priority set to P<n> in OZdash`, `rank` cleared). ▲ stops at P1; ▼ from P0 goes to P1; ▼ stops at P4. | Few commits per change. |
| TK-15 | Drag a card to reorder it inside its priority group in one column only (not while searching, not in side panels). Drop writes ranks 10, 20, 30… for that group, one sync (`tickets: reorder P<n> (OZdash)`), no Log line, no `updated` change. | Manual order without noise. |
| TK-16 | Park button on every non-parked, non-archived card (-> `parked`, Log `Parked in OZdash`). | Quick pause. |
| TK-17 | "New task…" on an open card opens a project menu (PM project not listed), then the New Task dialog for that project with the ticket preselected as an OZ Tickets issue. | Start a child for a ticket. |

### Lifecycle

| ID | Event | From | To | Log line |
|---|---|---|---|---|
| TK-18 | New ticket (form) | – | `parked`, empty `pm_session`, no PM session | `Created in OZdash` |
| TK-19 | Start / Open session (no live PM session) | parked | `active`; creates task `ticket-<id>-<slug>` in the PM project with first message `/oz-pm <id>`, writes `pm_session` | `PM session <taskId> started in OZdash`, `Started (PM session opened from the OZdash board)` |
| TK-20 | Any session for a ticket: live PM session opened, PM session linked, child task (OZ Tickets, "New task…", MCP `create_task` with `ticket`) | not active/waiting/blocked | `active` | `Started (<reason>)` |
| TK-21 | Same events | active / waiting / blocked | unchanged (no write, no git) | – |
| TK-22 | Archive (parked row) | parked | `dropped` | `Archived from parked in OZdash` |
| TK-23 | Restore (archive row) | done / dropped | `parked` | `Restored to parked in OZdash` |
| TK-24 | A `pm_session` that points to an archived or deleted task counts as missing: Start creates a new PM session. | | | |

### New ticket, Edit ticket, Flash

| ID | Requirement | Why |
|---|---|---|
| TK-25 | New ticket form: Title (required, <= 200), Description (optional, goes under `## Goal`), Priority P1-P4 (default P3), ⚡ Flash toggle. Next id = highest folder/ticket id + 1; folder `<id>-<slug>` (slug `[a-z0-9-]`, <= 40). File from `vault/templates/ticket.md` (else a built-in copy). One sync `tickets: new #<id> (OZdash)`. | Create tickets without leaving the app. |
| TK-26 | Edit ticket = the same form, prefilled from the file, dialog 20% wider (`maxWidth: min(28.8rem, 100%)`). It edits title, Goal and priority in place (new priority clears `rank`), sets `updated`, Log `Edited in OZdash (<changed fields>)`, one sync. Folder is not renamed. No change = no write. | Fix a ticket fast. |
| TK-27 | Edit refuses when the file's title, Goal or priority changed on disk since the form opened ("Ticket #N changed on disk since the form was opened (…)"); nothing is written; the form stays open. Other changes (Log lines, other sections) are not a conflict. | Never overwrite the PM's new values. |
| TK-28 | Flash on = `priority: 0` (P0); the P1-P4 picker is dimmed. On create, the ticket starts at once (same path as Start, Log `Started (flash ticket)`) and OZdash opens the PM session. On edit, Flash only sets P0 (no start). | Urgent, short work. |
| TK-29 | P0 look: gold tint, stripe, soft glow, `⚡ P0` chip on cards, rows, popup and Ticket panel. Motion only with `motion-safe`. | Flash tickets stand out. |

### PM session agent

| ID | Requirement | Why |
|---|---|---|
| TK-30 | A PM session created by the board (Start, Open session, flash) uses the agent palette's `pm` row with auto-approve; fallback claude + opus (see 07). It starts in the global session mode (see 09). | Same agent setup every time. |

### Pixel icons

| ID | Requirement | Why |
|---|---|---|
| TK-31 | Each ticket shows `icon.svg` from its folder if it passes a strict check (only `svg`, `g`, `rect`, `path`; numeric/color/path values only; `viewBox="0 0 16 16"`; no text, comments, scripts, `href`, `style`, `url()`; <= 8 KB). Else a deterministic 8x8 sprite from the ticket id, colored by priority. Shown as `<img src="data:image/svg+xml,…">` pixelated: 32 px on cards and in the popup, 16 px in rows and the sidebar (24 px in the Ticket tab, see 04). | Fun, safe, recognizable tickets. |
| TK-32 | Main generates missing icons in the background, one at a time (open tickets first): `claude -p --model haiku --output-format text --no-session-persistence --strict-mcp-config --tools ""`, prompt on stdin, temp cwd, 60 s timeout. Invalid answer: one retry; still invalid: retry in 30 min, give up after 3 rounds. Saves with `wx` (never overwrites). Icons that finish close together get one sync `tickets: icons (OZdash)`. `OZDASH_TICKET_ICONS=off` turns it off. | No manual icon work. |

### OZ Tickets issue source and "no ticket"

| ID | Requirement | Why |
|---|---|---|
| TK-33 | New Task dialog > "Based on: Issue" lists **OZ Tickets** (provider id `oz-tickets`) in every project, no account. The list shows open tickets by priority; search also finds archived ones. | Start a child from a ticket in any repo. |
| TK-34 | Creating a task from an OZ ticket: the first prompt gets a ticket block (ticket file path, Goal, rules, and the report lines `STATUS:` / `QUESTION:` / `PR:` / `SUMMARY:`); terminal agents get it in the prompt, chat agents in the hidden context. After create: marker `createdBy: "oleg"`, a `child` Dependencies row `emdash: <taskId> (<task name>)`, Log line, sync; if the PM session runs, it gets a message about the new child. Problems never undo the task (toast). | PM learns about Oleg's own children. |
| TK-35 | A PM project task that no ticket points to shows a dashed `no ticket` marker in the sidebar and a **No ticket** header chip with "Link to ticket…" (tickets with no live PM session) and "Create ticket from this task" (that ticket is `active` with this task as `pm_session`). | Every PM session belongs to a ticket. |

## Settings / env switches

| Switch | Default | Effect |
|---|---|---|
| `OZDASH_PM_PROJECT_PATH` | `~/Projects/work` | which project is the PM project (read in preload; set it in the app's environment) |
| `OZDASH_VAULT_PATH` | `~/Projects/work/vault` | vault root (main process) |
| `OZDASH_TICKET_ICONS=off` (`0`, `false`, `no`) | on | no icon generation |
| memento `ozdash.tickets-board` | Parked open, Archive closed | side panel state |

## Contracts

### `ticket.md` frontmatter (flat YAML, this order)

```yaml
---
id: 12
title: "Add SCIM group sync"
status: parked        # parked | active | waiting | blocked | done | dropped (draft = parked)
priority: 3           # 0 = flash, 1 = highest … 4; missing = 3
rank: 20              # optional, manual order inside a priority group
needs_oleg: no
next_check:
pm_session:           # OZdash task id of the PM session
jira:
created: 2026-11-10
updated: 2026-11-10
---
```

Sections read: `## Goal`, `## Plan` (first `- [ ]` = next step), `## Dependencies` (table;
open rows = waiting on; child rows written by OZdash), `## Questions for Oleg` (`- [ ]` =
open), `## Log`.

Child row written by OZdash:
`| D<n> | child | <task name>: <first prompt line, <=80> | emdash: <taskId> (<task name>) | agent | working | <today> | |`

### IPC (main <-> renderer, `window.ozdash.*`)

`ozdash:list-tickets`, `ozdash:tickets-changed` (push), `ozdash:restore-ticket`,
`ozdash:archive-ticket`, `ozdash:open-ticket-session (folder, projectId, {flash?})`,
`ozdash:link-ticket-task`, `ozdash:create-ticket`, `ozdash:link-pm-session`,
`ozdash:set-ticket-priority`, `ozdash:reorder-tickets`, `ozdash:park-ticket`,
`ozdash:edit-ticket`, `ozdash:list-agent-presets`. Source of truth:
`OZDASH_TICKETS_CHANNELS` in `ozdash/api/tickets.ts`; bridge in `src/entry/preload.ts`.

### Sync commit messages

`tickets: new #<id> (OZdash)`, `tickets: start #<id> (OZdash)`, `tickets: edit #<id> (OZdash)`,
`tickets: park #<id> (OZdash)`, `tickets: restore #<id> from archive (OZdash)`,
`tickets: archive #<id> from parked (OZdash)`, `tickets: reorder P<n> (OZdash)`,
`tickets: link PM session <name> to #<id> (OZdash)`, `tickets: link OZdash task <name> to #<id>`,
`tickets: icons (OZdash)`.

### Skills contract (ai-toolkit)

- PM session first message: `/oz-pm <id>`. The PM writes `pm_session` = `$EMDASH_TASK_ID`.
- `/oz-ticket-link` writes a child row with `emdash: <task id>`; OZdash reads such refs
  (see 04, 06).

## Implementation map

Fork-owned (`src/core/features/ozdash/`):

| Layer | Files |
|---|---|
| pure rules | `api/tickets.ts` (types, channels, columns, sort, priority, lifecycle helpers), `api/priority-palette.ts`, `api/ticket-icon.ts`, `api/ticket-issues.ts` |
| main | `node/ticket-parser.ts`, `node/ticket-editor.ts`, `node/ticket-creator.ts`, `node/vault-sync.ts`, `node/tickets-service.ts`, `node/ticket-icons.ts`, `node/link-ticket-task.ts`, `api/node/oz-tickets-issue-provider.ts`; `src/main/host/ozdash-tickets.ts` (IPC, PM session launch, MCP hook) |
| renderer | `api/browser/ozdash-pm.ts`, `api/browser/tickets-store.ts`, `api/browser/oz-tickets-integration.ts`, `browser/tickets-board.tsx`, `new-ticket-form.tsx`, `no-ticket-chip.tsx`, `priority-control.tsx`, `expandable-text.tsx`, `ticket-icon.tsx`, `open-ticket-task.ts`, `contributions/browser.ts`, `contributions/mementos.ts` |
| sidebar | `workbench/browser/sidebar/ozdash-tickets-button.tsx`, `ozdash-pm-session-badge.tsx` |

Upstream hooks: `sidebar-store.ts` (`withPmProjectFirst`), `project-item.tsx`,
`active-project.tsx`, `main-panel.tsx`, `task-list.tsx`, `task-list-empty-state.tsx`,
`create-task-modal.tsx`, `use-create-task-state.ts`, `use-create-task-callback.ts`,
`issue-selector.tsx`, `use-connected-issue-providers.ts`, `integrations-provider.tsx`,
`issues/node/registry.ts`, `linked-issue.ts`, `window-scope.tsx`, `services.ts`,
`preload.ts`, `memento-catalog.ts`. Details: [upstream-touchpoints.md](upstream-touchpoints.md).

## Tests

All under `src/core/features/ozdash/` (vitest `node` project, temp dirs + fake git; the
real vault is never touched): `api/tickets.test.ts`, `api/priority-palette.test.ts`
(contrast AA), `api/ticket-icon.test.ts`, `api/ticket-issues.test.ts`,
`api/browser/tickets-store.test.ts`, `api/browser/ozdash-pm.test.ts`,
`api/browser/oz-tickets-integration.test.ts`, `api/node/oz-tickets-issue-provider.test.ts`,
`node/ticket-parser.test.ts`, `node/ticket-editor.test.ts`, `node/ticket-creator.test.ts`,
`node/vault-sync.test.ts` (real git + bare remote), `node/tickets-service.test.ts`,
`node/ticket-icons.test.ts`, `node/link-ticket-task.test.ts`,
`contributions/mementos.test.ts`. Upstream test mocks: `renderer/tests/archive-availability.test.ts`,
`renderer/tests/task-list-empty-state.test.ts`, `use-connected-issue-providers.test.ts`,
`integrations-provider.test.ts`. No browser tests for the board UI.

## Rebase notes

- `create-task-modal.tsx` is the main router: the exported `CreateTaskModal` is a small
  wrapper that returns `NewTicketForm` for the PM project, else `CreateTaskModalContent`
  (the upstream body). On conflict, take upstream's body, rename it to
  `CreateTaskModalContent`, and re-add the wrapper and the `initialIssue` prop.
- `active-project.tsx`: if upstream changes the pill tabs, re-add the `tickets` item first
  and keep `ticketsStore.boardSelected` as the selected state.
- If upstream changes the issue provider enum or registry, re-add `'oz-tickets'` and
  `extraProviders`.
- If upstream adds a new "create task" entry point, check it in the PM project: it must
  open the ticket form (it does when it goes through the task modal).
- `preload.ts`: the `ozdash` bridge is appended at the end; keep channel names equal to
  `OZDASH_TICKETS_CHANNELS`.
- Never run the app against the real vault while testing a rebase: use
  `OZDASH_VAULT_PATH` (+ `OZDASH_PM_PROJECT_PATH`) on a scratch copy in its own git repo,
  and `OZDASH_TICKET_ICONS=off`.

## Known gaps

- TK-20 also starts `done` / `dropped` tickets: `isStartedStatus` is false for them, so a
  child task created for an archived ticket (OZ Tickets search finds archived ones, or MCP
  `create_task` with that ticket) sets it back to `active`. The brief says the way out of
  the archive is Restore -> parked. Decide: keep, or start only from `parked`
  (`startTicketContent` in `node/ticket-editor.ts`, one line).
- OZ Tickets is always "connected", so the New Task dialog in every project now starts on
  "Based on: Issue" (before: PR or nothing in projects without an issue integration).
- If the board re-sorts while the Edit dialog is open, the card can remount and close the
  dialog (rare).
- Icon generation uses Oleg's Claude login and runs his Claude hooks; a few seconds per
  icon on first start.
