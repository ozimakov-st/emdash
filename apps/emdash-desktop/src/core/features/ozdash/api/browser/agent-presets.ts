// Fork (ozimakov-st): the agent palette in the renderer, read from the main process
// (`window.ozdash.listAgentPresets`). Read again each time a dialog mounts, so edits to
// the vault file show up without a restart.
import { useQuery } from '@tanstack/react-query';
import type { AgentPreset } from '../agent-palette';
import type { OzdashTicketsBridge } from '../tickets';

function bridge(): Partial<OzdashTicketsBridge> | undefined {
  return (globalThis as { ozdash?: Partial<OzdashTicketsBridge> }).ozdash;
}

/** The palette's presets; empty outside Electron or when the file is missing. */
export function useAgentPresets(): AgentPreset[] {
  const { data } = useQuery({
    queryKey: ['ozdash', 'agent-presets'],
    queryFn: async () => (await bridge()?.listAgentPresets?.()) ?? [],
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
  });
  return data ?? [];
}
