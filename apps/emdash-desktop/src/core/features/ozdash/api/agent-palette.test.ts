import { describe, expect, it } from 'vitest';
import { activePresetName, parseAgentPalette, PM_PRESET_FALLBACK, pmPreset } from './agent-palette';

const PALETTE = `# Agent palette

Some text.

| name | agent | model | effort | use for |
|---|---|---|---|---|
| pm | claude | opus | | PM sessions |
| quick | claude | sonnet | | small tasks |
| review-grok | cursor | \`cursor-grok-4.6-high\` | | code review |
| review-gpt | Codex | gpt-6.1-sol | high | code review (deep) |
| | claude | sonnet | | no name: skipped |
| quick | codex | gpt-6-luna | | repeated name: skipped |

Rules:
- | not | a | table | row |
`;

describe('parseAgentPalette', () => {
  it('reads the rows of the first name/agent table in order', () => {
    expect(parseAgentPalette(PALETTE)).toEqual([
      { name: 'pm', provider: 'claude', model: 'opus', effort: null, useFor: 'PM sessions' },
      { name: 'quick', provider: 'claude', model: 'sonnet', effort: null, useFor: 'small tasks' },
      {
        name: 'review-grok',
        provider: 'cursor',
        model: 'cursor-grok-4.6-high',
        effort: null,
        useFor: 'code review',
      },
      {
        name: 'review-gpt',
        provider: 'codex',
        model: 'gpt-6.1-sol',
        effort: 'high',
        useFor: 'code review (deep)',
      },
    ]);
  });

  it('maps columns by header name, and allows missing optional columns', () => {
    const markdown = '| agent | name |\n|:--|--:|\n| codex | gpt |\n';
    expect(parseAgentPalette(markdown)).toEqual([
      { name: 'gpt', provider: 'codex', model: null, effort: null, useFor: '' },
    ]);
  });

  it('returns no presets without a palette table', () => {
    expect(parseAgentPalette('# Nothing\n\n| a | b |\n|---|---|\n| 1 | 2 |\n')).toEqual([]);
    expect(parseAgentPalette('')).toEqual([]);
  });
});

describe('pmPreset', () => {
  it('uses the pm row, else claude + opus', () => {
    expect(pmPreset(parseAgentPalette(PALETTE))).toMatchObject({
      provider: 'claude',
      model: 'opus',
    });
    expect(pmPreset([])).toBe(PM_PRESET_FALLBACK);
    expect(PM_PRESET_FALLBACK).toMatchObject({ provider: 'claude', model: 'opus', effort: null });
  });
});

describe('activePresetName', () => {
  const presets = parseAgentPalette(PALETTE);

  it('matches provider, model and effort', () => {
    expect(
      activePresetName(presets, { provider: 'codex', model: 'gpt-6.1-sol', effort: 'high' })
    ).toBe('review-gpt');
    expect(activePresetName(presets, { provider: 'claude', model: 'sonnet' })).toBe('quick');
  });

  it('is null when nothing matches', () => {
    expect(activePresetName(presets, { provider: 'codex', model: 'gpt-6.1-sol' })).toBeNull();
    expect(activePresetName(presets, { provider: null, model: null })).toBeNull();
  });
});
