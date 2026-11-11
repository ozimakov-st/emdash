import { describe, expect, it } from 'vitest';
import { diffLines, foldContext } from './inline-diff';

describe('inline diff', () => {
  it('marks changed lines between unchanged ones', () => {
    expect(diffLines('a\nb\nc', 'a\nB\nc\nd')).toEqual([
      { kind: 'context', text: 'a' },
      { kind: 'del', text: 'b' },
      { kind: 'add', text: 'B' },
      { kind: 'context', text: 'c' },
      { kind: 'add', text: 'd' },
    ]);
  });

  it('treats a new file as all additions', () => {
    expect(diffLines(null, 'x\ny\n')).toEqual([
      { kind: 'add', text: 'x' },
      { kind: 'add', text: 'y' },
    ]);
  });

  it('folds long unchanged runs', () => {
    const before = ['1', '2', '3', '4', '5', '6', '7'].join('\n');
    const after = ['1', '2', '3', '4', '5', '6', 'X'].join('\n');
    const rows = foldContext(diffLines(before, after), 1);
    expect(rows[0]).toEqual({ kind: 'fold', count: 5 });
    expect(rows.slice(1)).toEqual([
      { kind: 'context', text: '6' },
      { kind: 'del', text: '7' },
      { kind: 'add', text: 'X' },
    ]);
  });
});
