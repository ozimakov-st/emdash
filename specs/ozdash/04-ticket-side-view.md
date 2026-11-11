# 04 Ticket side view (Ticket tab) and ticket markers

When Oleg is inside a task that belongs to a ticket, he sees the ticket and all its
sessions without going back to the board.

```
task titlebar:  [Ticket #12 Add SCIM…]            … [Conversations] [Ticket]   <- toggle
right sidebar:  ┌ Ticket ────────────────────────┐
                │ [icon] #12  P2  3d             │
                │ Add SCIM group sync            │
                │ active · child task  [Edit][Board]
                │ Goal (3 lines) Show more       │
                │ Next step: …   2 open questions│
                ├ Sessions ──────────────────────┤
                │ PM  ticket-12-add-scim  working│
                │ scim-sync (api) · this task    │
                │    Executor · claude opus   ●  │
                │    Review · codex gpt-6.1-sol ●│
                │ Show archived (1)              │
                └────────────────────────────────┘
```

## Requirements

| ID | Requirement | Why |
|---|---|---|
| TV-1 | A task "has a ticket" when it is the ticket's PM session (`pm_session`), has a ticket marker (MCP or OZ Tickets), or is named by an `emdash: <task id>` ref in the ticket file (as `/oz-ticket-link` writes). | All three ways a task joins a ticket. |
| TV-2 | Such a task gets a **Ticket** toggle (lucide `Ticket` icon, tooltip `Ticket #<id>`) in the titlebar toggle group, after Conversations. It opens the right sidebar on the `ticket` tab. Open/closed and the tab are stored per task like Changes / Files / Conversations (`tasks.chrome` memento). A stored `ticket` tab on a task without a ticket shows "This task has no ticket.". | Same feel as the built-in tabs. |
| TV-3 | Top block: icon, `#id`, read-only P-chip, relative updated, title, status · "needs Oleg" · "child task", **Edit** (opens the Edit ticket dialog, see 03) and **Board** (opens the PM project on the Tickets board), Goal clamped to 3 lines with Show more, `Next step:`, `N open questions`. Priority tint and stripe (gold glow for P0). Live from the vault watcher. | The ticket in brief. |
| TV-4 | **Sessions**: the PM session first with a `PM` chip, then the ticket's other tasks in all open projects (not archived, no automation runs). Each row: agent icon, task name, `project · status word`, live status dot, last activity. The current task is highlighted and says "this task". | See the whole ticket's work. |
| TV-5 | Sort inside Sessions (after PM): needs attention (`input` level, `awaiting-input` or `error`) first, then `working`, then the rest; newest activity first in each group. Muted (PM-managed) tasks keep their status but get no amber highlight (see 05). | Problems first. |
| TV-6 | A task with 2+ conversations lists them under its row: `title · agent model` (or `agent (default model)` when no model was set), status word and dot. Click a task row = open the task; click a conversation = open the task with that conversation tab selected. | Executor and reviewers side by side. |
| TV-7 | "Show archived (n)" at the bottom (hidden when n = 0; state remembered in memento `ozdash.ticket-sessions`) lists archived tasks dimmed with an `archived` label and a **Restore** button (the sidebar's Restore). | Undo a PM's archive by hand. |
| TV-8 | A child task with a marker shows `Ticket #<id>` in its sidebar row (ClipboardList icon; tooltip `Ticket #<id>: <title> (PM session: <name>)`). | Child tasks are recognizable. |
| TV-9 | A child task with a marker shows a header chip `Ticket #<id>` + title (cut to 40 chars). Click opens the PM session task; disabled when that task does not exist. | One click to the PM. |

## Settings / env switches

| Item | Default |
|---|---|
| memento `ozdash.ticket-sessions` (Show archived) | off |
| `tasks.chrome` sidebar tab enum | `conversations | changes | files | ticket` |

## Contracts

- `SidebarTab = 'conversations' | 'changes' | 'files' | 'ticket'` (`tasks/api/browser/types.ts`).
- Ticket file ref format read for TV-1: `emdash: <task id>` (lowercase UUID) anywhere in
  the file text, normally in a Dependencies `child` row.
- Marker IPC: `ozdash:list-task-tickets` (see 02).

## Implementation map

Fork-owned:
- `ozdash/browser/ticket-panel.tsx` (top block), `ozdash/browser/ticket-sessions-panel.tsx`
  (Sessions), `ozdash/api/ticket-sessions.ts` (pick + sort, archived count, labels),
  `ozdash/contributions/browser.ts` (`OzdashTicketSidebarToggle`, `OzdashTicketPanel`),
  `ozdash/contributions/mementos.ts`.
- `tasks/browser/ozdash-ticket-chip.tsx` (TV-9), `workbench/browser/sidebar/ozdash-ticket-marker.tsx` (TV-8),
  `mcp/api/browser/ozdash-task-tickets.ts` (marker cache; `taskTicketMarkers()`).

Upstream hooks:

| File | Hook |
|---|---|
| `tasks/api/browser/types.ts` | `'ticket'` in `SidebarTab` |
| `tasks/contributions/mementos.ts` | `'ticket'` in the `sidebarTab` enum |
| `tasks/browser/view/task-sidebar.tsx` | `{activeTab === 'ticket' && <OzdashTicketPanel … />}` |
| `tasks/browser/task-titlebar.tsx` | `<OzdashTicketChip>`, `<OzdashNoTicketChip>` after the linked-issue badge; `<OzdashTicketSidebarToggle>` after Conversations |
| `workbench/browser/sidebar/task-item.tsx` | `<OzdashTicketMarker taskId>` |

## Tests

- `ozdash/api/ticket-sessions.test.ts` (file refs, marker + file selection across projects,
  PM first, archived excluded / counted, sort, labels incl. `(default model)`).
- `tasks/api/browser/stores/task-chrome-store.test.ts` (the `ticket` tab is stored and read back).
- `mcp/api/ozdash-task-ticket.test.ts` (chip and tooltip texts).
- No browser tests for the panel UI.

## Rebase notes

- If upstream adds a sidebar tab or changes `SidebarTab` / the `tasks.chrome` schema,
  re-add `'ticket'` in both places (a value missing from the enum resets the stored chrome).
- If upstream redesigns the titlebar toggle group, put the Ticket toggle last in that group.
- Conversation sub-rows open a tab with `paneLayout.open('conversation', …)`; if upstream
  renames the pane API, follow the command palette's "open conversation" code.
- The Sessions list reads live status from the same MobX stores as the left sidebar
  (`taskAgentStatus`, `taskAttentionLevel`); re-check those names after a rebase.

## Known gaps

- The brief says icons show at 16 or 32 px (even pixel scale). The Ticket tab shows the
  icon at 24 px (`ticket-panel.tsx`), a 1.5x scale.
- Only tasks in projects open in this window are listed (same scope as the left sidebar).
- Conversation sub-rows appear only for tasks whose conversations the renderer has loaded
  (tasks opened since start).
