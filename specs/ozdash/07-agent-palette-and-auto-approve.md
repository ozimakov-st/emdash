# 07 Agent palette, models, effort and auto-approve

Oleg picks agents by name ("use review-gpt"), not by flags. Every session runs without
permission prompts ("never ask, just do"). New model ids must work the day they ship.

## Requirements

| ID | Requirement | Why |
|---|---|---|
| AP-1 | The agent palette is the markdown table in `<vault>/context/agents.md`: `| name | agent | model | effort | use for |`. It is read on every use (edits apply at once). Missing file = no presets. | One place to change agents. |
| AP-2 | A ticket's PM session (board Start, Open session, flash) uses the `pm` row, always with auto-approve. No file, no `pm` row, or an unknown agent: claude + opus, with a warning in the log. | Same PM setup every time. |
| AP-3 | The New Task dialog (also "New task…" on a ticket card) shows every row as a chip above the agent picker (agent icon, tooltip). One click sets agent + model + effort and saves auto-approve = on for that agent's terminal settings. It does not change the global session mode. | One click instead of four fields. |
| AP-4 | A chip for another agent switches the agent first, then applies model and effort. Picking a model by hand clears the chip's effort. A model the plugin does not list still shows in the model picker. | No lost choices. |
| AP-5 | Terminal agents auto-approve by default: the provider settings default `pty.autoApprove` is `true` (upstream: `false`), so the New Task switch starts on. A saved "off" for a provider stays off. | "Never ask, just do". |
| AP-6 | MCP `create_task` / `create_conversation` default `autoApprove: true` (see 02). | Same for PM-made sessions. |
| AP-7 | Any model id that is one plain CLI argument is accepted and passed through (see 02 MCP-5). Plugin model lists are suggestions only. | `gpt-6.1-sol` and friends. |
| AP-8 | Terminal reasoning effort: claude `--effort <low|medium|high|xhigh|max>`; codex `-c model_reasoning_effort=<minimal|low|medium|high|xhigh>`; cursor has no effort flag (dropped; put it in the model id, for example `cursor-grok-4.6-high`). Effort is stored in the pty conversation config (JSON, no migration) for the first and later conversations. | Deep reviews. |
| AP-9 | cursor in terminal takes `--model <id>`; its picker lists `auto`, `composer-2.5`, `cursor-grok-4.6-high`. codex lists `gpt-6.1-sol`. | Models Oleg uses. |
| AP-10 | cursor's launch prompt shows **Working**: cursor fires no start hook for the prompt on its command line, so the runtime marks it working itself (`startHookOnLaunchPrompt: false`); the stop hook ends the turn. | Status was stuck on Idle. |
| AP-11 | Final command lines (fresh session, auto-approve on): see table below. A test follows each preset from the MCP tool to these args. | Guard against stale package code (see 01 ID-7). |

| Agent | Command line |
|---|---|
| claude | `claude --session-id <id> --dangerously-skip-permissions --model opus --effort high "<prompt>"` |
| codex | `codex -c approval_policy=never -c sandbox_mode=danger-full-access --dangerously-bypass-hook-trust -m gpt-6.1-sol -c model_reasoning_effort=high "<prompt>"` |
| cursor | `cursor-agent -f --approve-mcps --model cursor-grok-4.6-high "<prompt>"` |

## Settings / env switches

| Item | Default |
|---|---|
| `<vault>/context/agents.md` | Oleg's palette (below) |
| Provider settings, terminal auto-approve | on (fork default) |
| `OZDASH_VAULT_PATH` | `~/Projects/work/vault` |

## Contracts

Palette file (also read by `emdash-oz presets` and `--preset`, via `$TASKS_HOME/context/agents.md`):

```markdown
| name | agent | model | effort | use for |
|---|---|---|---|---|
| pm | claude | opus | | PM sessions |
| architect | claude | opus | | main development |
| quick | claude | sonnet | | small, clear tasks |
| review-grok | cursor | cursor-grok-4.6-high | | code review, second opinion |
| review-gpt | codex | gpt-6.1-sol | high | code review, second opinion (deep) |
```

- `agent` = OZdash provider id, `model` = id the agent CLI accepts, `effort` optional.
- IPC `ozdash:list-agent-presets` -> `AgentPreset[]` (`name, provider, model, effort, useFor`).
- `StandardCommandSpec.effortFlag`: a flag ending in `=` inside a two-part flag
  (`-c model_reasoning_effort=`) becomes two args (`-c`, `model_reasoning_effort=high`).

## Implementation map

Fork-owned: `ozdash/api/agent-palette.ts` (parser, `pm` row, fallback),
`ozdash/node/agent-palette.ts` (read file, `resolvePmSessionLaunch`),
`ozdash/api/browser/agent-presets.ts`, `ozdash/browser/agent-preset-chips.tsx`,
`main/host/ozdash-tickets.ts` (`createPmSession`).

Upstream hooks:

| File | Hook |
|---|---|
| `conversations/api/provider-settings.ts` | `pty.autoApprove: true` |
| `primitives/conversations/api/conversation-config.ts` | pty `effort`; `buildPtyConversationConfig()` |
| `primitives/conversations/api/conversations.ts`, `primitives/tasks/api/task-config.ts` | `effort?` fields |
| `conversations/api/node/utils.ts`, `conversations/node/tui-conversation-provider.ts` | carry `effort` to the TUI start input |
| `tasks/node/operations/createTask.ts`, `conversations/node/createConversation.ts` | use `buildPtyConversationConfig` |
| `tasks/contributions/browser/task-config/initial-conversation-section.tsx` | effort / preset state, `applyPreset`, `<AgentPresetChips>`, unlisted model in picker |
| `tasks/contributions/browser/task-config/conversation-field.tsx`, `create-task-modal.tsx` | `showAgentPresets` |
| `tasks/browser/create-task-modal/build-create-task-params.ts` | pty `effort` |
| `packages/core/.../tui-agents/api/schemas.ts`, `command-context.ts` (new), `index.ts`, `node/runtime/runtime.ts` | `effort` in start input; `tuiPromptCommandContext()` |
| `packages/core/.../capabilities/prompt.ts`, `helpers/standard-command.ts` | `effort` in CommandContext; `effortFlag` |
| `packages/core/.../capabilities/hooks.ts`, `tui-agents/node/runtime/agent-state.ts` | `startHookOnLaunchPrompt` |
| `packages/plugins/src/agents/impl/claude/index.ts`, `codex/index.ts`, `cursor/index.ts` | effort capability + flags; models; cursor `modelFlag` and hook flag |

## Tests

- `packages/plugins/src/agents/impl/oz-palette-commands.test.ts` (args per agent)
- `src/main/host/oz-preset-command-lines.test.ts` (MCP -> stored config -> TUI start -> final args)
- `packages/core/.../helpers/standard-command.test.ts`, `tui-agents/node/runtime/agent-state.test.ts`,
  `packages/plugins/.../cursor/hooks.test.ts`
- `ozdash/api/agent-palette.test.ts`, `ozdash/node/agent-palette.test.ts`
- `tasks/browser/create-task-modal/build-create-task-params.test.ts`,
  `renderer/tests/initial-conversation-section.test.ts`,
  `conversations/node/provider-settings-service.db.test.ts` (main-db)
- `mcp/node/server/create-task-from-prompt.test.ts`, `register-tools.test.ts`
- ai-toolkit `tools/emdash-oz/test_emdash_oz.py` (presets, `--effort`, auto-approve default)

## Rebase notes

- `initial-conversation-section.tsx` is the riskiest file here (85 added lines inside
  upstream state hooks). On conflict, take upstream and re-add: the 3 state values
  (`effort`, `pendingPreset`, `presetSelection`), their resets on provider change,
  `setModel` clearing effort, `applyPreset`, the unlisted-model merge, and the chips render.
- If upstream adds its own effort support, prefer it and drop the fork fields, but keep the
  command lines in AP-11 (run `oz-preset-command-lines.test.ts`).
- If upstream changes `buildStandardCommand` or `CommandContext`, keep `effortFlag` and the
  two-part flag split.
- If upstream changes plugin model lists, keep the fork entries (or rely on AP-7).
- Always rebuild packages from a clean `dist/` (01 ID-7): plugin changes live in
  `packages/*` and are invisible to the app otherwise.

## Known gaps

- A chip click saves auto-approve = on for that provider for good (until Oleg flips the
  switch).
- OZdash no longer checks model ids; a typo fails inside the agent CLI after the task exists.
- The cursor model list in the plugin is short and hand-written.
