// OZdash: the "UI font" setting (Settings → Interface). Pure data + mapping, no DOM.
import type { InterfaceSettings } from '@core/primitives/app-settings/api';

export type UiFontId = InterfaceSettings['uiFont'];

/** All choices. `default` keeps the stock font (Inter Variable) and sets no CSS variable. */
export const UI_FONT_IDS = ['default', 'geist', 'system'] as const satisfies readonly UiFontId[];

export const UI_FONT_DEFAULT: UiFontId = 'default';

export const UI_FONT_OPTIONS: ReadonlyArray<{ id: UiFontId; label: string; preview: string }> = [
  { id: 'default', label: 'Default (Inter)', preview: "'Inter Variable', sans-serif" },
  { id: 'geist', label: 'Geist', preview: "'Geist Variable', sans-serif" },
  { id: 'system', label: 'System font', preview: 'system-ui, sans-serif' },
];

/** Stock value of @emdash/ui's --em-font-sans (packages/ui/src/theme/tokens.css.ts). */
const STOCK_SANS = "'Inter Variable', sans-serif";

const FONT_STACKS: Record<Exclude<UiFontId, 'default'>, string> = {
  geist: `'Geist Variable', ${STOCK_SANS}`,
  system: `-apple-system, BlinkMacSystemFont, system-ui, 'Segoe UI', ${STOCK_SANS}`,
};

/**
 * CSS custom properties to set on the root element for a UI font, or `{}` for
 * the default. --em-font-sans feeds every --em-type-*-font-family token and the
 * body font. Monospace (--em-font-mono) is never touched.
 *
 * --chat-font-sans is pinned to the stock Inter stack: chat-theme.css binds it to
 * --em-font-sans, but the chat transcript measures text with Inter (chat-ui
 * DEFAULT_CONFIG), so a different font there would break line wrapping.
 */
export function uiFontCssVars(id: UiFontId | undefined): Record<string, string> {
  if (!id || id === 'default') return {};
  const stack = FONT_STACKS[id];
  if (!stack) return {};
  return { '--em-font-sans': stack, '--chat-font-sans': STOCK_SANS };
}

/** Every property uiFontCssVars can set, so a switch back to default can remove them. */
export const UI_FONT_CSS_VAR_NAMES = ['--em-font-sans', '--chat-font-sans'] as const;
