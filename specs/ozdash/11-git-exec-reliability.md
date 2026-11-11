# 11 Git commands always settle

After the Mac slept, one git command could hang forever. All git work of a repository
runs in one FIFO lane, so one stuck command blocked that repository (for example, a
"refs snapshot timed out" error when creating a task) until the app restarted.

```
repository lane (FIFO)
  status / refs / head / log / add / commit / fetch …
     └─ one command never settles  ->  every later command waits forever
```

## Requirements

| ID | Requirement | Why |
|---|---|---|
| GX-1 | After a child process exits, the exec waits at most 2 s for `close`, then destroys stdout/stderr so `close` fires and the call settles. | A descendant that inherited the pipes kept `close` from firing, even with a timeout. |
| GX-2 | Every git command without its own deadline gets a 5 minute deadline (`DEFAULT_GIT_COMMAND_TIMEOUT_MS`). `clone`, `fetch`, `pull`, `push` are exempt (their job's abort signal owns them). An explicit `timeoutMs` is kept. `commandTimeoutMs: 0` turns the default off. | The lane always drains. |
| GX-3 | A spawn error (ENOENT from a missing cwd or binary) settles with an error, and the next call works. | Deleted worktrees log ENOENT at start; that is noise, not a hang. |

## Settings / env switches

None (constant in code).

## Contracts

- `createGitExec(options)` accepts `commandTimeoutMs?: number`.
- `withGitCommandTimeout(exec, ms)` finds the subcommand after `-C <path>`, `-c k=v` and
  other leading flags.

## Implementation map

Upstream files (packages/core, no fork-owned file):

| File | Change |
|---|---|
| `packages/core/src/services/exec/api/bound-exec.ts` | `EXIT_CLOSE_GRACE_MS = 2_000`; on `exit`, timer destroys the pipes |
| `packages/core/src/runtimes/git/node/exec/git-exec.ts` | `withGitCommandTimeout` wraps `createBoundExec` |

## Tests

- `packages/core/src/services/exec/api/bound-exec.test.ts` (ENOENT cwd / binary then
  success; child exits while a background process holds its output; timeout with a
  detached descendant).
- `packages/core/src/runtimes/git/node/exec/git-exec.test.ts` (deadline kills a stuck
  command and the lane continues; explicit deadlines kept; transfers exempt).

## Rebase notes

- Both changes are generic and could go upstream. If upstream fixes the same hang, drop
  the fork code and keep the tests that still apply.
- If upstream changes the `BoundExec` interface (new methods), add them to the wrapper in
  `withGitCommandTimeout` (it lists every method: `exec`, `execStreaming`, `execBuffer`,
  `spawn`, `withCwd`).
- These files are in `packages/core`: rebuild packages from a clean `dist/` (01 ID-7).

## Known gaps

- A hanging `fetch` / `pull` / `push` still blocks its repository until its job is
  cancelled.
- The pull-requests worker hang (`refreshRepository` timed out, waiting on an in-flight
  sync run) is a separate path and is not fixed.
- 5 minutes is a guess: a very slow commit hook fails after 5 minutes.
