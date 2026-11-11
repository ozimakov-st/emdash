import { describe, expect, it } from 'vitest';
import {
  matchOptionValue,
  pickAllowOption,
  presetToAcpOptions,
  withAutoApproveMode,
  type AcpOptionCatalogEntry,
} from './acp-launch-options';

const claudeCatalog: AcpOptionCatalogEntry[] = [
  {
    id: 'mode',
    category: 'mode',
    type: 'select',
    options: [
      { value: 'default', name: 'Default' },
      { value: 'acceptEdits', name: 'Accept edits' },
      { value: 'bypassPermissions', name: 'Bypass permissions' },
    ],
  },
  {
    id: 'model',
    category: 'model',
    type: 'select',
    options: [
      { value: 'default', name: 'Default (recommended)' },
      { value: 'opus[1m]', name: 'Opus 5.5 (1M context)' },
      { value: 'sonnet', name: 'Sonnet 5' },
    ],
  },
  {
    id: 'effort',
    category: 'thought_level',
    type: 'select',
    options: [
      { value: 'low', name: 'Low' },
      { value: 'high', name: 'High' },
    ],
  },
];

describe('withAutoApproveMode', () => {
  it('adds the no-prompt mode for claude and codex', () => {
    expect(withAutoApproveMode('claude', undefined)).toEqual({ mode: 'bypassPermissions' });
    expect(withAutoApproveMode('codex', { model: 'x' })).toEqual({
      model: 'x',
      mode: 'agent-full-access',
    });
  });

  it('keeps a mode that was already chosen', () => {
    expect(withAutoApproveMode('claude', { mode: 'plan' })).toEqual({ mode: 'plan' });
  });

  it('leaves cursor alone (it runs with -f instead)', () => {
    expect(withAutoApproveMode('cursor', { model: 'auto' })).toEqual({ model: 'auto' });
  });

  it('uses the catalog when there is one', () => {
    expect(withAutoApproveMode('other', undefined, [claudeCatalog])).toEqual({
      mode: 'bypassPermissions',
    });
  });
});

describe('matchOptionValue', () => {
  const choices = claudeCatalog[1]!.options as Array<{ value: string; name: string }>;
  it('prefers exact, then loose, then partial matches', () => {
    expect(matchOptionValue(choices, 'sonnet')).toBe('sonnet');
    expect(matchOptionValue(choices, 'Sonnet 5')).toBe('sonnet');
    expect(matchOptionValue(choices, 'opus')).toBe('opus[1m]');
    expect(matchOptionValue(choices, 'haiku')).toBeNull();
    expect(matchOptionValue(choices, '  ')).toBeNull();
  });
});

describe('presetToAcpOptions', () => {
  it('maps model and effort through the catalog', () => {
    expect(
      presetToAcpOptions('claude', { model: 'opus', effort: 'high' }, [claudeCatalog])
    ).toEqual({
      options: { model: 'opus[1m]', effort: 'high' },
      model: 'opus[1m]',
      effort: 'high',
    });
  });

  it('drops values the catalog does not have', () => {
    expect(
      presetToAcpOptions('claude', { model: 'haiku', effort: 'max' }, [claudeCatalog])
    ).toEqual({ options: {}, model: null, effort: null });
  });

  it('uses known ids without a catalog (codex effort is reasoning_effort)', () => {
    expect(
      presetToAcpOptions('codex', { model: 'gpt-6.1-sol', effort: 'high' }, [], { mode: 'x' })
    ).toEqual({
      options: { mode: 'x', model: 'gpt-6.1-sol', reasoning_effort: 'high' },
      model: 'gpt-6.1-sol',
      effort: 'high',
    });
    // cursor has no effort option
    expect(presetToAcpOptions('cursor', { model: 'auto', effort: 'high' }).options).toEqual({
      model: 'auto',
    });
  });
});

describe('pickAllowOption', () => {
  it('prefers allow once, then allow always, then an approval-like name', () => {
    expect(
      pickAllowOption([
        { optionId: 'r', name: 'Reject', kind: 'reject_once' },
        { optionId: 'a', name: 'Always', kind: 'allow_always' },
        { optionId: 'o', name: 'Once', kind: 'allow_once' },
      ])
    ).toBe('o');
    expect(pickAllowOption([{ optionId: 'a', name: 'Always', kind: 'allow_always' }])).toBe('a');
    expect(
      pickAllowOption([
        { optionId: 'n', name: 'No, cancel', kind: 'other' },
        { optionId: 'y', name: 'Yes, proceed', kind: 'other' },
      ])
    ).toBe('y');
    expect(pickAllowOption([{ optionId: 'r', name: 'Reject', kind: 'reject_once' }])).toBeNull();
  });
});
