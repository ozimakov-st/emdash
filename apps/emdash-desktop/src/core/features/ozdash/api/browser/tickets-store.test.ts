import { describe, expect, it } from 'vitest';
import type { TicketSummary } from '../tickets';
import { ticketForPmSession, ticketsStore } from './tickets-store';

function ticket(id: string, pmSession: string | null): TicketSummary {
  return {
    id,
    title: `Ticket ${id}`,
    status: 'active',
    priority: 2,
    needsOleg: false,
    nextCheck: null,
    pmSession,
    updated: null,
    folder: `${id}-t`,
    nextStep: null,
    waitingOn: [],
    openQuestions: { count: 0, first: null },
    searchText: '',
  };
}

describe('ticketForPmSession', () => {
  it('finds the ticket whose pm_session is the task id', () => {
    ticketsStore.setList({
      vaultPath: '/v',
      tickets: [ticket('1', 'task-a'), ticket('2', null), ticket('3', 'task-c')],
      warnings: [],
      error: null,
    });
    expect(ticketForPmSession('task-a')?.id).toBe('1');
    expect(ticketForPmSession('task-c')?.id).toBe('3');
    expect(ticketForPmSession('task-b')).toBeNull();
  });
});
