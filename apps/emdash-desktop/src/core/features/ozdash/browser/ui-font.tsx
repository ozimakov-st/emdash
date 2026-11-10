// OZdash: the "UI font" setting row and the root hook that applies it.
import '@fontsource-variable/geist/index.css';
import { SettingsCard, SettingsRow } from '@emdash/ui/react/patterns';
import { Select } from '@emdash/ui/react/primitives';
import { useEffect } from 'react';
import {
  UI_FONT_CSS_VAR_NAMES,
  UI_FONT_DEFAULT,
  UI_FONT_OPTIONS,
  uiFontCssVars,
  type UiFontId,
} from '@core/features/ozdash/api/ui-font';
import { useAppSettingsKey } from '@core/features/settings/api/browser/use-app-settings-key';

/** Mount once near the app root: keeps the root CSS font variables in sync with the setting. */
export function useApplyUiFont(): void {
  const { value } = useAppSettingsKey('interface');
  const uiFont = value?.uiFont ?? UI_FONT_DEFAULT;

  useEffect(() => {
    const style = document.documentElement.style;
    const vars = uiFontCssVars(uiFont);
    for (const name of UI_FONT_CSS_VAR_NAMES) {
      const next = vars[name];
      if (next) style.setProperty(name, next);
      else style.removeProperty(name);
    }
  }, [uiFont]);
}

export function UiFontSettingsCard() {
  const { value, update, isLoading, isSaving } = useAppSettingsKey('interface');
  const uiFont = value?.uiFont ?? UI_FONT_DEFAULT;
  const selected = UI_FONT_OPTIONS.find((option) => option.id === uiFont) ?? UI_FONT_OPTIONS[0];

  return (
    <SettingsCard>
      <SettingsRow
        label="UI font"
        description="Font for the app interface. Code, terminal and chat text keep their fonts."
        control={
          <Select.Root
            value={uiFont}
            onValueChange={(next) => update({ uiFont: next as UiFontId })}
            disabled={isLoading || isSaving}
          >
            <Select.Trigger className="w-[183px] shrink-0 gap-2 [&>span]:line-clamp-none">
              <Select.Value>{selected.label}</Select.Value>
            </Select.Trigger>
            <Select.Content align="end" className="min-w-max">
              {UI_FONT_OPTIONS.map((option) => (
                <Select.Item key={option.id} value={option.id}>
                  <span style={{ fontFamily: option.preview }}>{option.label}</span>
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
        }
      />
    </SettingsCard>
  );
}
