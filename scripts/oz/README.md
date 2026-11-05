# Emdash OZ (Oleg's fork)

This fork adds the built-in MCP server (upstream PR #3086) and two more tools for an
outside "manager" agent: `send_task_message` and `get_task_status`.

The fork builds as **Emdash OZ** (`com.emdash.oz`, data in `emdash-oz`), so it never
shares data with the official Emdash app. Auto-update is off.

- Build: `scripts/oz/build-mac.sh` (needs Node 24 and pnpm 10.28 on PATH).
- Icons: `icon-app.swift` and `icon-light.swift` draw the OZ versions of
  `src/assets/images/emdash/emdash.png` and `icon-light.png` from the upstream
  originals. Run with `swift <script> <upstream png> <out png>`. Make the `.icns`
  with `sips` + `iconutil` (sizes 16 to 1024).
