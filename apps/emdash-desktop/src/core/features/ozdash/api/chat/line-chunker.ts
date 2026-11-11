// Fork (ozimakov-st): OZ chat smooth streaming. Agents send text in small, uneven
// pieces. The renderer shows it line by line instead: complete lines come out at a
// steady pace (faster when many are waiting), and a long line still in progress comes
// out at a word boundary after a short hold, so text never looks stuck.

export type RevealState = {
  /** Characters of the text that are shown. */
  shown: number;
  /** When `shown` last moved (ms). */
  lastAdvanceAt: number;
};

export type RevealOptions = {
  /** True while the agent may still add to the text. */
  streaming: boolean;
  /** How long a partial line may wait before it is shown up to its last word (ms). */
  holdMs?: number;
  /** Waiting lines above which more than one line is shown per tick. */
  catchUpLines?: number;
};

export const REVEAL_TICK_MS = 40;
const DEFAULT_HOLD_MS = 300;
const DEFAULT_CATCH_UP_LINES = 6;

export function initialReveal(text: string, streaming: boolean, now: number): RevealState {
  // Text that is already there when a message mounts (history, tab switch) is shown at
  // once; only text that arrives later is paced.
  return { shown: streaming ? lastLineEnd(text, 0) : text.length, lastAdvanceAt: now };
}

/** Index just after the last newline in text[from..], or `from` when there is none. */
function lastLineEnd(text: string, from: number): number {
  const index = text.lastIndexOf('\n');
  return index >= from ? index + 1 : from;
}

/** Ends (index after '\n') of the complete lines in text[from..]. */
function lineEnds(text: string, from: number): number[] {
  const ends: number[] = [];
  let index = text.indexOf('\n', from);
  while (index !== -1) {
    ends.push(index + 1);
    index = text.indexOf('\n', index + 1);
  }
  return ends;
}

/** One step of the reveal. Returns the same object when nothing changes. */
export function nextReveal(
  text: string,
  state: RevealState,
  now: number,
  options: RevealOptions
): RevealState {
  const shown = Math.min(state.shown, text.length);
  if (!options.streaming) {
    return shown === text.length && shown === state.shown
      ? state
      : { shown: text.length, lastAdvanceAt: now };
  }
  if (shown === text.length) return shown === state.shown ? state : { ...state, shown };

  const ends = lineEnds(text, shown);
  if (ends.length > 0) {
    const catchUp = options.catchUpLines ?? DEFAULT_CATCH_UP_LINES;
    const step = Math.max(1, Math.ceil(ends.length / catchUp));
    return { shown: ends[Math.min(step, ends.length) - 1]!, lastAdvanceAt: now };
  }

  // Only a partial line is waiting.
  if (now - state.lastAdvanceAt < (options.holdMs ?? DEFAULT_HOLD_MS)) {
    return shown === state.shown ? state : { ...state, shown };
  }
  const tail = text.slice(shown);
  const wordEnd = tail.search(/\s\S*$/);
  if (wordEnd <= 0) return shown === state.shown ? state : { ...state, shown };
  return { shown: shown + wordEnd + 1, lastAdvanceAt: now };
}

/** True while there is text left to show. */
export function revealPending(text: string, state: RevealState): boolean {
  return state.shown < text.length;
}
