# 09 OZ chat (default session mode)

New agent sessions start in **OZ chat**: a calm, Conductor-like chat view on top of the
existing ACP (chat) transport. It must show background work (subagents, background
shells) and never ask for permissions.

```
session mode (Settings)      transport   view
OZ chat (default)            acp         OZ chat renderer (fork)
Emdash chat                  acp         stock chat-ui renderer
Terminal                     pty         xterm
```

A conversation's transport is fixed when it is created. The view of an ACP conversation
can change at any time.

## Requirements

### Modes

| ID | Requirement | Why |
|---|---|---|
| OC-1 | Setting Settings > Interface > Agent sessions > **New sessions start in**: OZ chat (default) / Emdash chat / Terminal, stored as `interface.sessionMode`. It replaces upstream `preferredConversationType` for the New Task and New Conversation dialogs (the old key stays, unused). The dialog's chat/terminal toggle writes `sessionMode`. | One switch for all new sessions. |
| OC-2 | A provider without ACP support falls back to terminal. | No dead sessions. |
| OC-3 | Chat tab menu: "Show as OZ chat" / "Show as Emdash chat" (saved per conversation, memento `ozdash.chat-view`), and "New <agent> session in Terminal". Terminal tab menu: "New <agent> session in OZ chat / Emdash chat". A mode switch on a live session starts a new conversation in the same task. | Switch per tab. |
| OC-4 | MCP `create_task`, `create_conversation` and the board's PM sessions follow the global mode; `chatUi: false` forces terminal, `chatUi: true` forces chat (see 02). Chat sessions start headless. | PM and children use the same default. |
| OC-5 | Agent palette chips do not change the global mode; in chat mode the preset's model and effort become ACP options (matched to the agent's cached option list when known, else the raw id). | Chips used to switch everything to terminal. |

### No permission prompts in chat

| ID | Requirement | Why |
|---|---|---|
| OC-6 | Every new ACP session gets the no-prompt mode unless a mode was already chosen: claude `mode = bypassPermissions`, codex `mode = agent-full-access`. cursor's ACP server is spawned as `cursor-agent -f --approve-mcps acp`. | "Never ask, just do". |
| OC-7 | A permission request that still arrives while the OZ chat tab is open is answered with the "allow" option. | Nothing blocks a turn. |

### Look and behavior

| ID | Requirement | Why |
|---|---|---|
| OC-8 | Warm near-black dark theme, light text, Geist (UI) + Geist Mono (code), centered column (~760 px). User messages in a right-aligned bubble; assistant text full width with no card. | Calm reading, like Conductor. |
| OC-9 | When a turn is done, the steps between the user message and the answer collapse into one row ("3 tool calls, 2 messages"). A single tool row = icon + label + monospace pill, expandable to command and output, inline diff, or a subagent's prompt, tools and result. Thinking is collapsed. Task notifications are system rows. | Answers first, details on demand. |
| OC-10 | Status line above the composer: "Waiting for subagent <name> 2m 54s", background shells, "Working". The composer stays usable while background work runs (send or queue). | Background agents are a core workflow. |
| OC-11 | Text streams in line by line with a fade (off with reduced motion). Auto-scroll stops when Oleg scrolls up. | Smooth reading. |
| OC-12 | No horizontal scrolling: rows truncate; code blocks and diffs wrap. | Narrow panes. |
| OC-13 | Under each answer: time, copy, changed-file chips (`file +6 -6`). | Context at a glance. |
| OC-14 | Composer: send / stop, attach, and one chip menu (for example "Opus 5.5 · High") holding model, effort, mode and other options. No "Next unread" button, no turn minimap. | Simple composer. |
| OC-15 | Status, attention, chime, PM relay, `get_task_status` and `send_task_message` work for chat sessions (they read the shared agent status service and ACP state). | Same signals in every mode. |

## Settings / env switches

| Item | Default |
|---|---|
| `interface.sessionMode` | `oz-chat` (`.catch` to default for unknown values) |
| memento `ozdash.chat-view` | per conversation: OZ chat unless set to Emdash chat |

## Contracts

- `SESSION_MODES = ['oz-chat', 'emdash-chat', 'terminal']` (`ozdash/api/chat/session-mode.ts`).
- ACP option values: claude `mode: bypassPermissions`; codex `mode: agent-full-access`;
  preset effort -> claude `effort`, codex `reasoning_effort` (category `thought_level`).
- `AcpLiveSession.agents` exposes the ACP `agents` state (subagents, background tasks).

## Implementation map

Fork-owned: `ozdash/api/chat/` (`session-mode.ts`, `acp-launch-options.ts`,
`line-chunker.ts`, `tool-summary.ts`, `transcript-view.ts`, `inline-diff.ts`);
`ozdash/browser/chat/` (`oz-chat-host.tsx`, `oz-chat-panel.tsx`, `oz-turn.tsx`,
`oz-composer.tsx`, `oz-markdown.tsx`, `chat-store.ts`, `chat-view.ts`,
`use-chat-snapshot.ts`, `session-mode-settings.tsx`, `oz-chat.css`).

Upstream hooks:

| File | Hook |
|---|---|
| `conversations/api/browser/use-conversation-launch-settings.ts` | read/write `interface.sessionMode` instead of `preferredConversationType` |
| `conversations/browser/acp/acp-chat-tab-provider.tsx` | `chatTabCommands` in the tab menu; panel = `<OzChatHost … fallback={<AcpChatPanel />}>` |
| `conversations/browser/conversation-tab-item.tsx` | `terminalTabCommands` |
| `conversations/browser/acp/acp-live-session.ts` | `agents` replica state |
| `conversations/node/createConversation.ts`, `tasks/node/operations/createTask.ts` | `withAutoApproveMode(provider, options)` for ACP |
| `tasks/browser/create-task-modal/build-create-task-params.ts` | `presetToAcpOptions` in chat mode |
| `packages/plugins/src/agents/impl/cursor/index.ts` | ACP args `['-f', '--approve-mcps', 'acp']` |
| `settings/browser/pages/interface-settings-page.tsx`, `settings-search.ts`, `workbench/contributions/settings.ts`, `primitives/app-settings/api/app-settings.ts` | the setting |
| `apps/emdash-desktop/package.json` | `solid-js`, `@fontsource-variable/geist-mono` |
| `mcp/node/server/create-task-from-prompt.ts`, `create-conversation.ts` | `resolveMcpTransport` |

## Tests

- `ozdash/api/chat/session-mode.test.ts`, `acp-launch-options.test.ts`,
  `line-chunker.test.ts`, `tool-summary.test.ts`, `transcript-view.test.ts`, `inline-diff.test.ts`
- `tasks/browser/create-task-modal/build-create-task-params.test.ts` (chip -> ACP options)
- `renderer/tests/initial-conversation-section.test.ts`
- `packages/plugins/src/agents/impl/native-acp.test.ts` (cursor args)
- `mcp/node/server/register-tools.test.ts`, `create-task-from-prompt.test.ts` (mode for MCP)
- No browser tests for the renderer; check by hand.

## Rebase notes

- The OZ chat renderer reads upstream chat state (`AcpChatStore`, chat-ui `ChatState`,
  transcript turn item types). These change often. After a rebase: typecheck, then open a
  chat session and check tool rows, subagents, thinking and the status line.
- Trap: chat transport events. If upstream renames ACP state keys (`state`, `agents`,
  `config`, `terminals`) or turn item kinds (`execute-tool-call`, `spawn-subagent-tool-call`,
  `notification`, …), OZ chat shows empty or "unknown" rows without a type error. Compare
  `ozdash/api/chat/tool-summary.ts` and `transcript-view.ts` with the upstream models in
  `packages/core/src/runtimes/acp/api/models/`.
- If upstream changes `preferredConversationType` handling, keep the fork rule: the dialogs
  and MCP read `interface.sessionMode`.
- If upstream adds its own ACP permission auto-mode, prefer it, but keep OC-6 behavior.

## Known gaps

- Colors differ slightly from the brief: brief `#141110` background / `#eae8e6` text;
  code dark theme `--oz-bg: #151211`, `--oz-fg: #ece9e6` (`oz-chat.css`). There is also a
  light theme the brief does not mention.
- Preset model ids (`opus`, `gpt-6.1-sol`) are matched to the agent's chat options only
  after OZdash has seen one chat session of that agent; before that the raw id is sent and
  an unknown id is skipped (the agent's default model runs).
- Turn time is shown only for turns the view saw running (ACP history has no timestamps).
- `app-settings.ts` comment points to `core/features/ozdash/chat/api/session-mode.ts`; the
  file is `core/features/ozdash/api/chat/session-mode.ts`.
- Not checked live: cursor `-f` before `acp`; slash commands such as `/oz-pm 5` through
  claude's ACP adapter.
