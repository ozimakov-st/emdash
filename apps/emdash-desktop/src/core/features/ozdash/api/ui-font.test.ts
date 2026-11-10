import { describe, expect, it } from 'vitest';
import { interfaceSettingsContribution } from '@core/features/workbench/contributions/settings';
import { UI_FONT_CSS_VAR_NAMES, UI_FONT_IDS, UI_FONT_OPTIONS, uiFontCssVars } from './ui-font';

describe('uiFont setting schema', () => {
  const defaults = interfaceSettingsContribution.defaults as Record<string, unknown>;

  it('defaults to the stock font', () => {
    expect(defaults.uiFont).toBe('default');
  });

  it('accepts every known font id', () => {
    for (const id of UI_FONT_IDS) {
      const parsed = interfaceSettingsContribution.schema.parse({ ...defaults, uiFont: id });
      expect(parsed.uiFont).toBe(id);
    }
  });

  it('falls back to default for an unknown id without dropping other fields', () => {
    const parsed = interfaceSettingsContribution.schema.parse({
      ...defaults,
      hideContextBar: true,
      uiFont: 'comic-sans',
    });
    expect(parsed.uiFont).toBe('default');
    expect(parsed.hideContextBar).toBe(true);
  });
});

describe('uiFontCssVars', () => {
  it('sets nothing for the default font', () => {
    expect(uiFontCssVars('default')).toEqual({});
    expect(uiFontCssVars(undefined)).toEqual({});
  });

  it('puts Geist first in the sans stack and pins chat text to Inter', () => {
    const vars = uiFontCssVars('geist');
    expect(vars['--em-font-sans']).toMatch(/^'Geist Variable', 'Inter Variable'/);
    expect(vars['--chat-font-sans']).toBe("'Inter Variable', sans-serif");
  });

  it('uses the OS font stack for system', () => {
    expect(uiFontCssVars('system')['--em-font-sans']).toMatch(/^-apple-system, /);
  });

  it('never touches monospace and only sets known variables', () => {
    for (const id of UI_FONT_IDS) {
      for (const name of Object.keys(uiFontCssVars(id))) {
        expect(UI_FONT_CSS_VAR_NAMES).toContain(name);
        expect(name).not.toMatch(/mono/);
      }
    }
  });

  it('has one option per id', () => {
    expect(UI_FONT_OPTIONS.map((option) => option.id)).toEqual([...UI_FONT_IDS]);
  });
});
