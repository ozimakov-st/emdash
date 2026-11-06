# OZdash (Oleg's Emdash fork)

This fork adds the built-in MCP server (upstream PR #3086) and two more tools for an
outside "manager" agent: `send_task_message` and `get_task_status`.

The fork builds as **OZdash** (`release/mac-arm64/OZdash.app`). It keeps the old ids
`com.emdash.oz` and data dir `emdash-oz`, so it never shares data with the official
Emdash app. Auto-update is off.

The sidebar shows the "PM" project first: the local project at `~/Projects/work`
(override with the env var `OZDASH_PM_PROJECT_PATH`).

The PM project opens on a **Tickets** board (code in
`apps/emdash-desktop/src/core/features/ozdash`). It reads
`~/Projects/work/vault/tickets/*/ticket.md` (override with `OZDASH_VAULT_PATH`) and
updates when the files change. Click a card to open the ticket's PM session (or start
one with `/oz-pm <id>`); archived tickets have a Restore button. Both write the ticket
and then sync the vault repo (add, commit, pull --rebase --autostash, push).

- Build: `scripts/oz/build-mac.sh` (needs Node 24 and pnpm 10.28 on PATH). Run `scripts/oz/make-signing-cert.sh` once first, so every build has the same signature and macOS asks for keychain access only once.
- Icons: `icon-app.swift` and `icon-light.swift` draw the OZ versions of
  `src/assets/images/emdash/emdash.png` and `icon-light.png` from the upstream
  originals. Run with `swift <script> <upstream png> <out png>`. Make the `.icns`
  with `sips` + `iconutil` (sizes 16 to 1024).
