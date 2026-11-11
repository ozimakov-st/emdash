// Fork (ozimakov-st): Cmd+1…9, Cmd+0 open the first 10 task rows of the sidebar
// (top to bottom: PM sessions first, then direct tasks).

export const QUICK_SWITCH_SLOTS = 10;

/** The key for a row index: 0…8 → "1"…"9", 9 → "0"; null past the 10th row. */
export function quickSwitchDigit(index: number): string | null {
  if (!Number.isInteger(index) || index < 0 || index >= QUICK_SWITCH_SLOTS) return null;
  return String((index + 1) % 10);
}

/** The row index for a key: "1"…"9" → 0…8, "0" → 9; null for anything else. */
export function quickSwitchIndex(digit: string): number | null {
  if (!/^[0-9]$/.test(digit)) return null;
  const value = Number(digit);
  return value === 0 ? 9 : value - 1;
}

/** The row a slot opens (0-based), or null when there is none. */
export function quickSwitchTarget<T>(rows: readonly T[], index: number): T | null {
  if (quickSwitchDigit(index) === null) return null;
  return rows[index] ?? null;
}

/** The key shown on a row, or null when the row is not one of the first 10. */
export function quickSwitchDigitFor<T>(
  rows: readonly T[],
  isRow: (row: T) => boolean
): string | null {
  const index = rows.slice(0, QUICK_SWITCH_SLOTS).findIndex(isRow);
  return index === -1 ? null : quickSwitchDigit(index);
}
