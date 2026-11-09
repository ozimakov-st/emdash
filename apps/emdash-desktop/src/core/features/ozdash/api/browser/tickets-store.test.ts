import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TicketSummary } from '../tickets';
import {
  PRIORITY_DEBOUNCE_MS,
  TicketsStore,
  ticketForPmSession,
  ticketsStore,
} from './tickets-store';

function ticket(id: string, pmSession: string | null): TicketSummary {
  return {
    id,
    title: `Ticket ${id}`,
    status: 'active',
    priority: 2,
    rank: null,
    needsOleg: false,
    nextCheck: null,
    pmSession,
    updated: null,
    folder: `${id}-t`,
    goal: null,
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

describe('priority clicks', () => {
  const globals = globalThis as { ozdash?: unknown };
  afterEach(() => {
    vi.useRealTimers();
    delete globals.ozdash;
  });

  function storeWith(priority: number, setTicketPriority = vi.fn(async () => ({ success: true }))) {
    globals.ozdash = { setTicketPriority, listTickets: vi.fn(async () => store.list) };
    const store = new TicketsStore();
    store.setList({
      vaultPath: '/v',
      tickets: [{ ...ticket('1', null), priority }],
      warnings: [],
      error: null,
    });
    return { store, setTicketPriority };
  }

  it('shows each click at once and writes once after the clicks stop', async () => {
    vi.useFakeTimers();
    const { store, setTicketPriority } = storeWith(4);
    expect(store.bumpPriority('1-t', 'up')).toBe(true);
    expect(store.bumpPriority('1-t', 'up')).toBe(true);
    expect(store.tickets[0]!.priority).toBe(2);
    await vi.advanceTimersByTimeAsync(PRIORITY_DEBOUNCE_MS - 10);
    expect(store.bumpPriority('1-t', 'up')).toBe(true);
    expect(store.bumpPriority('1-t', 'up')).toBe(false); // P1 is the top.
    expect(store.tickets[0]!.priority).toBe(1);
    expect(setTicketPriority).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(PRIORITY_DEBOUNCE_MS);
    expect(setTicketPriority).toHaveBeenCalledTimes(1);
    expect(setTicketPriority).toHaveBeenCalledWith('1-t', 1);
  });

  it('does not write when the clicks end at the saved priority; stops at P4', async () => {
    vi.useFakeTimers();
    const { store, setTicketPriority } = storeWith(3);
    store.bumpPriority('1-t', 'down');
    expect(store.bumpPriority('1-t', 'down')).toBe(false);
    store.bumpPriority('1-t', 'up');
    await vi.advanceTimersByTimeAsync(PRIORITY_DEBOUNCE_MS * 2);
    expect(setTicketPriority).not.toHaveBeenCalled();
    expect(store.tickets[0]!.priority).toBe(3);
  });

  it('shows a failed write as a notice and goes back to the saved value', async () => {
    vi.useFakeTimers();
    const { store } = storeWith(
      3,
      vi.fn(async () => ({ success: false as const, error: 'locked' }))
    );
    store.bumpPriority('1-t', 'up');
    await vi.advanceTimersByTimeAsync(PRIORITY_DEBOUNCE_MS);
    expect(store.notice).toEqual({
      tone: 'error',
      text: 'Could not set the priority of #1: locked',
    });
    expect(store.tickets[0]!.priority).toBe(3);
  });
});
