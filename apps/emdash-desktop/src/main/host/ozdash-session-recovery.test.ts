import { describe, expect, it, vi } from 'vitest';
import type {
  RecoveryCandidate,
  RecoveryOutcome,
  RecoveryResult,
} from '@core/features/ozdash/api/session-recovery';
import { runRecoveryPlan, type RecoveryPlanDeps } from './ozdash-session-recovery';

function candidate(overrides: Partial<RecoveryCandidate>): RecoveryCandidate {
  return {
    kind: 'interrupted',
    projectId: 'p1',
    taskId: 't1',
    taskName: 'task',
    conversationId: 'c1',
    title: 'Claude',
    provider: 'claude',
    type: 'acp',
    ticketId: '8',
    isPm: false,
    ...overrides,
  };
}

function setup(resume?: RecoveryPlanDeps['resume']) {
  const calls: { id: string; message: string }[] = [];
  const recorded: RecoveryResult[] = [];
  const notified: { ticketId: string; note: string }[] = [];
  const deps: RecoveryPlanDeps = {
    now: () => Date.parse('2026-11-13T18:24:30Z'),
    resume:
      resume ??
      (async (c, message) => {
        calls.push({ id: c.conversationId, message });
        return { status: 'continued' };
      }),
    record: async (r) => {
      recorded.push(r);
    },
    notifyTicket: async (ticketId, note) => {
      notified.push({ ticketId, note });
    },
  };
  return { deps, calls, recorded, notified };
}

describe('runRecoveryPlan', () => {
  it('continues children before the PM, and the PM message carries the ticket note', async () => {
    const { deps, calls, recorded, notified } = setup();
    await runRecoveryPlan(
      [
        candidate({ conversationId: 'pm', taskId: 'pm-task', isPm: true }),
        candidate({ conversationId: 'child', taskName: 'iac', title: 'Executor' }),
      ],
      deps
    );
    expect(calls.map((c) => c.id)).toEqual(['child', 'pm']);
    expect(calls[0]!.message).toContain('2026-11-13 18:24 UTC');
    expect(calls[0]!.message).not.toContain('Recovery for ticket');
    expect(calls[1]!.message).toContain('Recovery for ticket #8');
    expect(calls[1]!.message).toContain('iac / Executor');
    expect(recorded.map((r) => [r.conversationId, r.outcome.status])).toEqual([
      ['child', 'continued'],
      ['pm', 'continued'],
    ]);
    // The PM got the note in its message, so no ticket event as well.
    expect(notified).toEqual([]);
  });

  it('never starts a never-started session; the idle PM gets a ticket event', async () => {
    const { deps, calls, recorded, notified } = setup();
    await runRecoveryPlan(
      [candidate({ conversationId: 'fresh', kind: 'never-started', title: 'probe' })],
      deps
    );
    expect(calls).toEqual([]);
    expect(recorded.map((r) => r.outcome)).toEqual([{ status: 'not-started' }]);
    expect(notified).toHaveLength(1);
    expect(notified[0]!.ticketId).toBe('8');
    expect(notified[0]!.note).toContain('conversationId fresh');
  });

  it('records a thrown or failed resume as failed and goes on', async () => {
    const resume = vi.fn(async (c: RecoveryCandidate): Promise<RecoveryOutcome> => {
      if (c.conversationId === 'boom') throw new Error('runtime down');
      if (c.conversationId === 'cursor') return { status: 'failed', error: 'login expired' };
      return { status: 'continued' };
    });
    const { deps, recorded } = setup(resume);
    await runRecoveryPlan(
      [
        candidate({ conversationId: 'boom' }),
        candidate({ conversationId: 'cursor' }),
        candidate({ conversationId: 'ok', ticketId: null }),
      ],
      deps
    );
    const byId = Object.fromEntries(recorded.map((r) => [r.conversationId, r.outcome]));
    expect(byId.boom).toEqual({ status: 'failed', error: 'Error: runtime down' });
    expect(byId.cursor).toEqual({ status: 'failed', error: 'login expired' });
    expect(byId.ok).toEqual({ status: 'continued' });
  });

  it('starts at most `concurrency` sessions at the same time', async () => {
    let running = 0;
    let peak = 0;
    const { deps } = setup(async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
      return { status: 'continued' };
    });
    await runRecoveryPlan(
      Array.from({ length: 7 }, (_, i) => candidate({ conversationId: `c${i}` })),
      { ...deps, concurrency: 3 }
    );
    expect(peak).toBe(3);
  });
});
