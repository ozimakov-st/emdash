import { observable, runInAction } from 'mobx';
import { describe, expect, it } from 'vitest';
import type { AgentStatus } from '@core/primitives/agents/api';
import {
  conversationAttention,
  countNeedingAttention,
  taskAttention,
  toBadgeCount,
  watchBadgeCount,
} from './attention';

const unseen = (status: AgentStatus) => ({ status, seen: false });
const seen = (status: AgentStatus) => ({ status, seen: true });

describe('conversationAttention', () => {
  it('asks for input when the agent waits or failed and Oleg has not seen it', () => {
    expect(conversationAttention(unseen('awaiting-input'))).toBe('input');
    expect(conversationAttention(unseen('error'))).toBe('input');
  });

  it('marks unseen finished work as done', () => {
    expect(conversationAttention(unseen('completed'))).toBe('done');
    expect(conversationAttention(unseen('idle'))).toBe('done');
  });

  it('never flags a working agent', () => {
    expect(conversationAttention(unseen('working'))).toBeNull();
    expect(conversationAttention(seen('working'))).toBeNull();
  });

  it('clears once Oleg has seen the conversation', () => {
    for (const status of ['awaiting-input', 'error', 'completed', 'idle'] as const) {
      expect(conversationAttention(seen(status))).toBeNull();
    }
  });
});

describe('taskAttention', () => {
  it('is null for a task without conversations', () => {
    expect(taskAttention([])).toBeNull();
  });

  it('prefers input over done, whatever the order', () => {
    expect(taskAttention([unseen('completed'), unseen('awaiting-input')])).toBe('input');
    expect(taskAttention([unseen('error'), unseen('completed')])).toBe('input');
  });

  it('is done when only finished work is unseen', () => {
    expect(taskAttention([seen('awaiting-input'), unseen('completed')])).toBe('done');
  });

  it('still flags one waiting conversation while another one works', () => {
    expect(taskAttention([unseen('working'), unseen('awaiting-input')])).toBe('input');
  });

  it('is null when everything is seen or working', () => {
    expect(taskAttention([seen('completed'), unseen('working')])).toBeNull();
  });
});

describe('countNeedingAttention', () => {
  it('counts tasks with any level', () => {
    expect(countNeedingAttention([])).toBe(0);
    expect(countNeedingAttention(['input', null, 'done', null])).toBe(2);
  });
});

describe('toBadgeCount', () => {
  it('passes whole positive numbers through', () => {
    expect(toBadgeCount(3)).toBe(3);
  });

  it('returns 0 (clears the badge) for zero and bad input', () => {
    for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, '3', null, undefined]) {
      expect(toBadgeCount(value)).toBe(0);
    }
  });

  it('rounds down and caps', () => {
    expect(toBadgeCount(2.7)).toBe(2);
    expect(toBadgeCount(123_456)).toBe(9999);
  });
});

describe('watchBadgeCount', () => {
  it('sends the count at start, on change, and 0 when stopped', () => {
    const count = observable.box(2);
    const sent: number[] = [];
    const stop = watchBadgeCount(
      () => count.get(),
      (value) => sent.push(value)
    );
    runInAction(() => count.set(2)); // same value: no new send
    runInAction(() => count.set(0));
    runInAction(() => count.set(5));
    stop();
    expect(sent).toEqual([2, 0, 5, 0]);
  });
});
