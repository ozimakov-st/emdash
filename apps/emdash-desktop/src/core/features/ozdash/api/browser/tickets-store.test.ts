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

describe('flash tickets', () => {
  const globals = globalThis as { ozdash?: unknown };
  afterEach(() => {
    vi.useRealTimers();
    delete globals.ozdash;
  });

  it('▲ stops at P1 and ▼ from P0 goes to P1', async () => {
    vi.useFakeTimers();
    const setTicketPriority = vi.fn(async () => ({ success: true }));
    globals.ozdash = { setTicketPriority, listTickets: vi.fn(async () => store.list) };
    const store = new TicketsStore();
    store.setList({
      vaultPath: '/v',
      tickets: [
        { ...ticket('1', null), priority: 1 },
        { ...ticket('2', null), priority: 0 },
      ],
      warnings: [],
      error: null,
    });
    expect(store.bumpPriority('1-t', 'up')).toBe(false);
    expect(store.bumpPriority('2-t', 'up')).toBe(false);
    expect(store.bumpPriority('2-t', 'down')).toBe(true);
    expect(store.tickets[1]!.priority).toBe(1);
    await vi.advanceTimersByTimeAsync(PRIORITY_DEBOUNCE_MS);
    expect(setTicketPriority).toHaveBeenCalledWith('2-t', 1);
  });

  it('creates a P0 ticket, then starts it with the Start path (flash reason)', async () => {
    const calls: string[] = [];
    const createTicket = vi.fn(async () => {
      calls.push('create');
      return {
        success: true as const,
        ticketId: '7',
        folder: '7-quick',
        projectId: 'pm',
        taskId: null,
      };
    });
    const openTicketSession = vi.fn(async () => {
      calls.push('open');
      return { success: true as const, projectId: 'pm', taskId: 'task-7', created: true };
    });
    globals.ozdash = {
      createTicket,
      openTicketSession,
      listTickets: vi.fn(async () => store.list),
    };
    const store = new TicketsStore();

    const result = await store.createFlashTicket({
      title: 'Quick',
      description: 'Look at X',
      projectId: 'pm',
    });

    expect(createTicket).toHaveBeenCalledWith({
      title: 'Quick',
      description: 'Look at X',
      projectId: 'pm',
      priority: 0,
    });
    expect(openTicketSession).toHaveBeenCalledWith('7-quick', 'pm', { flash: true });
    expect(calls).toEqual(['create', 'open']);
    expect(result.session).toEqual({
      success: true,
      projectId: 'pm',
      taskId: 'task-7',
      created: true,
    });
  });

  it('does not open a session when the create fails', async () => {
    const openTicketSession = vi.fn();
    globals.ozdash = {
      createTicket: vi.fn(async () => ({ success: false as const, error: 'no vault' })),
      openTicketSession,
      listTickets: vi.fn(async () => null),
    };
    const result = await new TicketsStore().createFlashTicket({
      title: 'Quick',
      description: '',
      projectId: 'pm',
    });
    expect(result).toEqual({ created: { success: false, error: 'no vault' }, session: null });
    expect(openTicketSession).not.toHaveBeenCalled();
  });

  it('Start on the board calls openTicketSession without options', async () => {
    const openTicketSession = vi.fn(async () => ({ success: false as const, error: 'x' }));
    globals.ozdash = { openTicketSession };
    await new TicketsStore().openSession('1-t', 'pm');
    expect(openTicketSession).toHaveBeenCalledWith('1-t', 'pm');
  });
});
