# 10 UI font

Oleg prefers Geist for the app. The choice is a setting, applied live.

## Requirements

| ID | Requirement | Why |
|---|---|---|
| UF-1 | Settings > Interface > Font > **UI font**: Default (Inter) / Geist / System font. Stored as `interface.uiFont` (`default | geist | system`), default `default`; unknown stored values fall back to `default` without resetting other interface settings. | Personal taste, no restart. |
| UF-2 | Applied live by setting `--em-font-sans` on `<html>` (inline style) from the theme provider. Mono fonts (code, terminal, editor) do not change. | All sans text follows one variable. |
| UF-3 | Geist Variable is bundled (`@fontsource-variable/geist`, OFL-1.1), no network. | Offline app. |
| UF-4 | Emdash chat transcript text stays Inter: `--chat-font-sans` is pinned to the stock Inter stack while another UI font is active. | chat-ui measures text with Inter; another font breaks line wrapping. (OZ chat uses its own Geist stack, see 09.) |
| UF-5 | The setting is found by settings search ("UI font", "geist", "typeface"). | Easy to find. |

## Settings / env switches

`interface.uiFont` in `app_settings` (`emdash4.db`), default `default`.

## Contracts

| Id | `--em-font-sans` |
|---|---|
| `default` | stock value (Inter Variable stack) |
| `geist` | `'Geist Variable', <stock stack>` |
| `system` | `-apple-system, BlinkMacSystemFont, system-ui, 'Segoe UI', <stock stack>` |

## Implementation map

Fork-owned: `ozdash/api/ui-font.ts` (ids, CSS variables), `ozdash/browser/ui-font.tsx`
(`useApplyUiFont`, `UiFontSettingsCard`).

Upstream hooks: `renderer/lib/providers/theme-provider.tsx` (`useApplyUiFont();`),
`settings/browser/pages/interface-settings-page.tsx` ("Font" section),
`settings/browser/search/settings-search.ts`, `workbench/contributions/settings.ts`
(schema `.catch` + default), `primitives/app-settings/api/app-settings.ts` (type),
`apps/emdash-desktop/package.json` + `pnpm-lock.yaml` (font package).

## Tests

`ozdash/api/ui-font.test.ts` (schema default, ids, fallback, CSS variable map, no mono vars).

## Rebase notes

- If upstream renames `--em-font-sans` or changes the stock stack in
  `packages/ui/src/theme/tokens.css.ts`, update `STOCK_SANS` in `ui-font.ts`.
- If upstream changes how chat-ui measures text, re-check UF-4.
- If upstream adds its own font setting, drop the fork one and keep Geist bundled.

## Known gaps

- No free-text "Custom…" font.
- The boot splash uses the system font (before settings load).
