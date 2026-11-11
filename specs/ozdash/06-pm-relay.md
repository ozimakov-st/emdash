# 06 PM relay

A ticket's PM session must learn when one of the ticket's child sessions comes back
(question, error, finished), without polling every child and without Oleg in the loop.

```
child conversation: working -> awaiting-input (holds 20 s)
        |
        v  OZdash main (agent:event)
~/Library/Application Support/emdash-oz/ticket-events/12.jsonl   <- one JSON line
        |
        v
PM session: emdash-oz wait --ticket 12   (prints the line, moves 12.cursor)
```

## Requirements

| ID | Requirement | Why |
|---|---|---|
| RL-1 | Main listens to `agentStatusService` `agent:event`. A conversation entering `awaiting-input`, `completed` or `error` that holds for 20 s is relayed once. `working` re-arms it. The same state again, or Claude's `idle_prompt` after a stop, is ignored. A change inside 20 s restarts the wait with the new state. | Short permission prompts that get answered at once do not reach the PM. |
| RL-2 | The ticket of a task = its marker's ticket id, else the ticket whose file has `emdash: <task id>`. The PM session = marker `pmSessionId`, else the ticket's `pm_session`. Events from the PM session itself are skipped. | Covers MCP children and `/oz-ticket-link` children. |
| RL-3 | Mode `file` (default): append one JSON line per transition to `<userData>/ticket-events/<ticket id>.jsonl` (folder created; ticket id must match `^[\w-]{1,64}$`). No live PM session is needed. Nothing is typed into the PM chat. | The PM reads events when it is ready; no half-typed input is sent. |
| RL-4 | Mode `type`: type `[OZdash] Ticket #<id> · <task> (<project>) · <conversation> is now <status>. Run: emdash-oz status <taskId> --conversation <conversationId>` into the PM session (like `send_task_message`), only if the PM task exists and is not archived. While any PM conversation is `working` the line waits (5 s tick); waiting lines of one conversation are replaced by the newest; several go out as one message. Send failure is logged and dropped. | The old behavior, kept as an option. |
| RL-5 | Mode `off`: nothing. | Escape hatch. |
| RL-6 | Muted (PM-managed) tasks are still relayed. Muting is only about Oleg's signals (see 05). | The PM must hear them. |

## Settings / env switches

| Switch | Values | Default |
|---|---|---|
| `OZDASH_PM_RELAY` | `file`, `type`, `off` (`0`, `false`, `no` = off) | `file` |

## Contracts

### Event line (file mode), written by OZdash

```json
{"ts":"2026-11-10T18:02:11.000Z","ticket":"12","taskId":"7f…","taskName":"scim-sync",
 "projectId":"p3","projectName":"api","conversationId":"c9…","conversationTitle":"Review",
 "provider":"codex","status":"awaiting-input",
 "hint":"emdash-oz status 7f… --conversation c9…"}
```

`status` is one of `awaiting-input | completed | error`.

### Lines written by the CLI (`emdash-oz notify`)

```json
{"ts":"…","ticket":"12","status":"message","message":"Need the API key name",
 "taskName":"scim-sync","taskId":"<$EMDASH_TASK_ID or null>"}
```

### Reader (`emdash-oz wait --ticket ID [--timeout 540] [--json]`)

- Keeps a byte offset in `<ticket>.cursor` next to the `.jsonl` file; prints only complete
  new lines and moves the cursor past them; a file smaller than the cursor starts over.
- Polls every 2 s; on timeout prints `timeout` (`[]` with `--json`), exit 0.
- `EMDASH_OZ_EVENTS_DIR` overrides the folder (default
  `~/Library/Application Support/emdash-oz/ticket-events`).
- `wait` and `notify` do not need the app.

OZdash must keep: folder name `ticket-events`, file name `<ticket id>.jsonl`, one JSON
object per line, append-only, the field names above.

## Implementation map

Fork-owned: `ozdash/api/pm-relay.ts` (rule, modes, event and message text, queue),
`main/host/ozdash-pm-relay.ts` (wiring, ticket/PM resolution, file append, typing via
`sendTaskMessage`).

Upstream hook: `main/bootstrap/boot/phases/services.ts`:

```ts
appScope.add(installOzdashPmRelay(mcpServer.dependencies, agentStatusService,
  ozdashTicketsSnapshot, log, join(app.getPath('userData'), TICKET_EVENTS_DIR)));
```

## Tests

- `ozdash/api/pm-relay.test.ts` (debounce, once per transition, re-arm, idle_prompt,
  per conversation, queue while busy, merge, newest wins, message text, env modes).
- `main/host/ozdash-pm-relay.test.ts` (marker vs file ref, PM itself skipped, archived or
  missing PM).
- ai-toolkit `tools/emdash-oz/test_emdash_oz.py` (wait / notify with temp dirs).

## Rebase notes

- Depends on the `agent:event` payload (`status`, `conversationId`, `taskId`, project id)
  and on the `idle_prompt` source marker, shared with the chime (05). Re-check both after
  a rebase.
- Depends on `sendTaskMessage` from the MCP server (02) for `type` mode.
- The data dir path comes from `app.getPath('userData')`, so it follows ID-2 (01).

## Known gaps

- Relay state is in memory: transitions from before an app restart are not relayed, and
  waiting `type` lines are lost on quit.
- In `type` mode, if Oleg is typing in the PM session while it is not working, the line is
  submitted with his half-typed text. (`file` mode, the default, avoids this.)
- A PM that does not run `emdash-oz wait` gets no updates in `file` mode.
