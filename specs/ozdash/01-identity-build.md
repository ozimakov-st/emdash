# 01 Identity, build and signing

OZdash must never share data with the official Emdash app, must never auto-update to it,
and must build and start on Oleg's Mac with one command.

## Requirements

| ID | Requirement | Why |
|---|---|---|
| ID-1 | Product name is `OZdash` (bundle, Dock, menu bar, About, window title, tray, `<title>`). | Tell it apart from official Emdash. |
| ID-2 | App id is `com.emdash.oz`; data dir is `~/Library/Application Support/emdash-oz` (dev builds: `emdash-oz-dev`); `APP_NAME_LOWER` = `emdash-oz`; Linux desktop id `EmdashOZ`; artifact prefix `ozdash`. | Own data, never mixed with `emdash`. `APP_NAME_LOWER` builds the renderer origin, so changing it would lose localStorage. |
| ID-3 | Auto-update is off: the updater phase returns at once, and recovery mode does not initialize the updater. | An official update would replace the fork. |
| ID-4 | Branding: OZ app icon (`emdash.png`, `emdash.icns`, `icon-light.png`), OZdash wordmark with an emerald dash (logo, shimmer logo, home view, empty pane), boot splash ("OZdash is taking longer…", "Restart OZdash"), recovery window "OZdash Recovery", DMG background, dev icon with a DEV tag. The tray icon stays the upstream dash. | Oleg sees at once which app he uses. |
| ID-5 | Branding assets are reproducible with scripts in `scripts/oz/` (`make-branding.sh`, `ozdash-wordmark.py`, `dmg-background.py`, `icon-app.swift`, `icon-light.swift`, `icon-dev.swift`). | Re-create after an upstream logo change. |
| ID-6 | `scripts/oz/build-mac.sh` builds `apps/emdash-desktop/release/mac-arm64/OZdash.app` (+ dmg, zip) in one step. | One command for Oleg. |
| ID-7 | The build first deletes `packages/*/dist` and builds the workspace packages without the nx cache (`nx run-many -t build --skip-nx-cache --exclude=@emdash/emdash-desktop,@emdash/workspace-server`). | The app bundles package `dist/`, not sources. A stale `dist/` once shipped old agent code (lost cursor `--model`, codex effort); mixed hashed chunks once broke the build. |
| ID-8 | The build signs the app with the local certificate "OZdash Local Signing" when it exists (created once by `scripts/oz/make-signing-cert.sh`), else ad hoc, then verifies the signature. | electron-builder breaks the signature when it flips fuses; an unsigned app crashes ("Code Signature Invalid"). |
| ID-9 | One keychain prompt ("OZdash Safe Storage") after each rebuild is accepted (click Always Allow). There is no Apple Team ID. | Known cost of a self-signed cert. |
| ID-10 | A stored secret that cannot be decrypted (keychain key changed after rename or re-sign) is treated as missing; boot must not fail. | The user signs in again instead of a broken start. |
| ID-11 | The build creates `~/Library/Application Support/emdash-oz/chime.wav` from macOS `Glass.aiff` if missing. | Default notification sound (see 05). |
| ID-12 | "Copy installation info" uses `app.name` (OZdash), not "Emdash". | Correct bug reports. |

## Settings / env switches

None. Build needs Node 24 (`.nvmrc` 24.14.0) and pnpm 10.28 on PATH.

## Contracts

| Item | Value |
|---|---|
| Bundle | `apps/emdash-desktop/release/mac-arm64/OZdash.app` |
| Data dir | `~/Library/Application Support/emdash-oz/` (DB `emdash4.db`, `mcp-token`, `chime.wav`, `ticket-events/`) |
| Keychain item | `OZdash Safe Storage` |
| Signing cert | `OZdash Local Signing` in the login keychain |
| `AUTO_UPDATE_DISABLED` | `true`, exported from `app-identity.ts` |

## Implementation map

Fork-owned: `scripts/oz/build-mac.sh`, `make-signing-cert.sh`, `make-branding.sh`,
`ozdash-wordmark.py` / `.svg`, `dmg-background.py`, `icon-*.swift`, `scripts/oz/README.md`.

Upstream files touched:

| File | Hook |
|---|---|
| `src/core/primitives/app-identity/api/app-identity.ts` | stable ids and names; `AUTO_UPDATE_DISABLED` |
| `src/main/bootstrap/boot/phases/updater.ts` | `if (AUTO_UPDATE_DISABLED) return;` |
| `src/main/host/recovery/recovery-window.ts`, `recovery.html` | no updater init; OZdash text |
| `src/main/host/secrets/encrypted-app-secrets-store.ts` | try/catch around `decryptString`, return null |
| `src/main/host/menu.ts` | `${app.name}` in installation info |
| `src/renderer/index.html` | title + boot splash wordmark |
| `src/renderer/app/welcome.tsx` | logo `alt={PRODUCT_NAME}` |
| `src/core/primitives/app-identity/browser/emdash-logo.tsx`, `emdash-shimmer-logo.tsx` | wordmark paths, `accentColor` prop |
| `src/core/features/workbench/browser/home-view.tsx` | emerald `accentColor` |
| assets: `emdash.png`, `emdash.icns`, `icon-light.png`, `emdash-dev.png`, `build/dmg-background.tiff` | replaced files |

`electron-builder.config.ts` is not changed: it reads `APP_ID`, `PRODUCT_NAME` and
`ARTIFACT_PREFIX` from `app-identity.ts`. (`src/` = `apps/emdash-desktop/src/`.)

## Tests

- `src/main/host/secrets/encrypted-app-secrets-store.db.test.ts` (main-db): undecryptable = missing.
- No unit tests for names, assets or scripts: check by hand (see rebase.md smoke list).

## Rebase notes

- `app-identity.ts`: if upstream adds new identity constants, give each one an OZ value
  (never `emdash` / `com.emdash.stable`).
- If upstream adds a new place that calls the updater, guard it with `AUTO_UPDATE_DISABLED`.
  Search: `grep -rn "updateService\.\(initialize\|check\)" apps/emdash-desktop/src`.
- If upstream changes the logo SVG or the boot splash, re-run
  `python3 scripts/oz/ozdash-wordmark.py --paths` and paste the paths again.
- If upstream changes the build (new packages, new `package:mac` steps), update
  `build-mac.sh` so all workspace packages are still built from a clean `dist/`.
- Binary assets: on conflict take the fork file.
- After the rebase: one keychain prompt is expected; click Always Allow.

## Known gaps

- Other "Emdash" texts stay (docs, logs, MCP tool texts, "Quit Emdash?" dialog). This is
  on purpose (smaller diff).
