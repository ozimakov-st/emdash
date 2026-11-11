# Upstream touchpoints

Every file the fork changes since the merge base `592281113`, generated from
`git diff --name-status -M 592281113..HEAD` and `git diff --numstat` (2026-11-10, HEAD
`49d298e52`).

- Total: 273 files, +26656 / -392 lines.
- **Fork-owned** (121 files): under `features/ozdash/`, `scripts/oz/`, or a new file named
  `ozdash*` / `oz-*`. Listed at the end, grouped by feature. They conflict only when an
  import they use moves.
- **Outside fork-owned paths** (152 files): the table below. Risk: **16 high, 45 med,
  91 low**.

`src/` = `apps/emdash-desktop/src/`. Feature numbers = spec files (`02` =
[02-mcp-server-and-cli.md](02-mcp-server-and-cli.md)).

Kind:

| Kind | Meaning |
|---|---|
| hook | a few added lines that call fork code (import + call / render / spread) |
| behavior | upstream logic or values changed |
| rename | upstream code moved to another file |
| delete | upstream UI removed |
| new | new file in an upstream folder (mostly the MCP server, upstream PR #3086) |
| test | upstream test changed, or new test in an upstream folder |
| asset / doc / deps | binary asset, docs, dependency manifest |

Risk:

| Risk | Meaning |
|---|---|
| high | central file that upstream edits often, or many fork lines inside upstream logic; expect conflicts |
| med | small edit in an active file, or a new file that uses many upstream APIs |
| low | one-liners, tests, assets, docs, append-only lists |

How to find all hooks quickly:

```sh
git grep -n -e "Fork (ozimakov-st)" -e "OZdash" -- apps packages ':!**/features/ozdash/**'
```

## Files outside fork-owned paths

| # | File | Git | Lines | Feature | Kind | Risk | How to re-apply |
|---|---|---|---|---|---|---|---|
| 1 | `AGENTS.md` | modified | 5+/1- | 02 | doc | low | Re-add the 3 lines on the MCP server and the 2 env vars. |
| 2 | `agents/integrations/mcp.md` | modified | 193+/12- | 02 | doc | med | Keep the upstream text; re-add the 'Emdash's own MCP server' section and the fork notes. |
| 3 | `apps/emdash-desktop/build/dmg-background.tiff` | modified | binary | 01 | asset | low | Take the fork file (or rerun scripts/oz/make-branding.sh). |
| 4 | `apps/emdash-desktop/package.json` | modified | 4+/0- | 02,09,10 | deps | med | Re-add 4 deps: @modelcontextprotocol/sdk, @fontsource-variable/geist, @fontsource-variable/geist-mono, solid-js. |
| 5 | `packages/core/src/runtimes/git/node/exec/git-exec.test.ts` | modified | 64+/2- | 11 | test | low | Keep the deadline tests. |
| 6 | `packages/core/src/runtimes/git/node/exec/git-exec.ts` | modified | 45+/1- | 11 | behavior | med | Wrap createBoundExec with withGitCommandTimeout (5 min, transfers exempt). |
| 7 | `packages/core/src/runtimes/tui-agents/api/command-context.ts` | added | 23+/0- | 07 | new | med | tuiPromptCommandContext(); must match what runtime.ts builds. |
| 8 | `packages/core/src/runtimes/tui-agents/api/index.ts` | modified | 1+/0- | 07 | hook | low | Export command-context. |
| 9 | `packages/core/src/runtimes/tui-agents/api/schemas.ts` | modified | 2+/0- | 07 | hook | low | Start input `effort` (nullable, optional). |
| 10 | `packages/core/src/runtimes/tui-agents/node/runtime/agent-state.test.ts` | modified | 29+/0- | 07 | test | low | Keep the cursor launch-prompt test. |
| 11 | `packages/core/src/runtimes/tui-agents/node/runtime/agent-state.ts` | modified | 3+/1- | 07 | behavior | low | Skip the 'start hook' shortcut when startHookOnLaunchPrompt === false. |
| 12 | `packages/core/src/runtimes/tui-agents/node/runtime/runtime.ts` | modified | 8+/10- | 07 | hook | med | buildPromptCommand(…, tuiPromptCommandContext(input, isResuming)). |
| 13 | `packages/core/src/services/agent-plugins/api/plugins/capabilities/hooks.ts` | modified | 6+/0- | 07 | hook | low | Optional `startHookOnLaunchPrompt`. |
| 14 | `packages/core/src/services/agent-plugins/api/plugins/capabilities/prompt.ts` | modified | 5+/0- | 07 | hook | low | CommandContext `effort?`. |
| 15 | `packages/core/src/services/agent-plugins/api/plugins/helpers/standard-command.test.ts` | modified | 27+/0- | 07 | test | low | Keep the effort tests. |
| 16 | `packages/core/src/services/agent-plugins/api/plugins/helpers/standard-command.ts` | modified | 14+/1- | 07 | behavior | med | `effortFlag` in the spec; appendFlagValue splits '-c key=' into two args. |
| 17 | `packages/core/src/services/exec/api/bound-exec.test.ts` | modified | 88+/1- | 11 | test | low | Keep the hang tests. |
| 18 | `packages/core/src/services/exec/api/bound-exec.ts` | modified | 16+/0- | 11 | behavior | med | After `exit`, wait 2 s, then destroy stdout/stderr so `close` fires. |
| 19 | `packages/plugins/src/agents/impl/claude/index.ts` | modified | 13+/0- | 07 | hook | med | effort capability (low…max) + effortFlag '--effort'. |
| 20 | `packages/plugins/src/agents/impl/codex/index.ts` | modified | 19+/0- | 07 | hook | med | Model gpt-6.1-sol; effort capability (minimal…xhigh) + effortFlag '-c model_reasoning_effort='. |
| 21 | `packages/plugins/src/agents/impl/cursor/hooks.test.ts` | modified | 2+/0- | 07 | test | low | Expect startHookOnLaunchPrompt. |
| 22 | `packages/plugins/src/agents/impl/cursor/index.ts` | modified | 20+/1- | 07,09 | behavior | med | Models (auto, composer-2.5, cursor-grok-4.6-high) + modelFlag '--model'; startHookOnLaunchPrompt false; ACP args ['-f','--approve-mcps','acp']. |
| 23 | `packages/plugins/src/agents/impl/native-acp.test.ts` | modified | 1+/1- | 09 | test | low | Expect the cursor ACP args. |
| 24 | `pnpm-lock.yaml` | modified | 22+/0- | 02,09,10 | deps | high | Never merge by hand: take upstream, then `pnpm install` with the fork's package.json. |
| 25 | `src/assets/images/emdash/emdash-dev.png` | modified | binary | 01 | asset | low | Take the fork file (make-branding.sh). |
| 26 | `src/assets/images/emdash/emdash.icns` | modified | binary | 01 | asset | low | Take the fork file (icon-app.swift + iconutil). |
| 27 | `src/assets/images/emdash/emdash.png` | modified | binary | 01 | asset | low | Take the fork file (icon-app.swift). |
| 28 | `src/assets/images/emdash/icon-light.png` | modified | binary | 01 | asset | low | Take the fork file (icon-light.swift). |
| 29 | `src/assets/images/mcp/emdash.svg` | added | 4+/0- | 02 | new | low | Copy the file. |
| 30 | `src/core/features/catalog/node/catalog-service.ts` | modified | 2+/1- | 02 | hook | low | Add `_meta` managed flag for managed catalog entries. |
| 31 | `src/core/features/conversations/api/browser/use-conversation-launch-settings.ts` | modified | 15+/6- | 09 | behavior | high | Chat vs terminal from interface.sessionMode instead of preferredConversationType; the toggle writes sessionMode. |
| 32 | `src/core/features/conversations/api/node/utils.ts` | modified | 1+/0- | 07 | hook | low | Map pty config `effort` onto Conversation. |
| 33 | `src/core/features/conversations/api/provider-settings.ts` | modified | 3+/1- | 07 | behavior | low | pty autoApprove default true. |
| 34 | `src/core/features/conversations/browser/acp/acp-chat-tab-provider.tsx` | modified | 14+/1- | 09 | hook | med | Tab menu + chatTabCommands; panel = <OzChatHost store fallback={<AcpChatPanel/>} />. |
| 35 | `src/core/features/conversations/browser/acp/acp-live-session.ts` | modified | 11+/1- | 09 | hook | med | Expose `agents` replica state (subagents, background tasks). |
| 36 | `src/core/features/conversations/browser/conversation-tab-item.tsx` | modified | 14+/0- | 09 | hook | low | Terminal tab menu + terminalTabCommands. |
| 37 | `src/core/features/conversations/node/agent-status-host-scope.db.test.ts` | modified | 31+/0- | 05 | test | low | Keep the 'boot reset keeps seen' tests. |
| 38 | `src/core/features/conversations/node/conversation-runtime-target.ts` | added | 107+/0- | 02 | new | med | New file split out of conversations wire-controller; re-check against upstream's version of that code. |
| 39 | `src/core/features/conversations/node/createConversation.ts` | modified | 19+/9- | 02,07,09 | behavior | high | ACP options via withAutoApproveMode; pty config via buildPtyConversationConfig (keeps model + effort). |
| 40 | `src/core/features/conversations/node/provider-settings-service.db.test.ts` | modified | 5+/4- | 07 | test | low | Expect autoApprove true. |
| 41 | `src/core/features/conversations/node/reset-stale-acp-agent-statuses.ts` | modified | 3+/1- | 05 | behavior | low | Set only agentStatus 'idle' (keep the seen flag). |
| 42 | `src/core/features/conversations/node/reset-stale-tui-agent-statuses.ts` | modified | 3+/1- | 05 | behavior | low | Set only agentStatus 'idle' (keep the seen flag). |
| 43 | `src/core/features/conversations/node/tui-conversation-provider.ts` | modified | 1+/0- | 07 | hook | low | Pass `effort` to the TUI start input. |
| 44 | `src/core/features/conversations/node/wire-controller.ts` | modified | 5+/101- | 02 | rename | high | Upstream code moved to conversation-runtime-target.ts. If upstream changed it, re-do the move on the new code. |
| 45 | `src/core/features/integrations/api/browser/use-connected-issue-providers.test.ts` | modified | 7+/0- | 03 | test | low | Mock the fork helper as a no-op. |
| 46 | `src/core/features/integrations/api/browser/use-connected-issue-providers.ts` | modified | 12+/4- | 03 | hook | low | OZ Tickets always usable and appended. |
| 47 | `src/core/features/integrations/browser/integrations-provider.test.ts` | modified | 7+/0- | 03 | test | low | Mock the fork helper as a no-op. |
| 48 | `src/core/features/integrations/contributions/browser/integrations-provider.tsx` | modified | 7+/5- | 03 | hook | low | Add OZ_TICKETS_INTEGRATION to mention icons and the name/icon map. |
| 49 | `src/core/features/issues/node/registry.ts` | modified | 4+/1- | 03 | hook | low | Optional `extraProviders` argument. |
| 50 | `src/core/features/mcp/browser/components/McpDrawer.tsx` | modified | 67+/35- | 02 | behavior | high | Managed entry: only ask which agents to sync to. Re-apply on upstream's drawer. |
| 51 | `src/core/features/mcp/browser/components/McpServersList.tsx` | modified | 5+/1- | 02 | hook | low | Hide the managed entry for remote hosts. |
| 52 | `src/core/features/mcp/browser/mcpIcons.browser.test.ts` | added | 23+/0- | 02 | test | low | Copy the file. |
| 53 | `src/core/features/mcp/browser/mcpIcons.tsx` | modified | 4+/1- | 02 | hook | low | Aliased glob `@/assets/images/mcp/*.svg`. |
| 54 | `src/core/features/mcp/node/server/add-project.test.ts` | added | 176+/0- | 02 | test | low | Copy the file. |
| 55 | `src/core/features/mcp/node/server/add-project.ts` | added | 115+/0- | 02 | new | med | Copy the file; re-check imports of upstream services (tasks, conversations, runtimes). |
| 56 | `src/core/features/mcp/node/server/attach-project.ts` | added | 102+/0- | 02 | new | med | Copy the file; re-check imports of upstream services (tasks, conversations, runtimes). |
| 57 | `src/core/features/mcp/node/server/create-conversation.ts` | added | 209+/0- | 02 | new | med | Copy the file; re-check imports of upstream services (tasks, conversations, runtimes). |
| 58 | `src/core/features/mcp/node/server/create-mcp-server.ts` | added | 53+/0- | 02 | new | med | Copy the file; re-check imports of upstream services (tasks, conversations, runtimes). |
| 59 | `src/core/features/mcp/node/server/create-task-from-prompt.test.ts` | added | 505+/0- | 02 | test | low | Copy the file. |
| 60 | `src/core/features/mcp/node/server/create-task-from-prompt.ts` | added | 493+/0- | 02 | new | med | Copy the file; re-check imports of upstream services (tasks, conversations, runtimes). |
| 61 | `src/core/features/mcp/node/server/dependencies.ts` | added | 74+/0- | 02 | new | med | Copy the file; re-check imports of upstream services (tasks, conversations, runtimes). |
| 62 | `src/core/features/mcp/node/server/mcp-http-server.test.ts` | added | 216+/0- | 02 | test | low | Copy the file. |
| 63 | `src/core/features/mcp/node/server/mcp-http-server.ts` | added | 297+/0- | 02 | new | med | Copy the file; re-check imports of upstream services (tasks, conversations, runtimes). |
| 64 | `src/core/features/mcp/node/server/register-tools.test.ts` | added | 1090+/0- | 02 | test | low | Copy the file. |
| 65 | `src/core/features/mcp/node/server/register-tools.ts` | added | 889+/0- | 02 | new | med | Copy the file; re-check imports of upstream services (tasks, conversations, runtimes). |
| 66 | `src/core/features/mcp/node/server/resolve-from-branch.test.ts` | added | 143+/0- | 02 | test | low | Copy the file. |
| 67 | `src/core/features/mcp/node/server/resolve-from-branch.ts` | added | 94+/0- | 02 | new | med | Copy the file; re-check imports of upstream services (tasks, conversations, runtimes). |
| 68 | `src/core/features/mcp/node/server/run-task-script.test.ts` | added | 125+/0- | 02 | test | low | Copy the file. |
| 69 | `src/core/features/mcp/node/server/run-task-script.ts` | added | 92+/0- | 02 | new | med | Copy the file; re-check imports of upstream services (tasks, conversations, runtimes). |
| 70 | `src/core/features/mcp/node/server/self-registration.test.ts` | added | 127+/0- | 02 | test | low | Copy the file. |
| 71 | `src/core/features/mcp/node/server/self-registration.ts` | added | 83+/0- | 02 | new | med | Copy the file; re-check imports of upstream services (tasks, conversations, runtimes). |
| 72 | `src/core/features/mcp/node/server/task-conversation.test.ts` | added | 464+/0- | 02 | test | low | Copy the file. |
| 73 | `src/core/features/mcp/node/server/task-conversation.ts` | added | 424+/0- | 02 | new | med | Copy the file; re-check imports of upstream services (tasks, conversations, runtimes). |
| 74 | `src/core/features/mcp/node/server/workspace-runtime.ts` | added | 209+/0- | 02 | new | med | Copy the file; re-check imports of upstream services (tasks, conversations, runtimes). |
| 75 | `src/core/features/mcp/node/wire-controller.test.ts` | modified | 93+/2- | 02 | test | low | Keep the managed-entry tests. |
| 76 | `src/core/features/mcp/node/wire-controller.ts` | modified | 49+/6- | 02 | hook | med | Inject `resolveSelfServer` for the managed `emdash` entry. |
| 77 | `src/core/features/projects/browser/components/main-panel/active-project.tsx` | modified | 27+/5- | 03 | hook | high | PM project: extra first pill tab 'Tickets' (TicketsBoard), selected by default via ticketsStore.boardSelected. |
| 78 | `src/core/features/projects/browser/components/main-panel/main-panel.tsx` | modified | 7+/1- | 03 | hook | low | `max-w-6xl` for the PM project. |
| 79 | `src/core/features/projects/browser/components/task-view/task-list-empty-state.tsx` | modified | 22+/3- | 03 | hook | med | PM project: one action 'New Ticket'. |
| 80 | `src/core/features/projects/browser/components/task-view/task-list.tsx` | modified | 11+/3- | 03 | hook | low | Button label 'New Ticket' in the PM project. |
| 81 | `src/core/features/settings/browser/pages/interface-settings-page.tsx` | modified | 10+/0- | 09,10 | hook | low | Sections 'Font' (UiFontSettingsCard) and 'Agent sessions' (SessionModeSettingsCard). |
| 82 | `src/core/features/settings/browser/search/settings-search.ts` | modified | 14+/0- | 09,10 | hook | low | 2 search entries: ui-font, session-mode. |
| 83 | `src/core/features/settings/browser/sound-player.ts` | modified | 1+/1- | 05 | behavior | low | Same default customSoundPath. |
| 84 | `src/core/features/skills/browser/components/skills-info-box.tsx` | modified | 2+/2- | 08 | delete | low | Drop the 'feedback modal' sentence. |
| 85 | `src/core/features/tasks/api/browser/stores/task-chrome-store.test.ts` | modified | 15+/0- | 04 | test | low | Keep the 'ticket' tab test. |
| 86 | `src/core/features/tasks/api/browser/types.ts` | modified | 2+/1- | 04 | hook | low | SidebarTab + 'ticket'. |
| 87 | `src/core/features/tasks/api/node/name-generation/generateTaskName.test.ts` | renamed | 0+/0- | 02 | rename | low | Move with the file above. |
| 88 | `src/core/features/tasks/api/node/name-generation/generateTaskName.ts` | renamed | 0+/0- | 02 | rename | med | Moved from tasks/node/name-generation/ so the MCP server may import it. If upstream changed it, move the new version. |
| 89 | `src/core/features/tasks/browser/components/issue-selector/issue-selector.tsx` | modified | 6+/1- | 03 | hook | low | Provider list wrapped in withOzTicketsProvider. |
| 90 | `src/core/features/tasks/browser/create-task-modal/build-create-task-params.test.ts` | modified | 24+/0- | 07,09 | test | low | Keep the 2 fork tests. |
| 91 | `src/core/features/tasks/browser/create-task-modal/build-create-task-params.ts` | modified | 18+/1- | 07,09 | hook | med | pty: pass effort; acp: presetToAcpOptions when a chip was used. |
| 92 | `src/core/features/tasks/browser/create-task-modal/create-task-modal.tsx` | modified | 28+/9- | 03,07 | hook | high | Split into wrapper + content: PM project shows NewTicketForm; `initialIssue` prop; `<ConversationField showAgentPresets />`. |
| 93 | `src/core/features/tasks/browser/create-task-modal/use-create-task-callback.ts` | modified | 19+/2- | 03 | hook | med | prepareOzTicketTask before createTask, linkOzTicketTask after. |
| 94 | `src/core/features/tasks/browser/create-task-modal/use-create-task-state.ts` | modified | 6+/3- | 03 | hook | low | Optional `initialIssue` (starts on 'issue'). |
| 95 | `src/core/features/tasks/browser/task-titlebar.tsx` | modified | 20+/9- | 04,08 | hook | high | Ticket chip + No-ticket chip after the linked-issue badge; Activity badge removed; OpenInMenu wrapped in `hidden` div; Ticket sidebar toggle after Conversations. |
| 96 | `src/core/features/tasks/browser/view/task-sidebar.tsx` | modified | 3+/0- | 04 | hook | low | Render OzdashTicketPanel for the 'ticket' tab. |
| 97 | `src/core/features/tasks/contributions/browser/task-config/conversation-field.tsx` | modified | 4+/0- | 07 | hook | low | Pass `showAgentPresets` through. |
| 98 | `src/core/features/tasks/contributions/browser/task-config/initial-conversation-section.tsx` | modified | 85+/3- | 07,09 | behavior | high | effort / presetSelection / applyPreset state; model list shows unknown preset model; AgentPresetChips above the agent picker. |
| 99 | `src/core/features/tasks/contributions/mementos.ts` | modified | 2+/1- | 04 | hook | low | tasks.chrome sidebarTab enum + 'ticket'. |
| 100 | `src/core/features/tasks/node/controller.ts` | modified | 1+/1- | 02 | hook | low | Import generateTaskName from the new path. |
| 101 | `src/core/features/tasks/node/operations/createTask.ts` | modified | 19+/9- | 07,09 | behavior | high | Same two changes as createConversation.ts, in prepareCreateTask. |
| 102 | `src/core/features/workbench/browser/home-view.tsx` | modified | 1+/0- | 01 | hook | low | Pass `accentColor` (emerald) to the logo. |
| 103 | `src/core/features/workbench/browser/sidebar/left-sidebar.tsx` | modified | 33+/44- | 08 | behavior | high | Wrap Search/Automations/Settings in OzdashNavGroup; remove the bottom bar (feedback + UpdateSection); call useOzdashQuickSwitchHint(). |
| 104 | `src/core/features/workbench/browser/sidebar/project-item.tsx` | modified | 34+/6- | 03,05,08 | hook | high | PM project: Briefcase icon, 'PM' badge, muted name, 'New ticket' labels, Tickets button; OzdashProjectAttentionCount. |
| 105 | `src/core/features/workbench/browser/sidebar/projects-group-label.tsx` | modified | 2+/0- | 08 | hook | low | Add <OzdashFocusToggle />. |
| 106 | `src/core/features/workbench/browser/sidebar/sidebar-store.test.ts` | modified | 50+/0- | 08 | test | low | Keep the Focus cases. |
| 107 | `src/core/features/workbench/browser/sidebar/sidebar-store.ts` | modified | 42+/3- | 03,08 | hook | high | orderedProjects ends with withPmProjectFirst(); focus source + `focus` computed; skip hidden projects/tasks in rows. |
| 108 | `src/core/features/workbench/browser/sidebar/sidebar-virtual-list.tsx` | modified | 15+/3- | 08 | hook | med | Drag reorder uses mergeShownOrder; render OzdashFocusFooter. |
| 109 | `src/core/features/workbench/browser/sidebar/task-item.tsx` | modified | 30+/4- | 03,04,05,08 | hook | high | Attention row class + icon; PM session icon/badge; ticket marker; PM-managed dim; Cmd-digit badge replaces trailing slot while Cmd is held. |
| 110 | `src/core/features/workbench/browser/window-scope.tsx` | modified | 10+/0- | 03,08 | hook | med | `presentation` of app.newTask = 'New Ticket' in the PM project; spread ozdashQuickSwitchImpl(). |
| 111 | `src/core/features/workbench/contributions/commands.ts` | modified | 2+/1- | 08 | behavior | low | Remove `keybinding: Mod+<n>` from tab index commands. |
| 112 | `src/core/features/workbench/contributions/palette.ts` | modified | 1+/2- | 08 | delete | low | Remove the Give Feedback palette item. |
| 113 | `src/core/features/workbench/contributions/settings.ts` | modified | 6+/0- | 09,10 | hook | low | interface schema + defaults: uiFont, sessionMode (with .catch). |
| 114 | `src/core/manifests/browser/scope-catalog.ts` | modified | 3+/1- | 08 | hook | low | windowScope + OZDASH_COMMAND_DEFS. |
| 115 | `src/core/manifests/node/controllers.ts` | modified | 7+/1- | 02 | hook | low | `mcpSelfServer` in the controller context; pass resolveSelfServer. |
| 116 | `src/core/manifests/shared/command-catalog.ts` | modified | 2+/0- | 08 | hook | low | COMMAND_CATALOG + OZDASH_COMMAND_DEFS. |
| 117 | `src/core/manifests/shared/memento-catalog.ts` | modified | 12+/0- | 03,04,08,09 | hook | low | Register 5 ozdash mementos. |
| 118 | `src/core/primitives/app-identity/api/app-identity.ts` | modified | 13+/6- | 01 | behavior | med | Set stable values: com.emdash.oz, OZdash, emdash-oz, EmdashOZ, emdash-oz-dev, ozdash; add AUTO_UPDATE_DISABLED = true. |
| 119 | `src/core/primitives/app-identity/browser/emdash-logo.tsx` | modified | 17+/9- | 01 | behavior | med | Replace wordmark paths with `python3 scripts/oz/ozdash-wordmark.py --paths`; keep `accentColor` prop. |
| 120 | `src/core/primitives/app-identity/browser/emdash-shimmer-logo.tsx` | modified | 8+/4- | 01 | behavior | med | Same wordmark paths and `accentColor` as emdash-logo.tsx. |
| 121 | `src/core/primitives/app-settings/api/app-settings.ts` | modified | 4+/0- | 09,10 | hook | low | InterfaceSettings: uiFont, sessionMode. |
| 122 | `src/core/primitives/conversations/api/conversation-config.ts` | modified | 23+/0- | 07 | hook | med | pty config `effort`; new buildPtyConversationConfig(). |
| 123 | `src/core/primitives/conversations/api/conversations.ts` | modified | 4+/0- | 07 | hook | low | `effort?` on Conversation and CreateConversationParams. |
| 124 | `src/core/primitives/linked-issues/api/linked-issue.ts` | modified | 2+/0- | 03 | hook | low | Add 'oz-tickets' to the provider enum. |
| 125 | `src/core/primitives/mcp/api/catalog.ts` | modified | 14+/0- | 02 | hook | low | First catalog entry `emdash`, `managed: true`. |
| 126 | `src/core/primitives/mcp/api/index.ts` | modified | 1+/0- | 02 | hook | low | `export * from './managed'`. |
| 127 | `src/core/primitives/mcp/api/managed.ts` | added | 42+/0- | 02 | new | low | Copy the file. |
| 128 | `src/core/primitives/tasks/api/task-config.ts` | modified | 2+/0- | 07 | hook | low | initialConversation `effort` (optional). |
| 129 | `src/core/services/notifications/contributions/settings.ts` | modified | 1+/1- | 05 | behavior | low | Default customSoundPath = ~/Library/Application Support/emdash-oz/chime.wav. |
| 130 | `src/core/services/notifications/node/notification-service-instance.ts` | modified | 7+/0- | 05 | behavior | med | routingPolicy: `agent-*` kinds get no system banner and no sound (main plays them). |
| 131 | `src/entry/preload.ts` | modified | 34+/0- | 03,04,05,07 | hook | med | Append one `contextBridge.exposeInMainWorld('ozdash', {...})` block at the end (+ `homedir` import). Keep channel names in sync with ozdash/api/tickets.ts. |
| 132 | `src/main/bootstrap/boot/mcp-initial-conversation.test.ts` | added | 109+/0- | 02 | test | med | Update with the adapter. |
| 133 | `src/main/bootstrap/boot/mcp-initial-conversation.ts` | added | 84+/0- | 02 | new | high | Adapter to start a PTY/ACP session; it calls upstream conversation APIs that change often. Re-check against current APIs. |
| 134 | `src/main/bootstrap/boot/phases/background.ts` | modified | 10+/0- | 02 | hook | low | Start the MCP server unless EMDASH_MCP_SERVER=false. |
| 135 | `src/main/bootstrap/boot/phases/services.ts` | modified | 114+/2- | 02,03,04,05,06 | hook | high | One fork block after the session hygiene sweep (MCP server, ticket markers IPC, tickets, relay, badge, chime) + OZ Tickets issue provider + `mcpServer` in the bundle. Re-add as one block; re-check every dependency name. |
| 136 | `src/main/bootstrap/boot/phases/updater.ts` | modified | 3+/0- | 01 | hook | low | Early `return` when AUTO_UPDATE_DISABLED. |
| 137 | `src/main/bootstrap/boot/wiring.ts` | modified | 1+/0- | 02 | hook | low | `mcpSelfServer: services.mcpServer`. |
| 138 | `src/main/core/agent-status/agent-status-service.test.ts` | modified | 14+/0- | 05 | test | low | Keep the fork test. |
| 139 | `src/main/core/agent-status/agent-status-service.ts` | modified | 8+/3- | 05 | behavior | med | resetToIdle: keep seen; return agentStatusSeen and emit the stored value. |
| 140 | `src/main/core/app/service.ts` | modified | 3+/1- | 05 | hook | low | Expand '~/' in the sound file path. |
| 141 | `src/main/host/menu.ts` | modified | 4+/6- | 01,08 | hook | med | `${app.name}` in Copy installation info; remove 'Give Feedback'; resetZoom `registerAccelerator: false`. |
| 142 | `src/main/host/recovery/recovery-window.ts` | modified | 3+/2- | 01 | hook | low | Skip updater init when AUTO_UPDATE_DISABLED; title 'OZdash Recovery'. |
| 143 | `src/main/host/recovery/recovery.html` | modified | 3+/3- | 01 | behavior | low | Text says OZdash. |
| 144 | `src/main/host/secrets/encrypted-app-secrets-store.db.test.ts` | modified | 16+/0- | 01 | test | low | Keep the 'undecryptable = missing' test. |
| 145 | `src/main/host/secrets/encrypted-app-secrets-store.ts` | modified | 8+/1- | 01 | behavior | low | Wrap decryptString in try/catch, return null. |
| 146 | `src/renderer/app/welcome.tsx` | modified | 2+/1- | 01 | hook | low | Logo alt = PRODUCT_NAME. |
| 147 | `src/renderer/index.html` | modified | 19+/11- | 01 | behavior | med | Title OZdash; boot splash wordmark (ozdash-wordmark.py --paths), 'OZdash is taking longer…', 'Restart OZdash'. |
| 148 | `src/renderer/lib/providers/theme-provider.tsx` | modified | 2+/0- | 10 | hook | low | Call useApplyUiFont(). |
| 149 | `src/renderer/main.tsx` | modified | 5+/0- | 05,08 | hook | med | setFocusSource(ozdashSidebarFocusSource); startAttentionBadge() after sidebar init. |
| 150 | `src/renderer/tests/archive-availability.test.ts` | modified | 2+/0- | 03 | test | low | Mock needs getProjectStore. |
| 151 | `src/renderer/tests/initial-conversation-section.test.ts` | modified | 17+/10- | 07,09 | test | med | Expectations for auto-approve on and the session mode. |
| 152 | `src/renderer/tests/task-list-empty-state.test.ts` | modified | 2+/0- | 03 | test | low | Mock needs getProjectStore. |

## Fork-owned files, grouped by feature

`contributions/browser.ts` (barrel) and `contributions/mementos.ts` serve several features; they are listed under 03.

### 01 Identity, build, branding (10 files)

| File | Lines |
|---|---|
| `scripts/oz/README.md` | 129+/0- |
| `scripts/oz/build-mac.sh` | 40+/0- |
| `scripts/oz/dmg-background.py` | 44+/0- |
| `scripts/oz/icon-app.swift` | 30+/0- |
| `scripts/oz/icon-dev.swift` | 28+/0- |
| `scripts/oz/icon-light.swift` | 14+/0- |
| `scripts/oz/make-branding.sh` | 29+/0- |
| `scripts/oz/make-signing-cert.sh` | 28+/0- |
| `scripts/oz/ozdash-wordmark.py` | 80+/0- |
| `scripts/oz/ozdash-wordmark.svg` | 9+/0- |

### 02 MCP server: ticket markers (6 files)

| File | Lines |
|---|---|
| `src/core/features/mcp/api/browser/ozdash-task-tickets.ts` | 63+/0- |
| `src/core/features/mcp/api/ozdash-task-ticket.test.ts` | 105+/0- |
| `src/core/features/mcp/api/ozdash-task-ticket.ts` | 119+/0- |
| `src/core/features/mcp/node/server/ozdash-task-ticket-store.db.test.ts` | 115+/0- |
| `src/core/features/mcp/node/server/ozdash-task-ticket-store.ts` | 167+/0- |
| `src/core/features/mcp/node/server/ozdash-ticket-task-hook.test.ts` | 64+/0- |

### 03 PM project and tickets (42 files)

| File | Lines |
|---|---|
| `src/core/features/ozdash/api/browser/oz-tickets-integration.test.ts` | 129+/0- |
| `src/core/features/ozdash/api/browser/oz-tickets-integration.ts` | 104+/0- |
| `src/core/features/ozdash/api/browser/ozdash-pm.test.ts` | 100+/0- |
| `src/core/features/ozdash/api/browser/ozdash-pm.ts` | 87+/0- |
| `src/core/features/ozdash/api/browser/tickets-store.test.ts` | 202+/0- |
| `src/core/features/ozdash/api/browser/tickets-store.ts` | 310+/0- |
| `src/core/features/ozdash/api/node/oz-tickets-issue-provider.test.ts` | 83+/0- |
| `src/core/features/ozdash/api/node/oz-tickets-issue-provider.ts` | 106+/0- |
| `src/core/features/ozdash/api/priority-palette.test.ts` | 61+/0- |
| `src/core/features/ozdash/api/priority-palette.ts` | 127+/0- |
| `src/core/features/ozdash/api/ticket-icon.test.ts` | 122+/0- |
| `src/core/features/ozdash/api/ticket-icon.ts` | 205+/0- |
| `src/core/features/ozdash/api/ticket-issues.test.ts` | 242+/0- |
| `src/core/features/ozdash/api/ticket-issues.ts` | 207+/0- |
| `src/core/features/ozdash/api/tickets.test.ts` | 349+/0- |
| `src/core/features/ozdash/api/tickets.ts` | 433+/0- |
| `src/core/features/ozdash/browser/expandable-text.tsx` | 46+/0- |
| `src/core/features/ozdash/browser/new-ticket-form.tsx` | 397+/0- |
| `src/core/features/ozdash/browser/no-ticket-chip.tsx` | 114+/0- |
| `src/core/features/ozdash/browser/open-ticket-task.ts` | 20+/0- |
| `src/core/features/ozdash/browser/priority-control.tsx` | 107+/0- |
| `src/core/features/ozdash/browser/ticket-icon.tsx` | 61+/0- |
| `src/core/features/ozdash/browser/tickets-board.tsx` | 965+/0- |
| `src/core/features/ozdash/contributions/browser.ts` | 11+/0- |
| `src/core/features/ozdash/contributions/mementos.test.ts` | 85+/0- |
| `src/core/features/ozdash/contributions/mementos.ts` | 131+/0- |
| `src/core/features/ozdash/node/link-ticket-task.test.ts` | 187+/0- |
| `src/core/features/ozdash/node/link-ticket-task.ts` | 109+/0- |
| `src/core/features/ozdash/node/ticket-creator.test.ts` | 319+/0- |
| `src/core/features/ozdash/node/ticket-creator.ts` | 231+/0- |
| `src/core/features/ozdash/node/ticket-editor.test.ts` | 339+/0- |
| `src/core/features/ozdash/node/ticket-editor.ts` | 351+/0- |
| `src/core/features/ozdash/node/ticket-icons.test.ts` | 232+/0- |
| `src/core/features/ozdash/node/ticket-icons.ts` | 395+/0- |
| `src/core/features/ozdash/node/ticket-parser.test.ts` | 150+/0- |
| `src/core/features/ozdash/node/ticket-parser.ts` | 191+/0- |
| `src/core/features/ozdash/node/tickets-service.test.ts` | 847+/0- |
| `src/core/features/ozdash/node/tickets-service.ts` | 700+/0- |
| `src/core/features/ozdash/node/vault-sync.test.ts` | 150+/0- |
| `src/core/features/ozdash/node/vault-sync.ts` | 117+/0- |
| `src/core/features/workbench/browser/sidebar/ozdash-tickets-button.tsx` | 33+/0- |
| `src/main/host/ozdash-tickets.ts` | 335+/0- |

### 04 Ticket side view (6 files)

| File | Lines |
|---|---|
| `src/core/features/ozdash/api/ticket-sessions.test.ts` | 231+/0- |
| `src/core/features/ozdash/api/ticket-sessions.ts` | 183+/0- |
| `src/core/features/ozdash/browser/ticket-panel.tsx` | 197+/0- |
| `src/core/features/ozdash/browser/ticket-sessions-panel.tsx` | 267+/0- |
| `src/core/features/tasks/browser/ozdash-ticket-chip.tsx` | 39+/0- |
| `src/core/features/workbench/browser/sidebar/ozdash-ticket-marker.tsx` | 28+/0- |

### 05 Attention and notifications (10 files)

| File | Lines |
|---|---|
| `src/core/features/ozdash/api/attention-chime.test.ts` | 152+/0- |
| `src/core/features/ozdash/api/attention-chime.ts` | 106+/0- |
| `src/core/features/ozdash/api/attention-live-rows.test.ts` | 97+/0- |
| `src/core/features/ozdash/api/attention.test.ts` | 99+/0- |
| `src/core/features/ozdash/api/attention.ts` | 83+/0- |
| `src/core/features/ozdash/api/browser/attention.ts` | 84+/0- |
| `src/core/features/workbench/browser/sidebar/ozdash-attention.tsx` | 64+/0- |
| `src/main/host/ozdash-attention-badge.ts` | 19+/0- |
| `src/main/host/ozdash-attention-chime.test.ts` | 113+/0- |
| `src/main/host/ozdash-attention-chime.ts` | 171+/0- |

### 06 PM relay (4 files)

| File | Lines |
|---|---|
| `src/core/features/ozdash/api/pm-relay.test.ts` | 304+/0- |
| `src/core/features/ozdash/api/pm-relay.ts` | 278+/0- |
| `src/main/host/ozdash-pm-relay.test.ts` | 143+/0- |
| `src/main/host/ozdash-pm-relay.ts` | 192+/0- |

### 07 Agent palette (8 files)

| File | Lines |
|---|---|
| `packages/plugins/src/agents/impl/oz-palette-commands.test.ts` | 85+/0- |
| `src/core/features/ozdash/api/agent-palette.test.ts` | 81+/0- |
| `src/core/features/ozdash/api/agent-palette.ts` | 107+/0- |
| `src/core/features/ozdash/api/browser/agent-presets.ts` | 21+/0- |
| `src/core/features/ozdash/browser/agent-preset-chips.tsx` | 75+/0- |
| `src/core/features/ozdash/node/agent-palette.test.ts` | 55+/0- |
| `src/core/features/ozdash/node/agent-palette.ts` | 54+/0- |
| `src/main/host/oz-preset-command-lines.test.ts` | 260+/0- |

### 08 Sidebar and chrome (10 files)

| File | Lines |
|---|---|
| `src/core/features/ozdash/api/browser/sidebar-focus.ts` | 48+/0- |
| `src/core/features/ozdash/api/quick-switch.test.ts` | 41+/0- |
| `src/core/features/ozdash/api/quick-switch.ts` | 32+/0- |
| `src/core/features/ozdash/api/sidebar-focus.test.ts` | 99+/0- |
| `src/core/features/ozdash/api/sidebar-focus.ts` | 79+/0- |
| `src/core/features/ozdash/contributions/commands.ts` | 28+/0- |
| `src/core/features/workbench/browser/sidebar/ozdash-nav-group.tsx` | 27+/0- |
| `src/core/features/workbench/browser/sidebar/ozdash-pm-session-badge.tsx` | 78+/0- |
| `src/core/features/workbench/browser/sidebar/ozdash-quick-switch.tsx` | 103+/0- |
| `src/core/features/workbench/browser/sidebar/ozdash-sidebar-focus.tsx` | 58+/0- |

### 09 OZ chat (22 files)

| File | Lines |
|---|---|
| `src/core/features/ozdash/api/chat/acp-launch-options.test.ts` | 127+/0- |
| `src/core/features/ozdash/api/chat/acp-launch-options.ts` | 187+/0- |
| `src/core/features/ozdash/api/chat/inline-diff.test.ts` | 33+/0- |
| `src/core/features/ozdash/api/chat/inline-diff.ts` | 75+/0- |
| `src/core/features/ozdash/api/chat/line-chunker.test.ts` | 52+/0- |
| `src/core/features/ozdash/api/chat/line-chunker.ts` | 84+/0- |
| `src/core/features/ozdash/api/chat/session-mode.test.ts` | 50+/0- |
| `src/core/features/ozdash/api/chat/session-mode.ts` | 87+/0- |
| `src/core/features/ozdash/api/chat/tool-summary.test.ts` | 119+/0- |
| `src/core/features/ozdash/api/chat/tool-summary.ts` | 203+/0- |
| `src/core/features/ozdash/api/chat/transcript-view.test.ts` | 111+/0- |
| `src/core/features/ozdash/api/chat/transcript-view.ts` | 193+/0- |
| `src/core/features/ozdash/browser/chat/chat-store.ts` | 64+/0- |
| `src/core/features/ozdash/browser/chat/chat-view.ts` | 152+/0- |
| `src/core/features/ozdash/browser/chat/oz-chat-host.tsx` | 20+/0- |
| `src/core/features/ozdash/browser/chat/oz-chat-panel.tsx` | 302+/0- |
| `src/core/features/ozdash/browser/chat/oz-chat.css` | 691+/0- |
| `src/core/features/ozdash/browser/chat/oz-composer.tsx` | 253+/0- |
| `src/core/features/ozdash/browser/chat/oz-markdown.tsx` | 82+/0- |
| `src/core/features/ozdash/browser/chat/oz-turn.tsx` | 445+/0- |
| `src/core/features/ozdash/browser/chat/session-mode-settings.tsx` | 49+/0- |
| `src/core/features/ozdash/browser/chat/use-chat-snapshot.ts` | 77+/0- |

### 10 UI font (3 files)

| File | Lines |
|---|---|
| `src/core/features/ozdash/api/ui-font.test.ts` | 58+/0- |
| `src/core/features/ozdash/api/ui-font.ts` | 42+/0- |
| `src/core/features/ozdash/browser/ui-font.tsx` | 62+/0- |

