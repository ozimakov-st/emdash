import { describe, expect, it } from 'vitest';
import { initialReveal, nextReveal, revealPending } from './line-chunker';

const streaming = { streaming: true, holdMs: 300, catchUpLines: 4 };

describe('line chunker', () => {
  it('shows text that is already there at once when not streaming', () => {
    expect(initialReveal('a\nb', false, 0)).toEqual({ shown: 3, lastAdvanceAt: 0 });
  });

  it('starts a streaming message at its last complete line', () => {
    expect(initialReveal('one\ntwo\nthr', true, 0).shown).toBe(8);
    expect(initialReveal('partial', true, 0).shown).toBe(0);
  });

  it('reveals one complete line per tick', () => {
    const text = 'one\ntwo\n';
    let state = { shown: 0, lastAdvanceAt: 0 };
    state = nextReveal(text, state, 10, streaming);
    expect(text.slice(0, state.shown)).toBe('one\n');
    state = nextReveal(text, state, 20, streaming);
    expect(text.slice(0, state.shown)).toBe('one\ntwo\n');
    expect(revealPending(text, state)).toBe(false);
  });

  it('catches up when many lines wait', () => {
    const text = Array.from({ length: 12 }, (_, i) => `line ${i}\n`).join('');
    const state = nextReveal(text, { shown: 0, lastAdvanceAt: 0 }, 10, streaming);
    // 12 waiting lines, 4 per "catch up" chunk -> 3 lines at once
    expect(text.slice(0, state.shown).split('\n').length - 1).toBe(3);
  });

  it('holds a partial line, then shows it up to the last word', () => {
    const text = 'done\nhalf a sent';
    let state = { shown: 5, lastAdvanceAt: 0 };
    const held = nextReveal(text, state, 100, streaming);
    expect(held).toBe(state);
    state = nextReveal(text, state, 400, streaming);
    expect(text.slice(0, state.shown)).toBe('done\nhalf a ');
    expect(state.lastAdvanceAt).toBe(400);
  });

  it('shows everything once streaming ends', () => {
    const state = nextReveal('a\nbc', { shown: 2, lastAdvanceAt: 0 }, 5, { streaming: false });
    expect(state.shown).toBe(4);
  });

  it('clamps when the text gets shorter (replaced message)', () => {
    const state = nextReveal('ab', { shown: 10, lastAdvanceAt: 0 }, 5, streaming);
    expect(state.shown).toBe(2);
  });
});
