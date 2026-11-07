// OZdash: one chime (and one macOS banner) each time a conversation comes back to Oleg.
// It follows the attention rule in ./attention.ts: a live agent transition that makes a
// conversation 'input' (awaiting-input, error) or 'done' (completed) chimes once.
// The same state again does not chime. Working again re-arms the conversation.
// The main process plays it (main/host/ozdash-attention-chime.ts).
import {
  isAttentionNotification,
  type AgentEvent,
  type AgentStatus,
} from '@core/primitives/agents/api';
import type { NotificationSettings } from '@core/primitives/app-settings/api';
import { conversationAttention, type AttentionLevel } from './attention';

export type AttentionTransitionEvent = Pick<
  AgentEvent,
  'type' | 'taskId' | 'conversationId' | 'payload'
>;

export type AttentionTransition = {
  readonly level: AttentionLevel;
  readonly status: AgentStatus;
};

export type ChimeRouting = {
  readonly sound: boolean;
  readonly banner: boolean;
};

/** Two chimes closer than this (several tasks at once) play only once. */
export const MIN_CHIME_GAP_MS = 1_500;

/** The status an agent event writes. Same mapping as AgentStatusService. */
export function statusFromAgentEvent(event: AttentionTransitionEvent): AgentStatus | null {
  switch (event.type) {
    case 'start':
      return 'working';
    case 'stop':
      return 'completed';
    case 'error':
      return 'error';
    case 'notification':
      return isAttentionNotification(event.payload.notificationType) ? 'awaiting-input' : null;
  }
}

export function createAttentionChimeTracker(now: () => number = () => Date.now()) {
  const lastStatus = new Map<string, AgentStatus>();
  let lastChimeAt = Number.NEGATIVE_INFINITY;

  return {
    /**
     * Called for every live agent event, in order. Returns the attention transition to
     * announce, or null (not an attention state, or the same state as last time).
     */
    track(event: AttentionTransitionEvent): AttentionTransition | null {
      const status = statusFromAgentEvent(event);
      if (!status) return null;
      const key = `${event.taskId}:${event.conversationId}`;
      if (status === 'working') {
        lastStatus.delete(key);
        return null;
      }
      // A live transition resets the seen flag (AgentStatusService), so it is unseen.
      const level = conversationAttention({ status, seen: false });
      if (!level) return null;
      const previous = lastStatus.get(key);
      if (previous === status) return null;
      lastStatus.set(key, status);
      // Claude sends idle_prompt about 60 s after it stops. It is the same finished
      // turn, so it does not chime a second time.
      if (
        previous === 'completed' &&
        event.type === 'notification' &&
        event.payload.notificationType === 'idle_prompt'
      ) {
        return null;
      }
      return { level, status };
    },

    /** Which outputs to use for an announced transition, from the user's settings. */
    route(settings: NotificationSettings, appFocused: boolean): ChimeRouting {
      if (!settings.enabled) return { sound: false, banner: false };
      const at = now();
      const sound =
        settings.sound &&
        (settings.soundFocusMode === 'always' || !appFocused) &&
        at - lastChimeAt >= MIN_CHIME_GAP_MS;
      if (sound) lastChimeAt = at;
      return { sound, banner: settings.osNotifications };
    },
  };
}

export type AttentionChimeTracker = ReturnType<typeof createAttentionChimeTracker>;

export function bannerBody(status: AgentStatus): string {
  switch (status) {
    case 'awaiting-input':
      return 'Your agent is waiting for input';
    case 'error':
      return 'Your agent hit an error';
    default:
      return 'Your agent has finished working';
  }
}
