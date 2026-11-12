# Rebase OZdash onto the latest upstream

Goal: move the fork from merge base `592281113` to the newest `upstream/main`, keep every
requirement in these specs, and prove it with checks and a short manual smoke test.

Rule of thumb: rebase when upstream changed little; re-apply by feature when upstream
changed a lot in the high-risk files (see [upstream-touchpoints.md](upstream-touchpoints.md)).

## 0. Before you start

- Work in `~/Projects/emdash`, branch `oz/mcp-server`, clean tree (`git status`).
  Agents: follow [agent-runbook.md](agent-runbook.md) instead; it works in a separate
  worktree, because the live app runs from this checkout's `release/` folder.
- Read the "Rebase notes" of each spec file once.
- Do not build into, or quit, the running OZdash until step 6. Do not test against the
  real vault.

## 1. Fetch and look

```sh
git fetch upstream
git log --oneline 592281113..upstream/main | wc -l          # how far upstream moved
# Which high-risk upstream files changed upstream since the base:
git diff --stat 592281113 upstream/main -- \
  apps/emdash-desktop/src/main/bootstrap/boot/phases/services.ts \
  apps/emdash-desktop/src/core/features/workbench/browser/sidebar \
  apps/emdash-desktop/src/core/features/tasks/browser/create-task-modal \
  apps/emdash-desktop/src/core/features/tasks/browser/task-titlebar.tsx \
  apps/emdash-desktop/src/core/features/tasks/contributions/browser/task-config/initial-conversation-section.tsx \
  apps/emdash-desktop/src/core/features/tasks/node/operations/createTask.ts \
  apps/emdash-desktop/src/core/features/conversations \
  apps/emdash-desktop/src/core/features/projects/browser/components/main-panel/active-project.tsx \
  apps/emdash-desktop/src/core/features/mcp
```

Also check: did upstream ship its own MCP server (`features/mcp/node/server`)? If yes,
read 02 "Rebase notes" first.

## 2. Make a safe branch

```sh
D=$(date +%Y%m%d)
git tag oz-pre-rebase-$D oz/mcp-server         # easy way back
git switch -c oz/rebase-$D oz/mcp-server
```

## 3. Choose a path

History today: 12 MCP commits -> merge of upstream (`07fc11edd`) -> `oz:` commits (81 up to
`49d298e52`, more since; count them with `git log --oneline 07fc11edd..oz/mcp-server | wc -l`).
A plain `git rebase upstream/main` replays the 12 old MCP commits against new upstream
and loses the conflict fixes made in the merge. So do it in two steps.

### Path A: rebase (upstream changed little)

```sh
# Step A1: one commit with the MCP server as it was after the merge.
git switch -c oz/rebase-$D-base upstream/main
git diff 592281113 07fc11edd | git apply --3way --index
#   fix conflicts with 02-mcp-server-and-cli.md, then:
git commit -m "feat(mcp): built-in MCP server (squash of the PR #3086 commits)"

# Step A2: replay the oz commits (everything after the merge) on top.
git switch oz/rebase-$D
git rebase --onto oz/rebase-$D-base 07fc11edd
```

During A2, for each conflict: find the file in the touchpoints table, read its "How to
re-apply", keep upstream's new code and add the fork hook back. Then
`git add <file> && git rebase --continue`.

### Path B: re-apply in chunks (upstream changed a lot)

Do step A1 (the MCP squash commit on `upstream/main`). Then cherry-pick the `oz:`
commits in their original order, one chunk at a time. After each chunk: typecheck and the
tests of the features in it. Each chunk is a working state of the fork.

| Chunk | Features | Commits (original order) |
|---|---|---|
| 1 | 01 identity, 02 more tools + markers, 05 chime default | `6d3be05d5 7db9658e4 aacaa277b 6823d8e84 0507e5c17 ba9a7c9d8 1fb7e9c71 962074243 eaa9a155c a211349bd e1e332231` |
| 2 | 03 board v1, OZ Tickets, New ticket; 01 branding | `27c1ff9c9 cbc73cd4f 8038f2fa7 12346cada 06711b0f2 5e386d928 c61208efc e0a2b6213 1e4c39287 50269c9c6` |
| 3 | 08 declutter, 05 attention + chime, 11 git exec | `3efdfe028 b06445b0e 7c81e605b 534d27e01 0078a83b1 11c842488 cac2231da acbd1a979 75f48a2ac` |
| 4 | 03 lifecycle, priority, icons, edit; 04 Ticket tab | `e4ec7f197 e71db48af 96acd1ca6 e487a0902 1fed47a1a 7ad8e47d9 e55c3d470 dd13878ac a0834c519 719dd02d9 add3b6323 997b1a816 25ce0ed9c 06739ed2a` |
| 5 | 10 UI font, 03 flash | `4034c1735 aa61e9bd4 1ad01265f 905e92047 5ab67f3f6` |
| 6 | 07 agent palette | `3c18e6253 a678d06b7 ce3bea34b 72af17fb0 061b5dfcb 7c290aed9` |
| 7 | 04 Sessions, 02 create_conversation + restore_task, 06 relay, 01 build | `fe7cd7e4c c5efa4bb9 22789507b 04162f889 1182d8271 d412e1060 185f21f57 b5d9f19aa e8a46ddb9 ff49b4404 a9757f7f9 0a76522bc ddd9eb0ca 37699cb8b 1186f04c2` |
| 8 | 09 OZ chat, 01 build | `f3fc33e51 ecd1a35b1 7789c0568 2d072198f 218da5d1d c5c7d217c f33c52a6f` |
| 9 | 05 mute, 08 Focus view + Cmd+digit | `e08218922 f34cf763d 2ae7ee28e 49d298e52` |
| 10 | specs, small fixes, 03/04 ticket shortcuts + double-click, and every later commit | `9b9dabd34 b5ff86b81 ba58b565d 9f0842324`, then the rest of `git log --reverse --format=%h 9f0842324..oz-pre-rebase-$D` |

`git cherry-pick <commits of one chunk>`. If a commit no longer fits, do not force the
patch: re-implement it from its spec (Requirements + Implementation map), then
`git cherry-pick --skip`.

## 4. Resolve conflicts (both paths)

- `pnpm-lock.yaml`: never merge by hand. Take upstream's file, finish the rebase step,
  then run `pnpm install` (the fork's 4 extra deps are in `apps/emdash-desktop/package.json`)
  and commit the lockfile.
- Binary assets (icons, `dmg-background.tiff`): take the fork file.
- High-risk files: take upstream, then add the fork hook back as the table says. Search
  the old version for fork lines:
  `git show oz-pre-rebase-$D:<path> | grep -n -e "Fork (ozimakov-st)" -e "OZdash"`.
- A deleted or moved upstream file: follow the move; put the hook in the new place; update
  the spec's Implementation map.
- After all conflicts: no conflict markers left:
  `git grep -n -e '^<<<<<<<' -e '^>>>>>>>' -- apps packages scripts`.

## 5. Build packages and run checks

Use Node 24 and pnpm 10.28.

```sh
pnpm install
rm -rf packages/*/dist
pnpm exec nx run-many -t build --skip-nx-cache --exclude='@emdash/emdash-desktop,@emdash/workspace-server'

# Types
pnpm --dir apps/emdash-desktop run typecheck
pnpm --dir packages/core run typecheck
pnpm --dir packages/plugins run typecheck

# Lint and format (changed files, or everything)
pnpm --dir apps/emdash-desktop exec oxlint .
pnpm --dir apps/emdash-desktop exec oxfmt --check

# Tests: the vitest projects the fork has used (node, main-db)
cd apps/emdash-desktop
pnpm exec vitest run --project node src/core/features/ozdash src/core/features/mcp \
  src/core/features/workbench src/core/features/tasks src/core/features/conversations \
  src/core/features/settings src/core/manifests src/core/primitives src/main src/renderer/tests
pnpm exec vitest run --project main-db src/core/features/mcp src/core/features/conversations \
  src/core/features/tasks src/main
pnpm exec vitest run --project node          # full run; see known flaky tests below
cd ../..
pnpm --dir packages/plugins exec vitest run
pnpm --dir packages/core exec vitest run src/runtimes/git src/services/exec \
  src/runtimes/tui-agents src/services/agent-plugins

# CLI contract (ai-toolkit, fake MCP server, no app needed)
(cd ~/Projects/ai-toolkit && python3 -m unittest discover -s tools/emdash-oz -p 'test_*.py')
```

Known flaky: `src/core/features/terminals/node/xterm-tmux.test.ts` (fails alone too,
unrelated); `ozdash/node/vault-sync.test.ts` can hit its 10 s hook timeout under load
(passes alone). The `browser` vitest project needs Playwright browsers (not installed so
far).

Key fork tests that must pass: `main/host/oz-preset-command-lines.test.ts` (07),
`mcp/node/server/register-tools.test.ts` (02), `ozdash/node/tickets-service.test.ts` (03),
`ozdash/api/attention-live-rows.test.ts` (05), `ozdash/api/pm-relay.test.ts` (06).

## 6. Build the app

```sh
scripts/oz/build-mac.sh     # clean package dist, nx build without cache, package, sign
```

Then quit the running OZdash, replace the app, start the new build. Expect one keychain
prompt ("OZdash Safe Storage"): click **Always Allow**.

## 7. Manual smoke test (in the app)

Safe setup for vault writes: start the new build from a terminal with
`OZDASH_VAULT_PATH=<scratch copy of the vault in its own git repo>` and
`OZDASH_TICKET_ICONS=off`, or only do read-only checks on the real vault.

| # | Check (expected result) | Spec |
|---|---|---|
| 1 | App name OZdash in Dock, menu bar, window title; OZ icon; boot splash says OZdash | ID-1, ID-4 |
| 2 | Data still there (projects, tasks); no update prompt; Help menu has no Give Feedback | ID-2, ID-3, SB-1 |
| 3 | `emdash-oz projects` lists projects (server on 8212, token works) | MCP-1, MCP-2 |
| 4 | `emdash-oz create --project <repo> --prompt "say hi" --preset review-gpt` starts codex; the result shows `model: gpt-6.1-sol` and `effort: high` | MCP-5, MCP-6, AP-11 |
| 5 | `emdash-oz status <task>` shows conversations and output; `emdash-oz send <task> --message hi` is delivered | MCP-12, MCP-13 |
| 6 | `emdash-oz converse <task> --preset review-grok --title Review` adds a second tab | MCP-10 |
| 7 | `emdash-oz archive <task>` then `emdash-oz restore <task>` brings it back | MCP-14 |
| 8 | PM project is first in the sidebar with the `PM` badge; it opens on the Tickets board | TK-2, TK-3 |
| 9 | Board shows Needs Oleg / Active / Waiting; Parked panel open, Archive closed; search finds a ticket by text | TK-9, TK-10 |
| 10 | Click a card: popup with ▲/▼, Goal Show more, Edit, Park, Open session | TK-13 |
| 11 | ▲/▼ changes the chip at once; one commit about 1 s later (scratch vault) | TK-14 |
| 12 | Drag a card inside its priority group; order stays after reload | TK-15 |
| 13 | Cmd+N in the PM project opens New ticket; create one: it lands in Parked, no PM session | TK-4, TK-18, TK-25 |
| 14 | Start a parked ticket: it becomes Active and a PM session opens with `/oz-pm <id>` | TK-19, TK-30 |
| 15 | New ticket with ⚡ Flash: gold P0 card, PM session opens at once | TK-28, TK-29 |
| 16 | Edit a ticket: change the title; Log line `Edited in OZdash (title)`; edit the file on disk while the form is open -> Save refuses | TK-26, TK-27 |
| 17 | Archive a parked ticket -> Archive panel; Restore -> Parked | TK-22, TK-23 |
| 18 | Tickets show pixel icons (sprite when no `icon.svg`) | TK-31 |
| 19 | New Task in a repo: "Based on: Issue" lists OZ Tickets; create from a ticket -> sidebar shows `Ticket #id`, ticket gets a child row | TK-33, TK-34, TV-8 |
| 20 | Child task: header chip `Ticket #id` opens the PM session; Ticket toggle opens the Ticket tab with Sessions (PM first, "this task") | TV-2…TV-6, TV-9 |
| 21 | Ticket tab: "Show archived (n)" lists an archived child with Restore | TV-7 |
| 22 | A task of yours that asks a question: amber row + bell, Dock badge, Glass chime + banner once | AT-1…AT-8 |
| 23 | Restart OZdash: the unseen mark is still there (soft); no chime at start | AT-5, AT-8 |
| 24 | A PM-made child (via `emdash-oz create --ticket`) that finishes: no chime, no amber, no badge | AT-10 |
| 25 | That child's finish adds a line to `ticket-events/<id>.jsonl`; `emdash-oz wait --ticket <id>` prints it | RL-1, RL-3 |
| 26 | Sidebar: no bottom bar; More group collapsed; no Activity badge; Mod+O still opens the editor | SB-2, SB-3, SB-4 |
| 27 | Focus view hides PM-managed tasks and empty projects; footer "… hidden — Show all"; eye button toggles | SB-7…SB-9 |
| 28 | Hold Cmd: numbers on the first 10 rows; Cmd+3 opens row 3; Cmd+0 opens row 10 (no zoom reset) | SB-11…SB-13 |
| 29 | New Task dialog shows palette chips; a chip sets agent, model, effort; auto-approve switch is on | AP-3, AP-5 |
| 30 | New session starts in OZ chat; tool calls collapse; no permission prompt; subagent status line shows | OC-1, OC-6…OC-10 |
| 31 | Chat tab menu: "Show as Emdash chat" switches the view; "New … session in Terminal" works | OC-3 |
| 32 | Settings > Interface: UI font Geist applies at once; Emdash chat text stays Inter | UF-1, UF-4 |
| 33 | Settings > Interface: "New sessions start in" = Terminal makes the next MCP task a terminal | OC-1, MCP-11 |
| 34 | From a task in another project (also with the terminal focused), ⌥⌘B opens the PM project on the Tickets board; the sidebar Tickets button tooltip shows ⌥⌘B; ⌘K "Open Tickets Board" works | TK-36 |
| 35 | In a task with a ticket, ⌥⌘T opens the right sidebar on the Ticket tab, ⌥⌘T again closes the sidebar; the Ticket toggle tooltip shows ⌥⌘T. In a task without a ticket ⌥⌘T does nothing. ⌘⇧B still opens the in-app browser | TV-10 |
| 36 | Board: one click opens the popup (a short moment later); double-click on a card with a live PM session opens it (no popup); double-click on a parked row asks "Start ticket #… ?" (Cancel does nothing; Start opens a PM session, scratch vault); dragging a card still reorders; Enter on a focused card opens the popup at once | TK-37, TK-38 |

## 8. Finish

- Update `specs/ozdash/` where file paths or hooks moved (Implementation maps,
  touchpoints table; regenerate the table from `git diff --name-status -M <new base>..HEAD`).
- Update the merge base in [README.md](README.md).
- Move the branch: `git switch oz/mcp-server && git reset --hard oz/rebase-$D` (only after
  Oleg's OK). Pushing needs a force push: ask Oleg first.

## Known traps

| Trap | What happens | What to do |
|---|---|---|
| Stale package `dist/` | The app bundles `packages/*/dist`, not sources. Old dist once shipped old agent code (cursor `--model` and codex effort lost); old hashed chunks once broke the build ("Exported variable … is not defined"). | Always `rm -rf packages/*/dist` and build with `--skip-nx-cache` (`build-mac.sh` does it). |
| Keychain prompt per rebuild | Self-signed cert, no Apple Team ID: macOS asks for "OZdash Safe Storage" after each build. | Click Always Allow. Without `make-signing-cert.sh` the app is ad hoc signed and asks more often. |
| Unsigned app | electron-builder flips fuses and breaks the signature: "Code Signature Invalid" crash. | Use `build-mac.sh`, never `package:mac` alone. |
| Cmd+digit overrides | Upstream binds Cmd+1…9 (tabs) and Cmd+0 (zoom). A rebase can bring a binding back, and then two commands fight. | Check `workbench/contributions/commands.ts` and `main/host/menu.ts`; smoke test #28. |
| New upstream shortcut on ⌥⌘B / ⌥⌘T | The fork's Open Tickets Board / Toggle Ticket Panel stop working in the scope where upstream's binding wins. | `git grep -n -e "Alt'], 'KeyB'" -e "Alt'], 'KeyT'" -e "Alt+B" -e "Alt+T" -- apps/emdash-desktop/src`; table in 08 Contracts; smoke tests #34, #35. |
| Chat transport events | OZ chat reads ACP state keys and turn item kinds by name. A rename upstream gives empty or "unknown" rows, not a type error. | Smoke test #30; compare `ozdash/api/chat/*` with `packages/core/src/runtimes/acp/api/models/`. |
| Agent status events | Chime, attention, relay and the cursor launch fix depend on `agent:event` payloads and the `idle_prompt` marker. | Tests in 05 / 06; smoke tests #22-#25. |
| Seen flag resets | New upstream code that sets `agentStatusSeen: 1` on reset brings back "marks vanish on restart". | `grep -rn "agentStatusSeen: 1" apps/emdash-desktop/src`. |
| Preload changes | `window.ozdash` lives in the preload; a dev reload does not pick it up. | Rebuild and restart. |
| Build in the main checkout | The live app runs from `~/Projects/emdash/apps/emdash-desktop/release/mac-arm64/OZdash.app`; `build-mac.sh` there overwrites the running bundle. | Build in a separate worktree (agent-runbook.md step 2), or only after Oleg quit the app. |
| Old app still running | A second instance cannot take port 8212 and scans to 8213; `emdash-oz` keeps talking to the old app on 8212. | Quit the old OZdash before starting the new build. |
| `OZDASH_PM_PROJECT_PATH` / `OZDASH_VAULT_PATH` | Read from the app's environment; a Dock launch ignores shell exports. | Start from a terminal to test with a scratch vault. |
| Real vault writes | Board clicks commit and push the real vault repo. | Use a scratch vault for write tests (step 7). |
