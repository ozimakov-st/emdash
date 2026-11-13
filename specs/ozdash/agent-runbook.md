# Agent runbook: bring OZdash onto the latest upstream Emdash

You are an agent. Your job: move OZdash (Oleg's fork of Emdash) onto the newest
`upstream/main`, keep every fork feature working, build the app, test it, and hand the
result to Oleg for review. Oleg decides when the new version replaces the old one.

Read these first, once: [README.md](README.md) (principles, words),
[rebase.md](rebase.md) (the rebase method), [upstream-touchpoints.md](upstream-touchpoints.md)
(every upstream file the fork changes, and how to re-apply each change). Each spec file
`01`…`11` has a "Rebase notes" section: read them too.

```
upstream/main ──────────────●  (new)
                             \
                              oz/rebase-<sha>   <- you build this branch
oz/mcp-server ──●  (old, Oleg's live app; you do not change it)
```

## Hard rules

1. Never touch the live app data dir `~/Library/Application Support/emdash-oz` (no edits,
   no deletes, no moves). Do not run tests or tools that write there.
2. Never quit, restart or replace the running OZdash yourself. Ask Oleg. It runs from
   `/Applications/OZdash.app`. Check with `pgrep -fl OZdash` first: never delete, move or
   rebuild a bundle a running OZdash uses (new agents then fail with
   `spawn .../OZdash Helper ENOENT`). Build in a separate worktree (step 2).
3. Work on a new branch `oz/rebase-<upstream short sha>`. Never commit to, reset or
   force-push `oz/mcp-server` until Oleg says yes in this session.
4. Never write to the real vault (`~/Projects/work/vault`). For board tests that write,
   use a scratch copy (step 9).
5. Push only your own branch. Open only a draft PR. Ask Oleg before anything else that
   other people or systems see.
6. Commits: `git -c user.name="Oleg Zimakov" -c user.email="ozimakov@servicetitan.com"
   commit …`, with the attribution line your session asks for.

## 1. Preconditions

```sh
# Node 24 + pnpm 10.28 (this shell setup is needed in every new shell):
export PATH="$HOME/.npm/_npx/9e1888088e10d03f/node_modules/.bin:$HOME/.nvm/versions/node/v24.6.0/bin:$PATH"
unset -f node npm npx
node -v    # v24.x
pnpm -v    # 10.28.x

cd ~/Projects/emdash
git status --short                    # must be empty (clean tree)
git branch --show-current             # oz/mcp-server
git remote -v                         # origin = ozimakov-st/emdash, upstream = generalaction/emdash
git fetch origin && git fetch upstream
git status -sb | head -1              # oz/mcp-server must not be behind origin/oz/mcp-server
```

If the tree is not clean, or `oz/mcp-server` differs from `origin/oz/mcp-server`, stop
and ask Oleg.

## 2. Names, safety tag, worktree

```sh
cd ~/Projects/emdash
U=$(git rev-parse --short upstream/main)        # for example 3f2a91c0d
D=$U                                            # rebase.md uses $D in branch names
git tag oz-pre-rebase-$D oz/mcp-server          # the way back
git worktree add -b oz/rebase-$D ~/Projects/emdash-rebase-$D oz/mcp-server
cd ~/Projects/emdash-rebase-$D                  # do all further work here
```

All later commands run in `~/Projects/emdash-rebase-$D` with `U` and `D` set (set them
again in a new shell: `D=<sha>`).

## 3. Measure what upstream changed

Run [rebase.md](rebase.md) step 1 (the `git log` count and the `git diff --stat` of the
high-risk paths). Also:

```sh
BASE=$(git merge-base oz/mcp-server upstream/main)          # today: 592281113
git log --oneline $BASE..upstream/main | wc -l
# Fork hook files that upstream also changed (likely conflicts):
git diff --name-only $BASE oz/mcp-server | sort > /tmp/oz-fork-files.txt
git diff --name-only $BASE upstream/main | sort > /tmp/oz-upstream-files.txt
comm -12 /tmp/oz-fork-files.txt /tmp/oz-upstream-files.txt
# New DB migrations (they change the live DB when Oleg starts the new build):
git diff --stat $BASE upstream/main -- apps/emdash-desktop/drizzle
# Did upstream ship its own MCP server? (read 02 "Rebase notes" if yes)
git diff --stat $BASE upstream/main -- apps/emdash-desktop/src/core/features/mcp
```

Write down the overlap list. It is the start of your report (step 11).

## 4. Rebase or re-apply

Follow [rebase.md](rebase.md) step 3. Short version:

- **Path A (few overlaps):** make one squashed MCP commit on `upstream/main`, then replay
  every commit after the merge `07fc11edd`:
  ```sh
  git switch -c oz/rebase-$D-base upstream/main
  git diff 592281113 07fc11edd | git apply --3way --index
  #   fix conflicts with 02-mcp-server-and-cli.md, then:
  git commit -m "feat(mcp): built-in MCP server (squash of the PR #3086 commits)"
  git switch oz/rebase-$D
  git rebase --onto oz/rebase-$D-base 07fc11edd
  ```
- **Path B (many overlaps in high-risk files):** after the same squash commit, cherry-pick
  the `oz:` commits chunk by chunk (table in rebase.md, chunks 1-10), and run typecheck and
  the feature tests after each chunk.

If `07fc11edd` is no longer the merge in the history (someone merged upstream again),
stop and ask Oleg which base to use.

## 5. Resolve conflicts with upstream-touchpoints.md

For each conflicting file:

1. Find its row in [upstream-touchpoints.md](upstream-touchpoints.md) (search the path).
   The row says which spec it serves, the risk, and "How to re-apply".
2. Take upstream's new version of the file, then add the fork hook back as the row says.
   The old fork lines are easy to find:
   ```sh
   git show oz-pre-rebase-$D:<path> | grep -n -e "Fork (ozimakov-st)" -e "OZdash"
   ```
3. If upstream moved or deleted the file, put the hook in the new place, and note the move
   (you update the Implementation map later, step 10).
4. `pnpm-lock.yaml`: take upstream's file, then `pnpm install` and commit the new lockfile.
   Binary assets (icons, `dmg-background.tiff`): take the fork file.
5. `git add <file> && git rebase --continue` (Path A) or `git cherry-pick --continue`
   (Path B). If a commit no longer fits at all, re-implement it from its spec
   (Requirements + Implementation map) and skip the commit.

When done:

```sh
git grep -n -e '^<<<<<<<' -e '^>>>>>>>' -- apps packages scripts specs   # must print nothing
git grep -n -e "Fork (ozimakov-st)" -e "OZdash" -- apps packages ':!**/features/ozdash/**' | wc -l
git grep -n -e "Fork (ozimakov-st)" -e "OZdash" oz-pre-rebase-$D -- apps packages ':!**/features/ozdash/**' | wc -l
```

The two hook counts should be close. If many hooks are missing, compare the lists.

## 6. Re-check every requirement

Go through the spec files as a checklist. For each requirement ID, mark it **ok** (code is
there and a test or a read of the code proves it), **changed** (upstream changed the
area; you adapted it; say how), **broken** or **not checked**.

| Spec | IDs |
|---|---|
| [01-identity-build.md](01-identity-build.md) | ID-1 … ID-12 |
| [02-mcp-server-and-cli.md](02-mcp-server-and-cli.md) | MCP-1 … MCP-18 |
| [03-pm-project-and-tickets.md](03-pm-project-and-tickets.md) | TK-1 … TK-38 |
| [04-ticket-side-view.md](04-ticket-side-view.md) | TV-1 … TV-10 |
| [05-attention-and-notifications.md](05-attention-and-notifications.md) | AT-1 … AT-12 |
| [06-pm-relay.md](06-pm-relay.md) | RL-1 … RL-6 |
| [07-agent-palette-and-auto-approve.md](07-agent-palette-and-auto-approve.md) | AP-1 … AP-11 |
| [08-sidebar-and-chrome.md](08-sidebar-and-chrome.md) | SB-1 … SB-13, fork shortcuts table |
| [09-oz-chat.md](09-oz-chat.md) | OC-1 … OC-15 |
| [10-ui-font.md](10-ui-font.md) | UF-1 … UF-5 |
| [11-git-exec-reliability.md](11-git-exec-reliability.md) | GX-1 … GX-3 |

Also check upstream's new features against the fork rules. Examples:
- a new "create task" entry point must show the New ticket form in the PM project (TK-4);
- a new sidebar footer item goes into More or is removed (SB-4);
- a new shortcut on ⌘1…⌘0, ⌥⌘B or ⌥⌘T must go (08 Contracts table);
- new code that sets `agentStatusSeen: 1` on reset (rebase.md "Known traps").

## 7. Run all checks

```sh
cd ~/Projects/emdash-rebase-$D
pnpm install
rm -rf packages/*/dist
pnpm exec nx run-many -t build --skip-nx-cache --exclude='@emdash/emdash-desktop,@emdash/workspace-server'

# Types
pnpm --dir apps/emdash-desktop run typecheck
pnpm --dir packages/core run typecheck
pnpm --dir packages/plugins run typecheck

# Lint and format (whole app; it must be clean)
pnpm --dir apps/emdash-desktop exec oxlint .
pnpm --dir apps/emdash-desktop exec oxfmt --check

# Tests
cd apps/emdash-desktop
pnpm exec vitest run --project node src/core/features/ozdash src/core/features/mcp \
  src/core/features/workbench src/core/features/tasks src/core/features/conversations \
  src/core/features/settings src/core/manifests src/core/primitives src/main src/renderer/tests
pnpm exec vitest run --project main-db src/core/features/mcp src/core/features/conversations \
  src/core/features/tasks src/main
pnpm exec vitest run --project node          # full run
cd ../..
pnpm --dir packages/plugins exec vitest run
pnpm --dir packages/core exec vitest run src/runtimes/git src/services/exec \
  src/runtimes/tui-agents src/services/agent-plugins

# ai-toolkit (CLI contract and ticket status; no app needed)
python3 -m unittest discover -s ~/Projects/ai-toolkit/tools/emdash-oz -p 'test_*.py'
python3 -m unittest discover -s ~/Projects/ai-toolkit/tools/ticket-status -p 'test_*.py'
```

Known flaky (rebase.md step 5): `terminals/node/xterm-tmux.test.ts` (fails on the old
fork too) and `ozdash/node/vault-sync.test.ts` under load (run it alone). The `browser`
vitest project needs Playwright browsers (not installed): skip it and say so.

Fix every other failure before you build. Commit fixes on `oz/rebase-$D` with clear
messages (`oz: …`).

## 8. Build

```sh
cd ~/Projects/emdash-rebase-$D
security find-certificate -c "OZdash Local Signing" >/dev/null && echo "cert ok"
scripts/oz/build-mac.sh
```

- The script runs `pnpm install`, builds the packages from a clean `dist/` without the nx
  cache, packages the app, and signs it with the "OZdash Local Signing" certificate (ad hoc
  when the certificate is missing: then tell Oleg, he runs `scripts/oz/make-signing-cert.sh`
  once).
- Result: `~/Projects/emdash-rebase-$D/apps/emdash-desktop/release/mac-arm64/OZdash.app`.
- The script only creates `chime.wav` in the data dir when it is missing; it does not
  change anything else there.
- Do not start this app yourself. The live app holds the single-instance lock and the
  data dir.

## 9. Manual smoke test (with Oleg)

The new build uses the same data dir as the live app. When it starts, new upstream DB
migrations (step 3) run on Oleg's real data. So ask Oleg first, and say which migrations
are new.

Message to Oleg (adapt):

> The rebased build is ready at `~/Projects/emdash-rebase-<sha>/…/OZdash.app`. To test it
> I need you to: (1) optionally back up `~/Library/Application Support/emdash-oz`,
> (2) quit OZdash, (3) start the new build. New DB migrations: <list or "none">. On start,
> macOS asks once for "OZdash Safe Storage": click **Always Allow**.

After Oleg starts it:

1. Check that the new app (not the old one) has port 8212:
   ```sh
   lsof -nP -iTCP:8212 -sTCP:LISTEN     # the path must be the emdash-rebase-<sha> app
   lsof -nP -iTCP:8213 -sTCP:LISTEN     # must print nothing
   ```
   If the old app is still running, the new one cannot take 8212 (or quits at once
   because of the single-instance lock), and `emdash-oz` keeps talking to the old app.
2. Run the 36 checks in [rebase.md](rebase.md) step 7. Do the CLI checks yourself
   (`emdash-oz …`). For UI checks, ask Oleg to click and tell you what he sees, or ask
   him for screenshots. For board writes (checks 11-17, 36), Oleg starts the app from a
   terminal with a scratch vault:
   ```sh
   SCRATCH=$(mktemp -d)/vault-repo
   git clone --quiet ~/Projects/work "$SCRATCH"        # a copy in its own git repo
   git -C "$SCRATCH" remote remove origin             # vault sync must not push anywhere
   OZDASH_VAULT_PATH="$SCRATCH/vault" OZDASH_TICKET_ICONS=off \
     ~/Projects/emdash-rebase-<sha>/apps/emdash-desktop/release/mac-arm64/OZdash.app/Contents/MacOS/OZdash
   ```
   Without a remote, each vault sync commits locally and shows a pull warning. That is
   expected. PM sessions that Start creates are real tasks in the PM project: archive
   them after the test.
3. When done, Oleg decides which app to keep running.

## 10. Update the specs

On `oz/rebase-$D`, in one commit (`oz: specs after rebase onto upstream <sha>`):

- [README.md](README.md) "Baseline": new merge base, commit counts.
- Implementation maps and Rebase notes of every spec whose files or hooks moved.
- [upstream-touchpoints.md](upstream-touchpoints.md): regenerate the tables from
  `git diff --name-status -M <new base>..HEAD` and `git diff --numstat <new base>..HEAD`.
- [rebase.md](rebase.md): the new history (MCP squash commit hash, `oz:` commit list and
  chunks) and any new trap you hit.

## 11. Report

Write the report in your final message (not in a file), in simple English:

1. Upstream: from `<old base>` to `<new sha>`, N commits. The upstream changes that touch
   fork features, per spec area (for example "08: upstream rewrote `task-item.tsx`; fork
   slots re-added").
2. Conflicts: each file, and how you resolved it (one line each).
3. Requirements: counts of ok / changed / broken / not checked, and the list of every
   non-ok ID with a reason.
4. Checks: each command from step 7 with pass / fail and test counts; skipped projects.
5. Build: path, signing identity, warnings.
6. Smoke test: which checks passed, which Oleg did not run.
7. DB migrations that ran (or will run) on the live data.
8. Gaps and questions for Oleg.

## 12. Hand over

```sh
cd ~/Projects/emdash-rebase-$D
git push -u origin oz/rebase-$D
git push origin oz/rebase-$D-base         # the MCP squash commit (needed for range-diff)
gh pr create --repo ozimakov-st/emdash --draft \
  --base oz/mcp-server --head oz/rebase-$D \
  --title "OZdash on upstream $U" \
  --body-file /tmp/oz-rebase-pr.md        # the report from step 11
```

The PR diff also shows all upstream changes. Put this in the PR body, so Oleg can see only
the fork changes:

```sh
git range-diff 07fc11edd..oz-pre-rebase-$D oz/rebase-$D-base..oz/rebase-$D
```

Then ask Oleg. Only after his clear OK in this session, replace `oz/mcp-server`:

```sh
cd ~/Projects/emdash                     # the main checkout (oz/mcp-server)
git switch oz/mcp-server
git reset --hard oz/rebase-$D
git push --force-with-lease origin oz/mcp-server
git worktree remove ~/Projects/emdash-rebase-$D      # only when Oleg no longer runs that build
```

Keep the tag `oz-pre-rebase-$D` (the way back). To install the new build, Oleg runs
`scripts/oz/update.sh` (or asks you to run it with `--yes`); `update.sh --rollback` puts the
previous app back. Never copy a bundle into `/Applications` by hand.
