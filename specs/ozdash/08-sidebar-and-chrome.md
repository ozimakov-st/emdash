# 08 Sidebar and chrome

A calm window: only what Oleg uses, his own tasks in front, PM-managed noise hidden,
and fast keyboard switching.

## Requirements

### Removed distractions

| ID | Requirement | Why |
|---|---|---|
| SB-1 | No "Give feedback": removed from the sidebar, the Help menu and the command palette; the Skills info box drops the "feedback modal" sentence. The `app.giveFeedback` command and the modal stay in code (unreachable). | Personal fork; nothing to report upstream from the UI. |
| SB-2 | The sidebar bottom bar is gone (it held Give feedback and the version / Update button). Updates stay in Settings > General. | Auto-update is off anyway (01). |
| SB-3 | Task toolbar: no Activity badge; "Open in" is hidden but still mounted, so Mod+O and the "Open in Editor" palette command work. The project page header keeps its visible "Open in". | Less toolbar noise. |
| SB-4 | Search, Automations and Settings sit in a collapsible **More** group at the bottom of the sidebar, collapsed by default; the state is remembered (memento `ozdash.sidebar`). Shortcuts (Cmd+K, Cmd+,) still work. | Rarely clicked items. |

### PM rows

| ID | Requirement | Why |
|---|---|---|
| SB-5 | A PM session row shows its ticket's pixel icon (else a Briefcase), a `#<id>` badge (tooltip `Ticket #<id>: <title>`), and a ticket state icon: Needs you, Active, Waiting, Parked, Archived. | Tickets at a glance. |
| SB-6 | A PM project task that no ticket points to shows a dashed `no ticket` marker (hidden while the list loads or the vault has an error). | See 03 TK-35. |

### Focus view

| ID | Requirement | Why |
|---|---|---|
| SB-7 | Focus view is on by default. The PM project always shows. Another project shows only when it has a direct task (not PM-managed, same rule as muting in 05) and then lists only those tasks. Empty projects and PM-only projects are hidden. | Oleg's own work in front. |
| SB-8 | The open task (and its project) always shows, even when Focus would hide it. | Never lose the current task. |
| SB-9 | An eye button in the Projects header switches Focus / "Show all projects and PM tasks" (remembered, memento `ozdash.sidebar-focus`). A footer, only when something is hidden, says for example "3 projects · 7 PM tasks hidden — Show all" and switches to show all. In show all, PM-managed rows are dimmed (60%). | Hidden, not lost. |
| SB-10 | Drag and drop in Focus view keeps hidden projects and tasks in their places. Search (Cmd+K) still finds everything. | Order is not broken by hiding. |

### Cmd+digit quick switch

| ID | Requirement | Why |
|---|---|---|
| SB-11 | Cmd+1 … Cmd+9, Cmd+0 open the first 10 task rows of the sidebar tree as shown (top to bottom). Pinned tasks and rows of collapsed projects are not counted. Commands `ozdash.quickSwitch1…10` (window scope). | Fast switching like browser tabs. |
| SB-12 | Holding Cmd alone for 150 ms shows a number chip on those rows (in place of time / diff / PR). Release, any other key or window blur hides it. | Know which number is which. |
| SB-13 | These shortcuts replace upstream "Open Tab 1…9" (`workbench.tab1…9` keep no keybinding; still in the palette) and View > Actual Size Cmd+0 (the item is custom and has no accelerator). | No double binding. |

## Settings / env switches

| Item | Default |
|---|---|
| memento `ozdash.sidebar` (`navOpen`) | false (More collapsed) |
| memento `ozdash.sidebar-focus` (`showAll`) | false (Focus on) |

## Contracts

- `SidebarStore.setFocusSource({ isOn, isPmManagedTask, selected })`, set in
  `renderer/main.tsx`; `SidebarStore.focus` is null when Focus is off.
- `mergeShownOrder(allIds, shownIdsInNewOrder)` keeps hidden ids in place.
- Command ids `ozdash.quickSwitch1` … `ozdash.quickSwitch10` (`Mod+1` … `Mod+9`, `Mod+0`).

All fork shortcuts (fixed bindings, window scope, defined in
`ozdash/contributions/commands.ts`):

| Chord | Command | Spec | Why this chord |
|---|---|---|---|
| ⌘1 … ⌘9, ⌘0 | `ozdash.quickSwitch1…10` | SB-11 | like browser tabs; upstream tab / zoom bindings removed (SB-13) |
| ⌥⌘B | `ozdash.openTicketsBoard` | 03 TK-36 | B = Board; ⌘⇧B is upstream's Open Browser (task scope) |
| ⌥⌘T | `ozdash.toggleTicketPanel` | 04 TV-10 | T = Ticket; ⌘⇧I is DevTools on Windows/Linux and close to ⌥⌘I (DevTools on macOS) |

Checked free on 2026-11-12: the app's keybinding registry (all `keybinding.fixed` /
`keybinding.settings` in `src/core`), the app menu (`main/host/menu.ts`: roles reload,
forceReload, toggleDevTools ⌥⌘I, zoom, fullscreen ⌃⌘F, hide ⌘H / ⌥⌘H, window menu),
macOS system shortcuts, and the terminal (xterm does not send ⌘ chords to the shell on
macOS). The catalog test `command-catalog.test.ts` fails on a same-scope clash.

## Implementation map

Fork-owned: `ozdash/api/sidebar-focus.ts`, `ozdash/api/browser/sidebar-focus.ts`,
`ozdash/api/quick-switch.ts`, `ozdash/contributions/commands.ts`,
`ozdash/contributions/mementos.ts`, `workbench/browser/sidebar/ozdash-nav-group.tsx`,
`ozdash-sidebar-focus.tsx`, `ozdash-quick-switch.tsx`, `ozdash-pm-session-badge.tsx`.

Upstream hooks:

| File | Hook |
|---|---|
| `workbench/browser/sidebar/left-sidebar.tsx` | `<OzdashNavGroup>` around 3 items; bottom bar removed; `useOzdashQuickSwitchHint()` |
| `workbench/browser/sidebar/sidebar-store.ts` | `setFocusSource`, `focus`, skip hidden rows; PM first |
| `workbench/browser/sidebar/sidebar-virtual-list.tsx` | `mergeShownOrder` on drag; `<OzdashFocusFooter>` |
| `workbench/browser/sidebar/projects-group-label.tsx` | `<OzdashFocusToggle>` |
| `workbench/browser/sidebar/task-item.tsx` | PM icon/badge, dim class, Cmd-digit badge |
| `workbench/browser/window-scope.tsx` | `...ozdashQuickSwitchImpl()` |
| `workbench/contributions/commands.ts` | tab index commands lose `Mod+<n>` |
| `workbench/contributions/palette.ts`, `main/host/menu.ts`, `skills/browser/components/skills-info-box.tsx` | Give feedback removed; resetZoom accelerator off |
| `tasks/browser/task-titlebar.tsx` | Activity badge removed; OpenInMenu in a `hidden` div |
| `manifests/browser/scope-catalog.ts`, `manifests/shared/command-catalog.ts`, `memento-catalog.ts` | register commands and mementos |
| `renderer/main.tsx` | `setFocusSource(ozdashSidebarFocusSource)` |

## Tests

- `ozdash/api/sidebar-focus.test.ts`, `ozdash/api/quick-switch.test.ts`,
  `ozdash/contributions/mementos.test.ts`
- `workbench/browser/sidebar/sidebar-store.test.ts` (Focus cases)
- No browser tests for the sidebar UI.

## Rebase notes

- `left-sidebar.tsx`, `task-item.tsx` and `sidebar-store.ts` change often upstream.
  Re-apply by intent: wrap the 3 nav items, drop the bottom bar, add the fork slots in the
  task row (attention icon, PM icon, badge, marker, Cmd-digit badge).
- If upstream rebinds Cmd+digit or Cmd+0 elsewhere (tabs, zoom, panes), remove that
  binding again; the fork owns Cmd+1…9 and Cmd+0. It also owns ⌥⌘B and ⌥⌘T (table in
  Contracts): if upstream takes one of them, move the fork command to a free chord.
- If upstream adds new items to the sidebar footer, decide: inside More, or removed.
- If upstream moves the "Open in" menu or Activity badge, keep Mod+O working.

## Known gaps

- A newly added project with no tasks is hidden in Focus view until it has a task (the
  footer shows "1 project hidden").
- Until ticket markers load (a moment after start), PM-managed tasks count as direct and
  show.
