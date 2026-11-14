import { describe, expect, it } from 'vitest';
import {
  continueMessage,
  pmRecoveryNote,
  splitRecovery,
  ticketsToNotify,
  type RecoveryCandidate,
  type RecoveryResult,
} from './session-recovery';

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

function result(
  overrides: Partial<RecoveryCandidate>,
  outcome: RecoveryResult['outcome']
): RecoveryResult {
  return { ...candidate(overrides), at: '2026-11-13T18:24:00.000Z', outcome };
}

describe('splitRecovery', () => {
  it('separates children, PMs and never-started sessions', () => {
    const child = candidate({ conversationId: 'child' });
    const pm = candidate({ conversationId: 'pm', isPm: true });
    const fresh = candidate({ conversationId: 'fresh', kind: 'never-started' });
    expect(splitRecovery([pm, fresh, child])).toEqual({
      children: [child],
      pms: [pm],
      neverStarted: [fresh],
    });
  });
});

describe('continueMessage', () => {
  it('says when the app restarted and asks the agent to continue', () => {
    const message = continueMessage('2026-11-13 18:24 UTC');
    expect(message).toContain('2026-11-13 18:24 UTC');
    expect(message).toContain('continue the task');
  });
});

describe('pmRecoveryNote', () => {
  it('lists continued, never-started (with ids) and failed sessions of the ticket', () => {
    const note = pmRecoveryNote('8', '18:24 UTC', [
      result({ taskName: 'iac', title: 'Executor', conversationId: 'a' }, { status: 'continued' }),
      result(
        { taskName: 'k8s', title: 'probe', conversationId: 'b', kind: 'never-started' },
        { status: 'not-started' }
      ),
      result(
        { taskName: 'k8s', title: 'review-grok', conversationId: 'c' },
        { status: 'failed', error: 'cursor login expired' }
      ),
      result({ ticketId: '7', taskName: 'other' }, { status: 'continued' }),
    ]);
    expect(note).toContain('ticket #8');
    expect(note).toContain('Continued (told to go on): iac / Executor');
    expect(note).toContain('k8s / probe (projectId p1, taskId t1, conversationId b)');
    expect(note).toContain('start_conversation');
    expect(note).toContain('k8s / review-grok: cursor login expired');
    expect(note).not.toContain('other');
  });

  it('is null when the ticket has no child results (the PM itself does not count)', () => {
    expect(
      pmRecoveryNote('8', '18:24 UTC', [result({ isPm: true }, { status: 'continued' })])
    ).toBeNull();
  });
});

describe('ticketsToNotify', () => {
  it('returns each ticket with child results once, skipping PMs and no-ticket tasks', () => {
    expect(
      ticketsToNotify([
        result({ ticketId: '8' }, { status: 'continued' }),
        result({ ticketId: '8' }, { status: 'not-started' }),
        result({ ticketId: '7', isPm: true }, { status: 'continued' }),
        result({ ticketId: null }, { status: 'continued' }),
        result({ ticketId: '5' }, { status: 'failed', error: 'x' }),
      ])
    ).toEqual(['8', '5']);
  });
});
