import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '@core/primitives/agents/api';
import type { NotificationSettings } from '@core/primitives/app-settings/api';
import {
  createAttentionChimeTracker,
  MIN_CHIME_GAP_MS,
  statusFromAgentEvent,
} from './attention-chime';

// Ids from the live attention-test-2 row (emdash4.db, conversations).
const TASK = '0164017c-5cfb-4902-affc-f6f62af23ccc';
const CONVERSATION = 'ea6b6379-c0a1-4ecc-9230-d8b0381b5111';

function agentEvent(
  type: AgentEvent['type'],
  payload: AgentEvent['payload'] = {},
  conversationId = CONVERSATION
): AgentEvent {
  return {
    type,
    source: 'hook',
    providerId: 'claude',
    projectId: 'd3c792dd-470a-4dbc-8af8-f29d9acf6bab',
    taskId: TASK,
    conversationId,
    timestamp: 1_762_476_811_000,
    payload,
  };
}

const start = (id?: string) => agentEvent('start', {}, id);
const stop = (id?: string) => agentEvent('stop', {}, id);
const permission = (id?: string) =>
  agentEvent('notification', { notificationType: 'permission_prompt' }, id);
const idlePrompt = (id?: string) =>
  agentEvent('notification', { notificationType: 'idle_prompt' }, id);

const defaults: NotificationSettings = {
  enabled: true,
  sound: true,
  customSoundPath: '~/Library/Application Support/emdash-oz/chime.wav',
  osNotifications: true,
  soundFocusMode: 'always',
};

describe('statusFromAgentEvent', () => {
  it('maps events like AgentStatusService', () => {
    expect(statusFromAgentEvent(start())).toBe('working');
    expect(statusFromAgentEvent(stop())).toBe('completed');
    expect(statusFromAgentEvent(agentEvent('error'))).toBe('error');
    expect(statusFromAgentEvent(permission())).toBe('awaiting-input');
    expect(
      statusFromAgentEvent(agentEvent('notification', { notificationType: 'auth_success' }))
    ).toBeNull();
    expect(statusFromAgentEvent(agentEvent('notification'))).toBeNull();
  });
});

describe('track', () => {
  it('announces each attention state with its level', () => {
    const tracker = createAttentionChimeTracker();
    expect(tracker.track(permission())).toEqual({ level: 'input', status: 'awaiting-input' });
    expect(tracker.track(agentEvent('error'))).toEqual({ level: 'input', status: 'error' });
    expect(tracker.track(stop())).toEqual({ level: 'done', status: 'completed' });
  });

  it('does not chime for working', () => {
    const tracker = createAttentionChimeTracker();
    expect(tracker.track(start())).toBeNull();
    expect(
      tracker.track(agentEvent('notification', { notificationType: 'auth_success' }))
    ).toBeNull();
  });

  it('chimes once per state until the agent works again', () => {
    const tracker = createAttentionChimeTracker();
    expect(tracker.track(permission())).not.toBeNull();
    expect(tracker.track(permission())).toBeNull();
    expect(tracker.track(start())).toBeNull();
    expect(tracker.track(permission())).not.toBeNull();
    expect(tracker.track(stop())).not.toBeNull();
    expect(tracker.track(stop())).toBeNull();
  });

  it('keeps conversations apart', () => {
    const tracker = createAttentionChimeTracker();
    expect(tracker.track(stop('a'))).not.toBeNull();
    expect(tracker.track(stop('b'))).not.toBeNull();
    expect(tracker.track(stop('a'))).toBeNull();
  });

  it('does not chime again for the idle_prompt that follows a stop', () => {
    const tracker = createAttentionChimeTracker();
    expect(tracker.track(stop())).not.toBeNull();
    expect(tracker.track(idlePrompt())).toBeNull();
    expect(tracker.track(idlePrompt())).toBeNull();
    // A real question after new work still chimes.
    tracker.track(start());
    expect(tracker.track(permission())).not.toBeNull();
  });

  it('chimes for idle_prompt when no stop came first', () => {
    const tracker = createAttentionChimeTracker();
    expect(tracker.track(idlePrompt())).toEqual({ level: 'input', status: 'awaiting-input' });
  });
});

describe('route', () => {
  it('uses sound and banner with the default settings', () => {
    const tracker = createAttentionChimeTracker(() => 10_000);
    expect(tracker.route(defaults, true)).toEqual({ sound: true, banner: true });
  });

  it('does nothing when notifications are off', () => {
    const tracker = createAttentionChimeTracker(() => 10_000);
    expect(tracker.route({ ...defaults, enabled: false }, false)).toEqual({
      sound: false,
      banner: false,
    });
  });

  it('respects the sound and banner switches', () => {
    const tracker = createAttentionChimeTracker(() => 10_000);
    expect(tracker.route({ ...defaults, sound: false }, false)).toEqual({
      sound: false,
      banner: true,
    });
    expect(tracker.route({ ...defaults, osNotifications: false }, false)).toEqual({
      sound: true,
      banner: false,
    });
  });

  it('plays only while unfocused in unfocused mode', () => {
    let now = 10_000;
    const tracker = createAttentionChimeTracker(() => now);
    const unfocusedOnly = { ...defaults, soundFocusMode: 'unfocused' as const };
    expect(tracker.route(unfocusedOnly, true).sound).toBe(false);
    now += MIN_CHIME_GAP_MS;
    expect(tracker.route(unfocusedOnly, false).sound).toBe(true);
  });

  it('plays one chime for transitions that arrive together', () => {
    let now = 10_000;
    const tracker = createAttentionChimeTracker(() => now);
    expect(tracker.route(defaults, false)).toEqual({ sound: true, banner: true });
    now += 200;
    expect(tracker.route(defaults, false)).toEqual({ sound: false, banner: true });
    now += MIN_CHIME_GAP_MS;
    expect(tracker.route(defaults, false).sound).toBe(true);
  });
});
