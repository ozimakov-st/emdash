// OZdash: which tasks need Oleg. A task needs attention when one of its agent
// conversations has news Oleg has not seen yet (the existing per-conversation
// `seen` flag, set when he opens the conversation; working again resets it):
//   - 'input': the agent waits for input (question or permission) or failed;
//   - 'done':  the agent finished (completed, or idle after work).
// 'input' wins over 'done'. A working conversation never needs attention.
import { reaction } from 'mobx';
import type { AgentStatus } from '@core/primitives/agents/api';

export type AttentionLevel = 'input' | 'done';

export interface ConversationAttentionState {
  readonly status: AgentStatus;
  readonly seen: boolean;
}

export function conversationAttention(
  conversation: ConversationAttentionState
): AttentionLevel | null {
  if (conversation.seen) return null;
  switch (conversation.status) {
    case 'awaiting-input':
    case 'error':
      return 'input';
    case 'completed':
    case 'idle':
      return 'done';
    case 'working':
      return null;
  }
}

export function taskAttention(
  conversations: Iterable<ConversationAttentionState>
): AttentionLevel | null {
  let level: AttentionLevel | null = null;
  for (const conversation of conversations) {
    const next = conversationAttention(conversation);
    if (next === 'input') return 'input';
    if (next) level = next;
  }
  return level;
}

/**
 * Row background for a task that needs attention (sidebar rows, the Sessions tab). The
 * warning background (amber-3) is pale, so a low opacity of it does not show: 'input'
 * uses it in full with an amber outline, 'done' uses it at 70%.
 */
export function attentionRowClass(level: AttentionLevel | null): string | false {
  if (level === 'input') return 'bg-background-warning ring-1 ring-inset ring-border-warning';
  if (level === 'done') return 'bg-background-warning/70';
  return false;
}

export function countNeedingAttention(levels: Iterable<AttentionLevel | null>): number {
  let count = 0;
  for (const level of levels) if (level) count += 1;
  return count;
}

/** Renderer -> main: the number of tasks that need attention (macOS Dock badge). */
export const OZDASH_ATTENTION_COUNT_CHANNEL = 'ozdash:attention-count';

const MAX_BADGE_COUNT = 9999;

/** A safe Dock badge number from an IPC value: a whole number from 0 to 9999, else 0. */
export function toBadgeCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
  return Math.min(Math.floor(value), MAX_BADGE_COUNT);
}

/**
 * Sends the attention count now and on every change (mobx-observable `read`).
 * Returns a function that stops watching and clears the badge.
 */
export function watchBadgeCount(read: () => number, send: (count: number) => void): () => void {
  const stop = reaction(read, (count) => send(toBadgeCount(count)), { fireImmediately: true });
  return () => {
    stop();
    send(0);
  };
}
