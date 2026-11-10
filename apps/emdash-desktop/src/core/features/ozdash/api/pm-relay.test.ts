import { describe, expect, it, vi } from 'vitest';
import {
  createPmRelay,
  createPmRelayTracker,
  pmRelayEnabled,
  relayMessage,
  type DueTransition,
  type RelayEvent,
} from './pm-relay';

const S = 1_000;

function event(
  type: RelayEvent['type'],
  extra: Partial<RelayEvent> & { notificationType?: 'permission_prompt' | 'idle_prompt' } = {}
): RelayEvent {
  const { notificationType, ...rest } = extra;
  return {
    type,
    projectId: 'p1',
    taskId: 'child',
    conversationId: 'c1',
    payload: notificationType ? { notificationType } : {},
    ...rest,
  };
}

describe('createPmRelayTracker', () => {
  it('relays a state that holds for the debounce time, once', () => {
    const tracker = createPmRelayTracker(20 * S);
    tracker.track(event('start'), 0);
    tracker.track(event('stop'), 1 * S);
    expect(tracker.takeDue(20 * S)).toEqual([]);
    expect(tracker.takeDue(21 * S)).toEqual([
      { projectId: 'p1', taskId: 'child', conversationId: 'c1', status: 'completed' },
    ]);
    expect(tracker.takeDue(60 * S)).toEqual([]);
  });

  it('drops a state that changes back to working inside the debounce time', () => {
    const tracker = createPmRelayTracker(20 * S);
    tracker.track(event('notification', { notificationType: 'permission_prompt' }), 0);
    tracker.track(event('start'), 5 * S);
    expect(tracker.takeDue(30 * S)).toEqual([]);
  });

  it('relays the last state when it changes inside the debounce time', () => {
    const tracker = createPmRelayTracker(20 * S);
    tracker.track(event('notification', { notificationType: 'permission_prompt' }), 0);
    tracker.track(event('error'), 10 * S);
    expect(tracker.takeDue(25 * S)).toEqual([]);
    expect(tracker.takeDue(30 * S).map((due) => due.status)).toEqual(['error']);
  });

  it('does not relay the same state twice; working re-arms it', () => {
    const tracker = createPmRelayTracker(20 * S);
    tracker.track(event('stop'), 0);
    expect(tracker.takeDue(20 * S)).toHaveLength(1);
    tracker.track(event('stop'), 30 * S);
    expect(tracker.takeDue(60 * S)).toEqual([]);
    tracker.track(event('start'), 70 * S);
    tracker.track(event('stop'), 80 * S);
    expect(tracker.takeDue(100 * S)).toHaveLength(1);
  });

  it("ignores Claude's idle_prompt after a stop (same finished turn)", () => {
    const tracker = createPmRelayTracker(20 * S);
    tracker.track(event('stop'), 0);
    expect(tracker.takeDue(20 * S)).toHaveLength(1);
    tracker.track(event('notification', { notificationType: 'idle_prompt' }), 60 * S);
    expect(tracker.takeDue(100 * S)).toEqual([]);
  });

  it('skips a state that comes back to the one already relayed', () => {
    const tracker = createPmRelayTracker(20 * S);
    tracker.track(event('notification', { notificationType: 'permission_prompt' }), 0);
    expect(tracker.takeDue(20 * S)).toHaveLength(1);
    tracker.track(event('error'), 30 * S);
    tracker.track(event('notification', { notificationType: 'permission_prompt' }), 35 * S);
    expect(tracker.takeDue(60 * S)).toEqual([]);
  });

  it('tracks conversations separately', () => {
    const tracker = createPmRelayTracker(20 * S);
    tracker.track(event('stop'), 0);
    tracker.track(event('error', { conversationId: 'c2' }), 0);
    expect(
      tracker
        .takeDue(20 * S)
        .map((due) => due.conversationId)
        .sort()
    ).toEqual(['c1', 'c2']);
  });
});

describe('createPmRelay', () => {
  const pm = { projectId: 'work', taskId: 'pm' };

  function setup(options: { busy?: boolean[]; resolve?: (due: DueTransition) => boolean } = {}) {
    let now = 0;
    const busy = [...(options.busy ?? [])];
    const send = vi.fn(async () => ({ success: true }));
    const relay = createPmRelay({
      now: () => now,
      debounceMs: 20 * S,
      resolve: async (due) =>
        options.resolve && !options.resolve(due)
          ? null
          : { pm, message: `${due.conversationId} is now ${due.status}` },
      pmBusy: async () => busy.shift() ?? false,
      send,
      logger: { warn: vi.fn() },
    });
    return {
      relay,
      send,
      at: (time: number) => {
        now = time;
      },
    };
  }

  it('sends the message to the PM session after the debounce time', async () => {
    const { relay, send, at } = setup();
    relay.onAgentEvent(event('stop'));
    at(10 * S);
    await relay.tick();
    expect(send).not.toHaveBeenCalled();
    at(20 * S);
    await relay.tick();
    expect(send).toHaveBeenCalledWith(pm, 'c1 is now completed');
    await relay.tick();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('waits while the PM is working, then sends the waiting messages as one', async () => {
    const { relay, send, at } = setup({ busy: [true, true] });
    relay.onAgentEvent(event('stop'));
    relay.onAgentEvent(event('error', { conversationId: 'c2' }));
    at(20 * S);
    await relay.tick();
    expect(send).not.toHaveBeenCalled();
    expect(relay.waiting()).toEqual(['pm']);
    await relay.tick();
    expect(send).not.toHaveBeenCalled();
    await relay.tick();
    expect(send).toHaveBeenCalledWith(pm, 'c1 is now completed\nc2 is now error');
    expect(relay.waiting()).toEqual([]);
  });

  it('keeps only the newest waiting message of a conversation', async () => {
    const { relay, send, at } = setup({ busy: [true] });
    relay.onAgentEvent(event('notification', { notificationType: 'permission_prompt' }));
    at(20 * S);
    await relay.tick();
    relay.onAgentEvent(event('start'));
    relay.onAgentEvent(event('stop'));
    at(40 * S);
    await relay.tick();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(pm, 'c1 is now completed');
  });

  it('does not relay what resolve rejects (no ticket, the PM itself, no live PM)', async () => {
    const { relay, send, at } = setup({ resolve: () => false });
    relay.onAgentEvent(event('stop'));
    at(30 * S);
    await relay.tick();
    expect(send).not.toHaveBeenCalled();
    expect(relay.waiting()).toEqual([]);
  });
});

describe('relayMessage', () => {
  it('is one line with the status command', () => {
    expect(
      relayMessage({
        ticketId: '5',
        taskName: 'fix-login',
        projectName: 'emdash',
        conversation: 'Review · cursor',
        status: 'awaiting-input',
        taskId: 't1',
        conversationId: 'c1',
      })
    ).toBe(
      '[OZdash] Ticket #5 · fix-login (emdash) · Review · cursor is now awaiting-input. ' +
        'Run: emdash-oz status t1 --conversation c1'
    );
  });
});

describe('pmRelayEnabled', () => {
  it('is on unless OZDASH_PM_RELAY turns it off', () => {
    expect(pmRelayEnabled({})).toBe(true);
    expect(pmRelayEnabled({ OZDASH_PM_RELAY: 'on' })).toBe(true);
    expect(pmRelayEnabled({ OZDASH_PM_RELAY: 'off' })).toBe(false);
    expect(pmRelayEnabled({ OZDASH_PM_RELAY: ' OFF ' })).toBe(false);
    expect(pmRelayEnabled({ OZDASH_PM_RELAY: '0' })).toBe(false);
  });
});
