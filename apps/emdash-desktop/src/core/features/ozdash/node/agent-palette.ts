// Fork (ozimakov-st): reads the agent palette (`<vault>/context/agents.md`, see
// api/agent-palette.ts). The file is read on every call, so edits apply right away.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  AGENT_PALETTE_FILE,
  parseAgentPalette,
  pmPreset,
  PM_PRESET_FALLBACK,
  PM_PRESET_NAME,
  type AgentPreset,
} from '../api/agent-palette';

/** The palette's presets; empty when the file is missing or unreadable. */
export async function readAgentPalette(vaultPath: string): Promise<AgentPreset[]> {
  try {
    return parseAgentPalette(await readFile(join(vaultPath, AGENT_PALETTE_FILE), 'utf8'));
  } catch {
    return [];
  }
}

/** What a ticket's PM session starts with (MCP create_task fields). */
export type PmSessionLaunch = {
  provider: string;
  model?: string;
  effort?: string;
  autoApprove: true;
  /** Set when the palette's `pm` row was not usable and the fallback was used. */
  warning?: string;
};

/**
 * The palette's `pm` row (claude + opus when the file or row is missing), always with
 * auto-approve. A row with an unknown agent also falls back, with a warning.
 */
export async function resolvePmSessionLaunch(
  vaultPath: string,
  isKnownProvider: (providerId: string) => boolean
): Promise<PmSessionLaunch> {
  let preset = pmPreset(await readAgentPalette(vaultPath));
  let warning: string | undefined;
  if (!isKnownProvider(preset.provider)) {
    warning = `Agent palette: unknown agent "${preset.provider}" in the ${PM_PRESET_NAME} row; using ${PM_PRESET_FALLBACK.provider} + ${PM_PRESET_FALLBACK.model}`;
    preset = PM_PRESET_FALLBACK;
  }
  return {
    provider: preset.provider,
    ...(preset.model && { model: preset.model }),
    ...(preset.effort && { effort: preset.effort }),
    autoApprove: true,
    ...(warning && { warning }),
  };
}
