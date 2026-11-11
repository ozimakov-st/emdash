# 02 MCP server and the `emdash-oz` CLI

A PM session (Claude with `/oz-pm`) drives OZdash without the UI: it creates child tasks,
adds reviewer sessions, reads their status and sends them messages. It does this through
OZdash's built-in MCP server, usually via the `emdash-oz` CLI in ai-toolkit.

```
PM session --> emdash-oz create/converse/status/send --> POST http://127.0.0.1:8212/mcp --> OZdash
```

The server itself comes from Oleg's upstream PR #3086 (the 12 commits before the merge
`07fc11edd`). The fork adds tools and options on top.

## Requirements

| ID | Requirement | Why |
|---|---|---|
| MCP-1 | A streamable-HTTP MCP server listens on `127.0.0.1:8212/mcp`, started in the background boot phase. If 8212 is taken it tries the next ports (10 tries). `EMDASH_MCP_PORT` sets a fixed port (no scan). `EMDASH_MCP_SERVER=false` turns it off. | Fixed address for the CLI. |
| MCP-2 | Every request needs `Authorization: Bearer <token>`. The token is created on first start and kept (mode 0600) in `<userData>/mcp-token`. `Host` and `Origin` must be loopback. Stateless: one JSON-RPC request per POST, no `initialize`. | Only local agents with the token may create tasks. |
| MCP-3 | The MCP catalog's first entry is "Emdash" (`managed: true`): the drawer only asks which agents to sync to; URL and token are filled in on save and healed on start. Hidden for remote hosts. | Agents can register the server in one click. |
| MCP-4 | Tools: `list_projects`, `add_project`, `list_tasks`, `create_task`, `create_conversation`, `rename_task`, `archive_task`, `restore_task`, `delete_task`, `run_task_script`, `stop_task_script`, `send_task_message`, `get_task_status`. | The full PM toolset. |
| MCP-5 | `create_task` accepts any model id that is one plain CLI argument (`/^[\w.:\-[\]=,/]{1,100}$/`). It does not reject ids missing from the plugin's model list. | New models (for example `gpt-6.1-sol`) work at once. |
| MCP-6 | `create_task` takes `effort`. Terminal: claude `--effort <e>`, codex `-c model_reasoning_effort=<e>`, cursor: dropped (`effort: null` in the result). Chat: the agent's effort option (see 09). | Reviewers need high effort. |
| MCP-7 | `autoApprove` defaults to `true` (`MCP_DEFAULT_AUTO_APPROVE`) for `create_task` and `create_conversation`. Pass `false` to get permission prompts. | Oleg: "never ask, just do". |
| MCP-8 | `create_task` takes `ticket: { id (1-32 chars), title? (<=200), pmSessionId? (<=64) }`. OZdash stores it as a marker with `createdBy: "pm"`, before the task row is created. `create_task` result, `list_tasks` items and `get_task_status` return `ticket` (object or null). `delete_task` removes it. | The UI shows "Ticket #id"; muting and Focus view use `createdBy`. |
| MCP-9 | After `create_task` with a `ticket`, OZdash starts that ticket if it was not started (status -> `active`, Log `Started (child task <name> created via MCP create_task)`), fire and forget. | Any session for a ticket makes it active (see 03). |
| MCP-10 | `create_conversation { projectId, taskId, prompt, provider?, model?, effort?, autoApprove?, title?, chatUi? }` adds a session to an existing task, in its worktree. Same provider / model / effort / auto-approve rules as `create_task`. Default title `<Provider> (n)`. Errors: unknown or archived task, project not open in the app, provider that cannot take a launch prompt, title > 100 chars. | Reviewers next to the executor. |
| MCP-11 | `create_task` and `create_conversation` follow the global session mode (default OZ chat). `chatUi: true` forces chat, `chatUi: false` forces terminal. A provider without chat falls back to terminal and the result has a `note`. | One setting decides for UI and PM. |
| MCP-12 | `send_task_message { projectId, taskId, message, conversationId? }` sends to the given conversation, else the most recently active one. PTY: bracketed paste, then `\r` 100 ms later. ACP: `acp.sendPrompt` (queued while a turn runs). Refuses archived tasks and sessions that are not running; never starts or wakes an agent. Returns `{ conversationId, delivered: true }`. | PM follow-ups. |
| MCP-13 | `get_task_status { projectId, taskId, maxChars?, conversationId? }` is read-only. Returns `taskStatus`, `conversations[]` (`conversationId, title, provider, model, type, agentStatus, updatedAt`), `latestOutput` (`conversationId, text, lastAssistantMessage?`) of the given or newest conversation, `ticket`, and `note` when output could not be read. `maxChars` default 4000, max 20000. | PM reads `STATUS:` lines. |
| MCP-14 | `restore_task { projectId, taskId }` undoes `archive_task` with the UI's Restore. When the project is open it also provisions the workspace. Returns `{ taskId, restored: true, warning? }`. Error when not archived or not found. | PM can undo its own archive. |
| MCP-15 | `add_project { path, name? }` adds a local git repo like the Add Project dialog. Returns the existing project with `created: false` if there is one. Never runs `git init` and never trusts an unsafe repo. Returns `{ projectId, name, path, created }`. | PM can add a repo for a child. |
| MCP-16 | `delete_task` has the dialog's options (`deleteWorktree` default true, `deleteBranch` default false, `deleteConversations` default true) and a confirmation gate (`requiresConfirmation`) for uncommitted changes or unpushed commits; `confirm: true` only after the user agrees. | Safe deletes. |
| MCP-17 | Tool errors are short; internal errors are logged and the client gets "Emdash hit an internal error while handling <tool>". | No paths or SQL leak to agents. |
| MCP-18 | The `emdash-oz` CLI in `~/Projects/ai-toolkit/tools/emdash-oz/` must keep working: tool names, argument names and result fields below are a contract. | PM skills depend on it. |

## Settings / env switches

| Switch | Default | Effect |
|---|---|---|
| `EMDASH_MCP_SERVER=false` | on | no listener |
| `EMDASH_MCP_PORT=<n>` | 8212 + scan | fixed port |
| `OZDASH_MUTE_PM_TASKS` | on | see 05 (uses `createdBy`) |
| Settings > Interface > "New sessions start in" | OZ chat | chat or terminal for MCP sessions (see 09) |

## Contracts

### Wire

```http
POST http://127.0.0.1:8212/mcp
Authorization: Bearer <~/Library/Application Support/emdash-oz/mcp-token>
Content-Type: application/json
Accept: application/json, text/event-stream

{"jsonrpc":"2.0","id":1,"method":"tools/call",
 "params":{"name":"create_task","arguments":{"projectId":"p1","prompt":"..."}}}
```

Reply: `{"result":{"content":[{"type":"text","text":"<JSON>"}],"isError"?:true}}` (JSON,
or SSE `data:` lines). The CLI parses `content[0].text` as JSON.

### Tool results used by the CLI

| Tool | Result fields the CLI reads |
|---|---|
| `list_projects` | `[{ id, name }]` |
| `list_tasks` | `{ tasks: [{ id, name, status, updatedAt, isArchived, branchName, workspacePath, ticket }], truncated, note? }` (max 50) |
| `create_task` | `{ taskId, taskName, branchName, provider, model, effort, conversationType, autoApprove, workspacePath, ticket, warning?, note? }` |
| `create_conversation` | `{ conversationId, title, provider, model, effort, autoApprove, note? }` |
| `get_task_status` | `{ taskId, taskStatus, conversations, latestOutput, ticket, note? }` |
| `send_task_message` | `{ conversationId, delivered }` |
| `archive_task` / `restore_task` | `{ taskId, archived }` / `{ taskId, restored, warning? }` |
| `add_project` | `{ projectId, name, path, created }` |

`agentStatus` values: `idle | working | awaiting-input | completed | error`.

### Marker storage

Table `kv`, namespace `ozdash-task-ticket`, key = Emdash task id, value
`{ id, title?, pmSessionId?, createdBy?: "pm" | "oleg", savedAt }`. Old namespace
`ozdash-pm-task` (`managerTaskId`) is moved once at boot. Renderer reads it over IPC
`ozdash:list-task-tickets` -> `Record<taskId, { ticket, pmSession, muted }>`.

### CLI expectations (`emdash-oz`, ai-toolkit)

| Command | MCP call |
|---|---|
| `projects` | `list_projects` |
| `add-project PATH [--name]` | `add_project` |
| `tasks --project P [--include-archived]` | `list_projects` + `list_tasks` |
| `create --project P --prompt/--prompt-file [--preset] [--provider] [--model] [--effort] [--name] [--branch] [--base-branch] [--no-auto-approve] [--ticket ID --ticket-title T --pm-session ID]` | `create_task` (`autoApprove` always sent; `pmSessionId` defaults to `$EMDASH_TASK_ID`) |
| `converse TASK --prompt… [--preset…] [--title]` | `create_conversation` |
| `status TASK [--conversation ID] [--max-chars]` | `get_task_status`; parses the last `STATUS:` / `QUESTION:` / `PR:` / `SUMMARY:` lines |
| `send TASK --message… [--conversation ID]` | `send_task_message` |
| `archive TASK`, `restore TASK` | `archive_task`, `restore_task` |
| `presets` | none (reads `<vault>/context/agents.md`, see 07) |
| `wait --ticket ID`, `notify --ticket ID` | none (event files, see 06) |

Env for the CLI: `EMDASH_OZ_MCP_URL`, `EMDASH_OZ_TOKEN_FILE`, `EMDASH_OZ_EVENTS_DIR`,
`TASKS_HOME`, `EMDASH_TASK_ID`. Errors: exit 2; connection refused = "OZdash is not
running"; HTTP 401 = "Bad or missing token".

## Implementation map

New files (MCP server, in an upstream folder, see touchpoints table):
`src/core/features/mcp/node/server/` `create-mcp-server.ts`, `mcp-http-server.ts`,
`register-tools.ts`, `create-task-from-prompt.ts`, `create-conversation.ts`,
`task-conversation.ts`, `add-project.ts`, `attach-project.ts`, `resolve-from-branch.ts`,
`run-task-script.ts`, `workspace-runtime.ts`, `self-registration.ts`, `dependencies.ts`;
`src/core/primitives/mcp/api/managed.ts`; `src/main/bootstrap/boot/mcp-initial-conversation.ts`;
`src/core/features/conversations/node/conversation-runtime-target.ts`.

Fork-owned: `mcp/api/ozdash-task-ticket.ts` (schema, mute rule, texts),
`mcp/api/browser/ozdash-task-tickets.ts` (renderer cache), `mcp/node/server/ozdash-task-ticket-store.ts`.

Upstream hooks:

| File | Hook |
|---|---|
| `main/bootstrap/boot/phases/services.ts` | build `createEmdashMcpServer({...})` with `projectCreation`, `createConversation`, `startInitialConversation`, `onTicketTaskCreated`; `mcpServer` in the bundle; marker IPC |
| `main/bootstrap/boot/phases/background.ts` | `start()` + `refreshRegistration()` unless `EMDASH_MCP_SERVER=false` |
| `main/bootstrap/boot/wiring.ts`, `core/manifests/node/controllers.ts`, `features/mcp/node/wire-controller.ts` | `resolveSelfServer` for the managed entry |
| `features/mcp/browser/components/McpDrawer.tsx`, `McpServersList.tsx`, `mcpIcons.tsx`, `primitives/mcp/api/catalog.ts`, `index.ts`, `catalog/node/catalog-service.ts` | managed catalog entry |
| `features/tasks/api/node/name-generation/generateTaskName.ts` (moved), `tasks/node/controller.ts` | name generation importable by the server |
| `features/conversations/node/wire-controller.ts` | runtime-target code moved to `conversation-runtime-target.ts` |
| `features/conversations/node/createConversation.ts`, `primitives/conversations/api/*` | `effort` + shared `buildPtyConversationConfig` (see 07) |
| `apps/emdash-desktop/package.json`, `pnpm-lock.yaml` | `@modelcontextprotocol/sdk` |
| `AGENTS.md`, `agents/integrations/mcp.md` | docs |

## Tests

- `mcp/node/server/register-tools.test.ts` (real MCP client; tool list, create_conversation, restore, delete gate)
- `create-task-from-prompt.test.ts`, `task-conversation.test.ts`, `add-project.test.ts`,
  `mcp-http-server.test.ts`, `resolve-from-branch.test.ts`, `run-task-script.test.ts`,
  `self-registration.test.ts`, `ozdash-ticket-task-hook.test.ts`
- `mcp/api/ozdash-task-ticket.test.ts`, `ozdash-task-ticket-store.db.test.ts` (main-db)
- `mcp/node/wire-controller.test.ts`, `mcp/browser/mcpIcons.browser.test.ts` (browser)
- `main/bootstrap/boot/mcp-initial-conversation.test.ts`, `main/host/oz-preset-command-lines.test.ts`
- ai-toolkit: `tools/emdash-oz/test_emdash_oz.py` (fake MCP server)

## Rebase notes

- Highest risk: the server calls many upstream services (`taskService`,
  `createConversation`, runtimes, `acp.sendPrompt`, `tuiAgents.output`). After a rebase,
  typecheck first; most breaks show there.
- `mcp-initial-conversation.ts` starts PTY/ACP sessions with upstream conversation APIs.
  These changed before (commit `a44d9299e`). Compare with how the task UI starts a session.
- If upstream ships its own MCP server, compare tool names and arguments with the CLI
  table above; keep the fork's names or add aliases, so `emdash-oz` keeps working.
- If upstream moves `generateTaskName` or the conversation runtime-target code, drop the
  fork move and import from the new place.
- Re-check that `services.ts` still passes every dependency in `McpToolDependencies`
  (`dependencies.ts`).
- After the rebuild, run `emdash-oz projects` and `emdash-oz status <task>` against the app.

## Known gaps

- `agents/integrations/mcp.md` is out of date in 3 places: it says `create_conversation`
  adds "a terminal agent session", that "MCP still defaults to terminal mode unless
  `chatUi: true`", and that terminal auto-approve "uses the provider's saved terminal
  setting unless explicitly overridden". The code follows the session mode (default OZ
  chat) and defaults `autoApprove` to true.
- `scripts/oz/README.md` first paragraph still says the fork adds only "two more tools".
- The brief lists `run/stop task script` and `rename` as tools: they exist (from PR #3086),
  but `emdash-oz` has no commands for `rename_task`, `run_task_script`,
  `stop_task_script` or `delete_task`.
- `send_task_message` and `create_conversation` need the project open in OZdash (sessions
  live only while the app holds the project). By design; PM must handle the error.
