import { describe, expect, it } from 'vitest';
import {
  quickSwitchDigit,
  quickSwitchDigitFor,
  quickSwitchIndex,
  quickSwitchTarget,
} from './quick-switch';

const rows = Array.from({ length: 12 }, (_, i) => `task-${i + 1}`);

describe('quick switch', () => {
  it('maps row indexes to keys 1…9, 0', () => {
    expect([0, 1, 8, 9].map(quickSwitchDigit)).toEqual(['1', '2', '9', '0']);
    expect(quickSwitchDigit(10)).toBeNull();
    expect(quickSwitchDigit(-1)).toBeNull();
  });

  it('maps keys back to row indexes', () => {
    expect(['1', '2', '9', '0'].map(quickSwitchIndex)).toEqual([0, 1, 8, 9]);
    expect(quickSwitchIndex('a')).toBeNull();
    expect(quickSwitchIndex('10')).toBeNull();
  });

  it('opens rows in sidebar order: Cmd+1 the first, Cmd+0 the 10th', () => {
    expect(quickSwitchTarget(rows, quickSwitchIndex('1')!)).toBe('task-1');
    expect(quickSwitchTarget(rows, quickSwitchIndex('9')!)).toBe('task-9');
    expect(quickSwitchTarget(rows, quickSwitchIndex('0')!)).toBe('task-10');
    expect(quickSwitchTarget(rows, 10)).toBeNull();
  });

  it('has no target past the end of a short list', () => {
    expect(quickSwitchTarget(['a', 'b'], 2)).toBeNull();
  });

  it('labels only the first 10 rows', () => {
    expect(quickSwitchDigitFor(rows, (row) => row === 'task-1')).toBe('1');
    expect(quickSwitchDigitFor(rows, (row) => row === 'task-10')).toBe('0');
    expect(quickSwitchDigitFor(rows, (row) => row === 'task-11')).toBeNull();
    expect(quickSwitchDigitFor(rows, (row) => row === 'missing')).toBeNull();
  });
});
