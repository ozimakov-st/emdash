// Fork (ozimakov-st): Settings → Interface → Agent sessions → "New sessions start in".
import { SettingsCard, SettingsRow } from '@emdash/ui/react/patterns';
import { Select } from '@emdash/ui/react/primitives';
import {
  SESSION_MODE_OPTIONS,
  normalizeSessionMode,
  type SessionMode,
} from '@core/features/ozdash/api/chat/session-mode';
import { useAppSettingsKey } from '@core/features/settings/api/browser/use-app-settings-key';

/** The global session mode (OZ chat by default). */
export function useSessionMode(): SessionMode {
  const { value } = useAppSettingsKey('interface');
  return normalizeSessionMode(value?.sessionMode);
}

export function SessionModeSettingsCard() {
  const { value, update, isLoading, isSaving } = useAppSettingsKey('interface');
  const mode = normalizeSessionMode(value?.sessionMode);
  const selected =
    SESSION_MODE_OPTIONS.find((option) => option.id === mode) ?? SESSION_MODE_OPTIONS[0]!;

  return (
    <SettingsCard>
      <SettingsRow
        label="New sessions start in"
        description="Chat modes fall back to the terminal for agents without chat support. Each chat tab can switch between OZ chat and Emdash chat."
        control={
          <Select.Root
            value={mode}
            onValueChange={(next) => update({ sessionMode: normalizeSessionMode(next) })}
            disabled={isLoading || isSaving}
          >
            <Select.Trigger className="w-[183px] shrink-0 gap-2 [&>span]:line-clamp-none">
              <Select.Value>{selected.label}</Select.Value>
            </Select.Trigger>
            <Select.Content align="end" className="min-w-max">
              {SESSION_MODE_OPTIONS.map((option) => (
                <Select.Item key={option.id} value={option.id}>
                  {option.label}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
        }
      />
    </SettingsCard>
  );
}
