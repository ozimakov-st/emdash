import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readAgentPalette, resolvePmSessionLaunch } from './agent-palette';

const known = (id: string) => ['claude', 'codex', 'cursor'].includes(id);

describe('agent palette (node)', () => {
  let vault: string;

  beforeEach(async () => {
    vault = await mkdtemp(join(tmpdir(), 'oz-palette-'));
  });
  afterEach(async () => {
    await rm(vault, { recursive: true, force: true });
  });

  async function writePalette(rows: string[]) {
    await mkdir(join(vault, 'context'), { recursive: true });
    const table = ['| name | agent | model | effort | use for |', '|---|---|---|---|---|', ...rows];
    await writeFile(
      join(vault, 'context', 'agents.md'),
      `# Agent palette\n\n${table.join('\n')}\n`
    );
  }

  it('reads no presets when the file is missing', async () => {
    expect(await readAgentPalette(vault)).toEqual([]);
  });

  it('starts PM sessions with the pm row and auto-approve', async () => {
    await writePalette(['| pm | codex | gpt-6.1-sol | high | PM |']);
    expect(await resolvePmSessionLaunch(vault, known)).toEqual({
      provider: 'codex',
      model: 'gpt-6.1-sol',
      effort: 'high',
      autoApprove: true,
    });
  });

  it('falls back to claude + opus when the file or the pm row is missing', async () => {
    const fallback = { provider: 'claude', model: 'opus', autoApprove: true };
    expect(await resolvePmSessionLaunch(vault, known)).toEqual(fallback);
    await writePalette(['| quick | claude | sonnet | | small |']);
    expect(await resolvePmSessionLaunch(vault, known)).toEqual(fallback);
  });

  it('falls back with a warning when the pm row names an unknown agent', async () => {
    await writePalette(['| pm | nope | x | | PM |']);
    const launch = await resolvePmSessionLaunch(vault, known);
    expect(launch).toMatchObject({ provider: 'claude', model: 'opus', autoApprove: true });
    expect(launch.warning).toContain('unknown agent "nope"');
  });
});
