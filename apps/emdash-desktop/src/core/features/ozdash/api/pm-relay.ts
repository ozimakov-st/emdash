// OZdash: tell a ticket's PM session when one of the ticket's other sessions (an executor
// or a reviewer conversation in a child task) comes back: awaiting input, completed or
// error. The rule:
//   - Only a real transition counts: the same state again does not, working re-arms the
//     conversation, and Claude's idle_prompt after a stop is the same finished turn.
//   - The state must hold for `debounceMs` (20 s) before it is relayed, so a short
//     permission prompt that is answered at once does not reach the PM.
//   - At most one message per transition.
//   - The message waits while the PM session is working, and goes out when it is not.
//     Messages that wait together go out as one message (one line each).
// The main process runs it (main/host/ozdash-pm-relay.ts). Turn off: OZDASH_PM_RELAY=off.
import type { AgentStatus } from '@core/primitives/agents/api';
import { statusFromAgentEvent, type AttentionTransitionEvent } from './attention-chime';

export const PM_RELAY_DEBOUNCE_MS = 20_000;
/** How often the main process checks for due transitions and idle PM sessions. */
export const PM_RELAY_TICK_MS = 5_000;

export type RelayStatus = Extract<AgentStatus, 'awaiting-input' | 'completed' | 'error'>;

export type RelayEvent = AttentionTransitionEvent & { projectId: string };

/** A transition that held long enough and should go to the PM session. */
export type DueTransition = {
  projectId: string;
  taskId: string;
  conversationId: string;
  status: RelayStatus;
};

/** False when `OZDASH_PM_RELAY` is `off` (or `0`, `false`, `no`). */
export function pmRelayEnabled(env: Record<string, string | undefined>): boolean {
  const value = env.OZDASH_PM_RELAY?.trim().toLowerCase();
  return !value || !['off', '0', 'false', 'no'].includes(value);
}

/** The one-line message for the PM session. */
export function relayMessage(input: {
  ticketId: string;
  taskName: string;
  projectName: string;
  conversation: string;
  status: RelayStatus;
  taskId: string;
  conversationId: string;
}): string {
  return (
    `[OZdash] Ticket #${input.ticketId} · ${input.taskName} (${input.projectName}) · ` +
    `${input.conversation} is now ${input.status}. ` +
    `Run: emdash-oz status ${input.taskId} --conversation ${input.conversationId}`
  );
}

type ConversationState = {
  /** The status last relayed (or skipped as a repeat); null after working. */
  announced: RelayStatus | null;
  pending: (DueTransition & { since: number }) | null;
};

/** Tracks each conversation's transitions and holds them for the debounce time. */
export function createPmRelayTracker(debounceMs = PM_RELAY_DEBOUNCE_MS) {
  const states = new Map<string, ConversationState>();

  return {
    /** Called for every live agent event, in order. */
    track(event: RelayEvent, now: number): void {
      const status = statusFromAgentEvent(event);
      if (!status) return;
      const key = `${event.taskId}:${event.conversationId}`;
      const state = states.get(key) ?? { announced: null, pending: null };
      states.set(key, state);
      if (status === 'working') {
        state.announced = null;
        state.pending = null;
        return;
      }
      if (status === 'idle') return;
      const current = state.pending?.status ?? state.announced;
      if (current === status) return;
      // Claude sends idle_prompt about 60 s after it stops: the same finished turn.
      if (
        current === 'completed' &&
        event.type === 'notification' &&
        event.payload.notificationType === 'idle_prompt'
      ) {
        return;
      }
      state.pending = {
        projectId: event.projectId,
        taskId: event.taskId,
        conversationId: event.conversationId,
        status,
        since: now,
      };
    },

    /** Transitions that held for the debounce time; each one is returned once. */
    takeDue(now: number): DueTransition[] {
      const due: DueTransition[] = [];
      for (const state of states.values()) {
        const pending = state.pending;
        if (!pending || now - pending.since < debounceMs) continue;
        state.pending = null;
        if (pending.status === state.announced) continue;
        state.announced = pending.status;
        const { since: _since, ...transition } = pending;
        due.push(transition);
      }
      return due;
    },
  };
}

/** Where a due transition goes, or null when it is not relayed. */
export type RelayTarget = { pm: { projectId: string; taskId: string }; message: string };

export type PmRelayDeps = {
  now(): number;
  /** The PM session and the message, or null (no ticket, no live PM, the PM itself). */
  resolve(transition: DueTransition): Promise<RelayTarget | null>;
  /** True while the PM session's agent is working (then the message waits). */
  pmBusy(pm: RelayTarget['pm']): Promise<boolean>;
  send(pm: RelayTarget['pm'], message: string): Promise<{ success: boolean; error?: string }>;
  logger: { warn(message: string, context?: Record<string, unknown>): void };
  debounceMs?: number;
};

/**
 * The relay: `onAgentEvent` for every live agent event, `tick` every few seconds (it
 * relays due transitions and delivers waiting messages to PM sessions that are not busy).
 */
export function createPmRelay(deps: PmRelayDeps) {
  const tracker = createPmRelayTracker(deps.debounceMs);
  /** PM task id -> its PM and the waiting messages by conversation (the newest wins). */
  const queues = new Map<string, { pm: RelayTarget['pm']; messages: Map<string, string> }>();
  const flushing = new Set<string>();

  async function flush(pmTaskId: string): Promise<void> {
    const queue = queues.get(pmTaskId);
    if (!queue || flushing.has(pmTaskId)) return;
    flushing.add(pmTaskId);
    try {
      if (await deps.pmBusy(queue.pm)) return;
      queues.delete(pmTaskId);
      const message = [...queue.messages.values()].join('\n');
      const sent = await deps.send(queue.pm, message);
      if (!sent.success) {
        deps.logger.warn('ozdash pm relay: could not message the PM session', {
          pmTaskId,
          error: sent.error,
        });
      }
    } finally {
      flushing.delete(pmTaskId);
    }
  }

  return {
    onAgentEvent(event: RelayEvent): void {
      tracker.track(event, deps.now());
    },

    async tick(): Promise<void> {
      for (const transition of tracker.takeDue(deps.now())) {
        const target = await deps.resolve(transition);
        if (!target) continue;
        const queue = queues.get(target.pm.taskId) ?? { pm: target.pm, messages: new Map() };
        queue.messages.set(transition.conversationId, target.message);
        queues.set(target.pm.taskId, queue);
      }
      for (const pmTaskId of [...queues.keys()]) await flush(pmTaskId);
    },

    /** PM task ids with waiting messages (for tests and logs). */
    waiting(): string[] {
      return [...queues.keys()];
    },
  };
}
