# 05 Attention and notifications

Oleg must notice at once when a task he owns comes back to him (a question, an error, a
finished turn), and must not be disturbed by tasks that report to a PM session instead.

## Requirements

### Attention marks

| ID | Requirement | Why |
|---|---|---|
| AT-1 | Each conversation has an attention level from its agent status and its existing `seen` flag (set when Oleg views it; reset by new status): `awaiting-input` or `error`, not seen = **input** (strong); `completed` or `idle`, not seen = **done** (soft); `working` or seen = none. A task takes its strongest level (input wins). | One rule for every signal. |
| AT-2 | Sidebar task row with a level: amber BellRing icon before the name; background `bg-background-warning` + amber ring for input, `bg-background-warning/70` for done. No highlight on the open (active) row. | Visible in light and dark themes. |
| AT-3 | A collapsed project shows an amber pill with a bell and the count of its unpinned tasks that need attention. | See hidden work. |
| AT-4 | Dock badge = number of listed tasks that need attention (pinned included); 0 clears it. Renderer sends the count over `ozdash:attention-count`; main calls `app.dock.setBadge` (macOS) or `app.setBadgeCount`. | Notice from any app. |
| AT-5 | A restart, a session exit or a lost worker sets the status to `idle` but keeps the `seen` flag (upstream marked them seen). So an unseen wait survives a restart as a soft mark. | Marks were lost on every rebuild. |

### Chime and banner

| ID | Requirement | Why |
|---|---|---|
| AT-6 | The main process plays a chime with `afplay <file>` on a live transition into awaiting-input, error or completed. File = Settings > Notifications custom sound (default `~/Library/Application Support/emdash-oz/chime.wav`, `~/` expanded) if it exists, else `/System/Library/Sounds/Glass.aiff`. | A pleasant sound that works even when the renderer is busy or hidden. |
| AT-7 | At the same moment main shows a **silent** macOS banner ("waiting for input" / "hit an error" / "finished working"). Clicking it focuses OZdash and opens the task. It shows even when OZdash is focused. | Oleg asked for banner + chime together. |
| AT-8 | One chime per conversation and state. `working` re-arms it. Claude's `idle_prompt` about 60 s after a stop does not chime again. Chimes less than 1.5 s apart play once. A restart does not chime. Settings: notifications off = nothing; `sound` / `soundFocusMode` decide the chime; `osNotifications` decides the banner. | No noise. |
| AT-9 | The upstream renderer tone and upstream banner are off for `agent-*` notification kinds (routing policy); the in-app feed still records them. | Exactly one sound per transition. |

### Muting PM-managed tasks

| ID | Requirement | Why |
|---|---|---|
| AT-10 | A PM-managed task (marker `createdBy: "pm"`, set by MCP `create_task`) gives no chime, no banner, no amber row or bell, no Dock badge count and no project count. All its conversations (reviewers from `create_conversation` too) are muted with it. | It reports to its PM (see 06), not to Oleg. |
| AT-11 | Not muted: tasks without a marker (Oleg's own), tasks Oleg made from a ticket (`createdBy: "oleg"`), and PM sessions (`pmSessionId === taskId`). Old markers without `createdBy` count as PM-made when they have a `pmSessionId`. | Oleg's own work still notifies. |
| AT-12 | In the Ticket tab's Sessions list, muted tasks keep their live status but get no amber highlight. | Status without alarm. |

## Settings / env switches

| Switch | Default | Effect |
|---|---|---|
| `OZDASH_MUTE_PM_TASKS=off` | on | PM-managed tasks notify again |
| Settings > Notifications > custom sound | `~/Library/Application Support/emdash-oz/chime.wav` | chime file (upstream default: empty) |
| Settings > Notifications > enabled / sound / sound focus mode / OS notifications | upstream defaults | gate chime and banner |

## Contracts

- `isPmManagedTask(taskId, ticket)` and `isMutedPmTask(taskId, ticket, mutePmTasks)` in
  `mcp/api/ozdash-task-ticket.ts` are the one rule; the marker IPC returns `muted` per task.
- IPC `ozdash:attention-count` (renderer -> main, `send`, a number).
- `chime.wav` is created by `scripts/oz/build-mac.sh` (see 01).

## Implementation map

Fork-owned: `ozdash/api/attention.ts` (rule, row classes, badge watcher),
`ozdash/api/browser/attention.ts` (`taskAttentionLevel`, `startAttentionBadge`, mute),
`ozdash/api/attention-chime.ts` (chime decision), `main/host/ozdash-attention-chime.ts`
(afplay + banner), `main/host/ozdash-attention-badge.ts`,
`workbench/browser/sidebar/ozdash-attention.tsx` (icon, project count).

Upstream hooks:

| File | Hook |
|---|---|
| `conversations/node/reset-stale-tui-agent-statuses.ts`, `reset-stale-acp-agent-statuses.ts` | set only `agentStatus: 'idle'` |
| `main/core/agent-status/agent-status-service.ts` | `resetToIdle` keeps and emits the stored seen flag |
| `services/notifications/node/notification-service-instance.ts` | `routingPolicy`: `agent-*` -> no system banner, no sound |
| `services/notifications/contributions/settings.ts`, `settings/browser/sound-player.ts` | default custom sound path |
| `main/core/app/service.ts` | `~/` expansion for the sound file |
| `main/bootstrap/boot/phases/services.ts` | `registerOzdashAttentionBadge()`, `installOzdashAttentionChime(db, agentStatusService, appSettingsService, notificationService, taskTicketStore, log)` |
| `renderer/main.tsx` | `startAttentionBadge()` after the sidebar is ready |
| `entry/preload.ts` | `setAttentionCount` |
| `workbench/browser/sidebar/task-item.tsx`, `project-item.tsx` | icon, row class, project count |

## Tests

- `ozdash/api/attention.test.ts`, `attention-live-rows.test.ts` (from a real DB row to the level), `attention-chime.test.ts`
- `main/host/ozdash-attention-chime.test.ts` (one sound + one banner per state, muted, `~/`, Glass fallback)
- `conversations/node/agent-status-host-scope.db.test.ts` (main-db: boot reset keeps seen)
- `main/core/agent-status/agent-status-service.test.ts` (resetToIdle keeps seen)
- `mcp/api/ozdash-task-ticket.test.ts`, `mcp/node/server/ozdash-task-ticket-store.db.test.ts` (mute rule)

## Rebase notes

- AT-5 changes 3 upstream reset sites. If upstream adds another place that resets status
  to idle, keep the seen flag there too. Search:
  `grep -rn "agentStatusSeen: 1" apps/emdash-desktop/src`.
- If upstream changes the notification routing API, re-check that agent kinds still make
  no renderer sound and no upstream banner (else Oleg hears two sounds).
- The chime listens to `agentStatusService` `agent:event`. If upstream renames that event
  or its payload (`status`, `conversationId`, `taskId`), update `ozdash-attention-chime.ts`
  and `ozdash-pm-relay.ts` together.
- Settings default changes are values only; on conflict keep the fork value.

## Known gaps

- The Settings "Preview sound" button still uses the renderer player, not `afplay`.
- Old markers without `createdBy` that name a PM session are muted, so a few older
  Oleg-made tasks may be muted (AT-11, a guess by design).
- Claude's `idle_prompt` turns a finished turn into `awaiting-input` after about 60 s, so a
  soft mark becomes strong after a minute (no new chime).
- Activity badge removal (see 08) hides failed setup/push steps; they show only in the
  terminal drawer.
