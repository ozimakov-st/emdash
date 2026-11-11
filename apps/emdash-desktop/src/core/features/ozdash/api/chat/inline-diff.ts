// Fork (ozimakov-st): OZ chat inline diffs for edit rows. A plain LCS line diff with
// context folding. Edits from agents are small, so O(n·m) is fine; past a size cap the
// diff shows the old block removed and the new block added.

export type DiffLine = { kind: 'context' | 'add' | 'del'; text: string };
export type DiffRow = DiffLine | { kind: 'fold'; count: number };

const MAX_CELLS = 250_000;

function lines(text: string | null): string[] {
  if (!text) return [];
  return text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
}

export function diffLines(oldText: string | null, newText: string): DiffLine[] {
  const a = lines(oldText);
  const b = lines(newText);
  if (a.length * b.length > MAX_CELLS) {
    return [
      ...a.map((text) => ({ kind: 'del' as const, text })),
      ...b.map((text) => ({ kind: 'add' as const, text })),
    ];
  }
  // lcs[i][j] = LCS length of a[i..], b[j..]
  const width = b.length + 1;
  const lcs = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i * width + j] =
        a[i] === b[j]
          ? lcs[(i + 1) * width + j + 1]! + 1
          : Math.max(lcs[(i + 1) * width + j]!, lcs[i * width + j + 1]!);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: 'context', text: a[i]! });
      i++;
      j++;
    } else if (lcs[(i + 1) * width + j]! >= lcs[i * width + j + 1]!) {
      out.push({ kind: 'del', text: a[i++]! });
    } else {
      out.push({ kind: 'add', text: b[j++]! });
    }
  }
  while (i < a.length) out.push({ kind: 'del', text: a[i++]! });
  while (j < b.length) out.push({ kind: 'add', text: b[j++]! });
  return out;
}

/** Keeps `context` unchanged lines around each change; longer runs become a fold row. */
export function foldContext(diff: readonly DiffLine[], context = 2): DiffRow[] {
  const keep = diff.map((line) => line.kind !== 'context');
  const near = diff.map((_, index) => {
    for (let k = Math.max(0, index - context); k <= Math.min(diff.length - 1, index + context); k++)
      if (keep[k]) return true;
    return false;
  });
  const rows: DiffRow[] = [];
  let folded = 0;
  diff.forEach((line, index) => {
    if (near[index]) {
      if (folded) rows.push({ kind: 'fold', count: folded });
      folded = 0;
      rows.push(line);
    } else {
      folded++;
    }
  });
  if (folded) rows.push({ kind: 'fold', count: folded });
  return rows;
}
