# OZdash specs

OZdash is Oleg's personal fork of Emdash (upstream: `generalaction/emdash`, fork:
`ozimakov-st/emdash`, branch `oz/mcp-server`).

It is the desktop UI for Oleg's personal ticket manager:

```
vault (~/Projects/work/vault)          OZdash (this app)                 agents
  tickets/<id>-<slug>/ticket.md  <-->  Tickets board, Ticket tab   <-->  PM session (/oz-pm <id>)
  context/agents.md                    built-in MCP server :8212  <-->  child tasks in project repos
                                       ticket event files          <--   emdash-oz CLI (ai-toolkit)
```

These specs list every custom requirement, so the fork can be rebased onto the latest
upstream, or re-applied feature by feature, with confidence.

## Who it is for

- Oleg, as the only user. The fork is never released and never upstreamed (exception: the
  MCP tools offered in upstream PR #3086).
- Agents that work on OZdash: read the spec of the area you change, then
  [upstream-touchpoints.md](upstream-touchpoints.md) and [rebase.md](rebase.md).
- An agent that brings OZdash onto the latest upstream: follow
  [agent-runbook.md](agent-runbook.md).

## Principles

1. Personal fork. Oleg's decisions win over upstream defaults.
2. Fork code lives in fork-owned places:
   - `apps/emdash-desktop/src/core/features/ozdash/**`
   - files named `ozdash*` / `oz-*` (for example `features/mcp/**/ozdash*`,
     `main/host/ozdash-*.ts`, `workbench/browser/sidebar/ozdash-*.tsx`)
   - `scripts/oz/**`
   - this folder, `specs/ozdash/`
3. Upstream files get only small hooks: an import plus one or a few lines, marked with a
   comment `Fork (ozimakov-st)` or `OZdash:`. Example:
   ```ts
   useApplyUiFont(); // OZdash
   ```
4. Keep upstream code that the fork no longer uses (for example `update-section.tsx`, the
   feedback modal). Deleting it makes merges harder.
5. Every fork rule that can be pure logic is pure logic with unit tests
   (`ozdash/api/*.ts` + `*.test.ts`).

## Words

| Word | Meaning | Example |
|---|---|---|
| ticket | Oleg's work item: one folder in the vault | `vault/tickets/12-add-scim/ticket.md` |
| task | an OZdash (Emdash) task: a worktree + agent sessions | `ticket-12-add-scim` |
| session / conversation | one agent conversation inside a task (a tab) | `Claude (1)`, `Review` |
| PM session | the task that runs `/oz-pm <id>` for a ticket; its id is the ticket's `pm_session` | |
| PM project | the local project at `~/Projects/work`, shown first in the sidebar | |
| child task | a task that works for a ticket in a project repo | |
| PM-managed task | a child task that a PM session created over MCP (`createdBy: "pm"`) | |
| marker | the `ticket` record OZdash keeps per task (kv table) | `{ id: "12", pmSessionId, createdBy }` |

## Spec files

| File | Area |
|---|---|
| [01-identity-build.md](01-identity-build.md) | App name, ids, data dir, no auto-update, branding, signing, build script, secrets |
| [02-mcp-server-and-cli.md](02-mcp-server-and-cli.md) | Built-in MCP server, all tools, `emdash-oz` CLI contract |
| [03-pm-project-and-tickets.md](03-pm-project-and-tickets.md) | PM project, Tickets board, lifecycle, New / Edit ticket, flash, priority, icons, vault sync, OZ Tickets source, ⌥⌘B board shortcut, double-click to open / start |
| [04-ticket-side-view.md](04-ticket-side-view.md) | Ticket tab in task views (⌥⌘T), Sessions list, ticket chip and marker |
| [05-attention-and-notifications.md](05-attention-and-notifications.md) | Amber marks, Dock badge, chime + banner, muting PM-managed tasks |
| [06-pm-relay.md](06-pm-relay.md) | Child status changes reported to the PM (event files) |
| [07-agent-palette-and-auto-approve.md](07-agent-palette-and-auto-approve.md) | Presets, any model id, effort, auto-approve by default |
| [08-sidebar-and-chrome.md](08-sidebar-and-chrome.md) | Removed distractions, More group, PM rows, Focus view, Cmd+digit, table of all fork shortcuts |
| [09-oz-chat.md](09-oz-chat.md) | OZ chat renderer, session modes, chat without permission prompts |
| [10-ui-font.md](10-ui-font.md) | UI font setting (Inter / Geist / system) |
| [11-git-exec-reliability.md](11-git-exec-reliability.md) | Git commands always settle |
| [upstream-touchpoints.md](upstream-touchpoints.md) | Every upstream file the fork changes, with risk and how to re-apply |
| [rebase.md](rebase.md) | Step-by-step rebase, checks and manual smoke list |
| [agent-runbook.md](agent-runbook.md) | Instructions for an agent session that moves OZdash onto the latest upstream, builds, tests and hands over |

Each spec has: Requirements (numbered, testable), Settings / env switches, Contracts,
Implementation map, Tests, Rebase notes, Known gaps.

## Baseline

- Merge base with upstream: `592281113` (upstream `main`, 2026-11-02).
- Fork: 94 commits (93 without the merge), 273 files, +26656 / -392 lines.
- History: 12 MCP commits (Aug-Oct 2026), then a merge of upstream `main`
  (`07fc11edd`), then 81 `oz:` commits (Nov 2026).

## Related repos

- `~/Projects/ai-toolkit`: skills `oz-pm`, `oz-ticket-check`, `oz-ticket-link`, and the
  CLI `tools/emdash-oz/` (tests: `python3 -m unittest discover -s tools/emdash-oz -p 'test_*.py'`).
- `~/Projects/work`: the vault (`vault/tickets`, `vault/templates/ticket.md`,
  `vault/context/agents.md`).
- `scripts/oz/README.md`: the user-facing notes for each feature.
