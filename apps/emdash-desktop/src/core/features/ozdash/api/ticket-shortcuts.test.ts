import { describe, expect, it } from 'vitest';
import {
  currentTaskOf,
  pmProjectIdIn,
  startTicketQuestion,
  taskTicket,
  ticketDoubleClickAction,
  ticketPanelTarget,
} from './ticket-shortcuts';
import type { TicketSummary } from './tickets';

function ticket(overrides: Partial<TicketSummary>): TicketSummary {
  return {
    id: '1',
    title: 'Ticket',
    status: 'active',
    priority: 3,
    rank: null,
    needsOleg: false,
    nextCheck: null,
    pmSession: null,
    updated: '2026-11-01',
    folder: `${overrides.id ?? '1'}-ticket`,
    goal: null,
    nextStep: null,
    waitingOn: [],
    openQuestions: { count: 0, first: null },
    searchText: '',
    ...overrides,
  };
}

const taskRef = (projectId: string, taskId: string) => ({
  viewId: 'task',
  params: { projectId, taskId },
});

describe('pmProjectIdIn (Open Tickets Board target)', () => {
  it('returns the PM project id', () => {
    const projects = new Map([
      ['p1', { pm: false }],
      ['pm', { pm: true }],
    ]);
    expect(pmProjectIdIn(projects.entries(), (project) => project.pm)).toBe('pm');
  });

  it('returns null when no project is the PM project', () => {
    expect(pmProjectIdIn([['p1', { pm: false }]], (project) => project.pm)).toBeNull();
    expect(pmProjectIdIn([], () => true)).toBeNull();
  });
});

describe('currentTaskOf', () => {
  it('reads the task view params', () => {
    expect(currentTaskOf(taskRef('p1', 't1'))).toEqual({ projectId: 'p1', taskId: 't1' });
  });

  it('is null outside a task view or with bad params', () => {
    expect(currentTaskOf({ viewId: 'project', params: { projectId: 'p1' } })).toBeNull();
    expect(currentTaskOf({ viewId: 'home', params: {} })).toBeNull();
    expect(currentTaskOf({ viewId: 'task', params: null })).toBeNull();
    expect(currentTaskOf({ viewId: 'task', params: { projectId: 'p1', taskId: '' } })).toBeNull();
    expect(currentTaskOf({ viewId: 'task', params: { projectId: 1, taskId: 't' } })).toBeNull();
  });
});

describe('taskTicket', () => {
  const pm = ticket({ id: '5', pmSession: 'pm-task' });
  const marked = ticket({ id: '6' });
  const linked = ticket({ id: '7', searchText: '| d1 | child | x | emdash: linked-task (x) |' });
  const tickets = [pm, marked, linked];

  it('finds the ticket of a PM session, a marked child and a file-linked child', () => {
    expect(taskTicket('pm-task', tickets, null)).toEqual({ ticket: pm, role: 'pm' });
    expect(taskTicket('child', tickets, '6')).toEqual({ ticket: marked, role: 'child' });
    expect(taskTicket('linked-task', tickets, null)).toEqual({ ticket: linked, role: 'child' });
  });

  it('is null for a task without a ticket', () => {
    expect(taskTicket('other', tickets, null)).toBeNull();
    expect(taskTicket('other', tickets, '404')).toBeNull();
  });
});

describe('ticketPanelTarget (Toggle Ticket Panel target)', () => {
  const tickets = [ticket({ id: '5', pmSession: 'pm-task' }), ticket({ id: '6' })];
  const noMarker = () => null;

  it('targets the open task when it has a ticket', () => {
    expect(ticketPanelTarget(taskRef('work', 'pm-task'), tickets, noMarker)).toEqual({
      projectId: 'work',
      taskId: 'pm-task',
    });
    expect(
      ticketPanelTarget(taskRef('api', 'child'), tickets, (id) => (id === 'child' ? '6' : null))
    ).toEqual({ projectId: 'api', taskId: 'child' });
  });

  it('has no target in a task without a ticket or outside a task', () => {
    expect(ticketPanelTarget(taskRef('api', 'plain'), tickets, noMarker)).toBeNull();
    expect(ticketPanelTarget({ viewId: 'project', params: {} }, tickets, noMarker)).toBeNull();
  });
});

describe('ticketDoubleClickAction', () => {
  it('opens a live PM session', () => {
    const live = ticket({ pmSession: 'pm-task' });
    expect(ticketDoubleClickAction(live, { archived: false })).toBe('open-session');
    // A parked ticket with a live PM session (parked after it ran) opens it too.
    expect(ticketDoubleClickAction({ ...live, status: 'parked' }, { archived: false })).toBe(
      'open-session'
    );
  });

  it('asks before starting when there is no live PM session', () => {
    expect(ticketDoubleClickAction(ticket({ status: 'parked' }), null)).toBe('confirm-start');
    // pm_session names a task that is gone, or archived.
    expect(ticketDoubleClickAction(ticket({ pmSession: 'gone' }), null)).toBe('confirm-start');
    expect(ticketDoubleClickAction(ticket({ pmSession: 'old' }), { archived: true })).toBe(
      'confirm-start'
    );
  });

  it('does nothing for archived tickets', () => {
    const done = ticket({ status: 'done', pmSession: 'pm-task' });
    expect(ticketDoubleClickAction(done, { archived: false })).toBe('none');
    expect(ticketDoubleClickAction(ticket({ status: 'dropped' }), null)).toBe('none');
  });

  it('words the confirm question with id and title', () => {
    expect(startTicketQuestion({ id: '12', title: 'Add SCIM' })).toBe(
      'Start ticket #12 — Add SCIM?'
    );
  });
});
