// Fork (ozimakov-st): Oleg's agent palette, named agent + model presets in the vault file
// `context/agents.md`. A markdown table:
//
//   | name | agent | model | effort | use for |
//   |---|---|---|---|---|
//   | pm | claude | opus | | PM sessions |
//
// `agent` is the OZdash provider id, `model` the id the agent CLI accepts, `effort` an
// optional reasoning effort. The PM session of a ticket uses the `pm` row; the New Task
// dialog shows every row as a quick-pick chip. Shared by the main process and the renderer.

/** The palette file, relative to the vault. */
export const AGENT_PALETTE_FILE = 'context/agents.md';

/** The row the board uses for a ticket's PM session. */
export const PM_PRESET_NAME = 'pm';

export type AgentPreset = {
  name: string;
  /** OZdash agent provider id, e.g. `claude`, `codex`, `cursor`. */
  provider: string;
  /** Model id for the agent CLI; null = the CLI default. */
  model: string | null;
  /** Reasoning effort, e.g. `high`; null = the CLI default. */
  effort: string | null;
  useFor: string;
};

/** PM session settings when the palette file or its `pm` row is missing. */
export const PM_PRESET_FALLBACK: AgentPreset = {
  name: PM_PRESET_NAME,
  provider: 'claude',
  model: 'opus',
  effort: null,
  useFor: 'PM sessions (built-in fallback)',
};

function cellsOf(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|')) return null;
  const inner = trimmed.endsWith('|') ? trimmed.slice(1, -1) : trimmed.slice(1);
  return inner.split('|').map((cell) =>
    cell
      .trim()
      .replace(/^`+|`+$/g, '')
      .trim()
  );
}

const isSeparator = (cells: string[]) => cells.every((cell) => /^:?-+:?$/.test(cell));

/**
 * The presets of the first table with `name` and `agent` columns, in file order. Rows
 * without a name or agent are skipped; a repeated name keeps its first row.
 */
export function parseAgentPalette(markdown: string): AgentPreset[] {
  const lines = markdown.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const header = cellsOf(lines[i]!)?.map((cell) => cell.toLowerCase());
    if (!header) continue;
    const column = (name: string) => header.indexOf(name);
    const [nameCol, agentCol] = [column('name'), column('agent')];
    if (nameCol < 0 || agentCol < 0) continue;
    const [modelCol, effortCol, useForCol] = [column('model'), column('effort'), column('use for')];

    const presets: AgentPreset[] = [];
    const seen = new Set<string>();
    for (let j = i + 1; j < lines.length; j++) {
      const cells = cellsOf(lines[j]!);
      if (!cells) break; // The table ends at the first line that is not a row.
      if (isSeparator(cells)) continue;
      const cell = (index: number) => (index >= 0 ? (cells[index] ?? '') : '');
      const name = cell(nameCol);
      const provider = cell(agentCol).toLowerCase();
      if (!name || !provider || seen.has(name)) continue;
      seen.add(name);
      presets.push({
        name,
        provider,
        model: cell(modelCol) || null,
        effort: cell(effortCol) || null,
        useFor: cell(useForCol),
      });
    }
    return presets;
  }
  return [];
}

/** The `pm` row, or the built-in fallback (claude + opus). */
export function pmPreset(presets: readonly AgentPreset[]): AgentPreset {
  return presets.find((preset) => preset.name === PM_PRESET_NAME) ?? PM_PRESET_FALLBACK;
}

/** The first preset that matches this provider + model + effort, or null. */
export function activePresetName(
  presets: readonly AgentPreset[],
  selection: { provider: string | null; model: string | null; effort?: string | null }
): string | null {
  const match = presets.find(
    (preset) =>
      preset.provider === selection.provider &&
      preset.model === (selection.model ?? null) &&
      preset.effort === (selection.effort ?? null)
  );
  return match?.name ?? null;
}
