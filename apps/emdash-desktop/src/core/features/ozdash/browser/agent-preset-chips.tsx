// Fork (ozimakov-st): the agent palette as chips in the New Task dialog (like Conductor's
// quick model switch). A click sets provider + model (+ effort) and turns auto-approve on.
// The palette is the vault file context/agents.md (see api/agent-palette.ts).
import type { AgentProviderId } from '@emdash/plugins/agents/types';
import { ToggleGroup, Tooltip } from '@emdash/ui/react/primitives';
import { AgentIcon } from '@core/features/agents/contributions/browser/agent-icon';
import { activePresetName, type AgentPreset } from '@core/features/ozdash/api/agent-palette';
import { useAgentPresets } from '@core/features/ozdash/api/browser/agent-presets';

export type AgentPresetChipsProps = {
  provider: string | null;
  model: string | null;
  effort: string | null;
  /** Provider ids that exist here; presets for other agents are hidden. */
  knownProviders: ReadonlySet<string>;
  onPick: (preset: {
    provider: AgentProviderId;
    model: string | null;
    effort: string | null;
  }) => void;
};

function presetTitle(preset: AgentPreset): string {
  const parts = [preset.provider, preset.model ?? 'default model'];
  if (preset.effort) parts.push(`effort ${preset.effort}`);
  return `${parts.join(' · ')}${preset.useFor ? ` — ${preset.useFor}` : ''}`;
}

export function AgentPresetChips({
  provider,
  model,
  effort,
  knownProviders,
  onPick,
}: AgentPresetChipsProps) {
  const presets = useAgentPresets().filter((preset) => knownProviders.has(preset.provider));
  if (presets.length === 0) return null;
  const active = activePresetName(presets, { provider, model, effort });

  return (
    <ToggleGroup.Root
      aria-label="Agent presets"
      className="flex flex-wrap gap-1"
      value={active ? [active] : []}
      onValueChange={(values: string[]) => {
        const picked = presets.find((preset) => preset.name === values[0]);
        if (picked)
          onPick({
            provider: picked.provider as AgentProviderId,
            model: picked.model,
            effort: picked.effort,
          });
      }}
    >
      {presets.map((preset) => (
        <Tooltip.Root key={preset.name}>
          <Tooltip.Trigger
            render={
              <ToggleGroup.Item
                size="xs"
                value={preset.name}
                aria-label={`Preset ${preset.name}`}
                className="gap-1 rounded-full border border-border px-2"
              >
                <AgentIcon id={preset.provider} size={12} />
                {preset.name}
              </ToggleGroup.Item>
            }
          />
          <Tooltip.Content>{presetTitle(preset)}</Tooltip.Content>
        </Tooltip.Root>
      ))}
    </ToggleGroup.Root>
  );
}
