import { describe, expect, it } from 'vitest';
import {
  bumpPriority,
  canPark,
  compareTickets,
  effectivePriority,
  FLASH_PRIORITY,
  isFlashPriority,
  isValidPriority,
  goalFirstLine,
  goalPreview,
  groupTickets,
  isStartedStatus,
  linkableTickets,
  normalizeTicketStatus,
  panelView,
  pmTaskHasNoTicket,
  ranksForOrder,
  relativeUpdated,
  reorderGroup,
  ticketColumn,
  ticketMatchesQuery,
  ticketForTask,
  ticketSessionName,
  ticketSlug,
  type TicketSummary,
} from './tickets';

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

describe('ticketColumn', () => {
  it('puts blocked and needs_oleg tickets in Needs Oleg, archived ones in Archive', () => {
    expect(ticketColumn({ status: 'blocked', needsOleg: false })).toBe('needs-oleg');
    expect(ticketColumn({ status: 'waiting', needsOleg: true })).toBe('needs-oleg');
    expect(ticketColumn({ status: 'active', needsOleg: false })).toBe('active');
    expect(ticketColumn({ status: 'waiting', needsOleg: false })).toBe('waiting');
    expect(ticketColumn({ status: 'parked', needsOleg: false })).toBe('parked');
    expect(ticketColumn({ status: 'parked', needsOleg: true })).toBe('parked');
    expect(ticketColumn({ status: 'done', needsOleg: true })).toBe('archive');
    expect(ticketColumn({ status: 'dropped', needsOleg: false })).toBe('archive');
  });
});

describe('ticketMatchesQuery', () => {
  const t = ticket({ id: '123', title: 'Add SCIM sync', searchText: 'body mentions ann' });
  it('matches the id, the title and the full text, all words', () => {
    expect(ticketMatchesQuery(t, '')).toBe(true);
    expect(ticketMatchesQuery(t, '#123')).toBe(true);
    expect(ticketMatchesQuery(t, '123')).toBe(true);
    expect(ticketMatchesQuery(t, 'scim')).toBe(true);
    expect(ticketMatchesQuery(t, 'ANN scim')).toBe(true);
    expect(ticketMatchesQuery(t, 'ann bob')).toBe(false);
    expect(ticketMatchesQuery(t, '#12 ')).toBe(true);
    expect(ticketMatchesQuery(t, '#124')).toBe(false);
  });
});

describe('groupTickets', () => {
  it('groups by column or panel, sorts by priority then newest, and filters by the query', () => {
    const tickets = [
      ticket({ id: '1', priority: 3, updated: '2026-11-01' }),
      ticket({ id: '2', priority: 1, updated: '2026-10-01' }),
      ticket({ id: '3', priority: 3, updated: '2026-11-05' }),
      ticket({ id: '4', status: 'blocked' }),
      ticket({ id: '5', status: 'done', updated: '2026-09-01', title: 'Old' }),
      ticket({ id: '6', status: 'dropped', updated: '2026-10-01' }),
      ticket({ id: '7', status: 'parked', priority: null }),
      ticket({ id: '8', status: 'parked', priority: 1, updated: '2026-10-01' }),
      ticket({ id: '9', status: 'parked', priority: 1, updated: '2026-10-09' }),
      ticket({ id: '10', status: 'done', priority: 1, updated: '2026-08-01' }),
    ];
    const groups = groupTickets(tickets, '');
    expect(groups.active.map((t) => t.id)).toEqual(['2', '3', '1']);
    expect(groups['needs-oleg'].map((t) => t.id)).toEqual(['4']);
    // Panels sort like columns: priority first (none = P3), then most recently updated.
    expect(groups.parked.map((t) => t.id)).toEqual(['9', '8', '7']);
    expect(groups.waiting).toEqual([]);
    expect(groups.archive.map((t) => t.id)).toEqual(['10', '6', '5']);

    const filtered = groupTickets(tickets, 'old');
    expect(filtered.archive.map((t) => t.id)).toEqual(['5']);
    expect(filtered.active).toEqual([]);
  });
});

describe('priority', () => {
  it('reads a missing priority as P3, 0 as flash, and clamps out-of-range values', () => {
    expect(effectivePriority(null)).toBe(3);
    expect(effectivePriority(1)).toBe(1);
    expect(effectivePriority(0)).toBe(FLASH_PRIORITY);
    expect(effectivePriority(-2)).toBe(0);
    expect(effectivePriority(9)).toBe(4);
    expect(isFlashPriority(0)).toBe(true);
    expect(isFlashPriority(1)).toBe(false);
    expect(isFlashPriority(null)).toBe(false);
  });

  it('accepts priorities 0 (flash) to 4 only', () => {
    expect([0, 1, 2, 3, 4].every(isValidPriority)).toBe(true);
    expect([-1, 5, 2.5, Number.NaN].some(isValidPriority)).toBe(false);
  });

  it('▲ stops at P1 (P0 only with Flash); ▼ from P0 is P1', () => {
    expect(bumpPriority(1, 'up')).toBeNull();
    expect(bumpPriority(0, 'up')).toBeNull();
    expect(bumpPriority(0, 'down')).toBe(1);
  });

  it('bumps up (smaller number) and down within P1-P4, null at the ends', () => {
    expect(bumpPriority(3, 'up')).toBe(2);
    expect(bumpPriority(2, 'up')).toBe(1);
    expect(bumpPriority(1, 'up')).toBeNull();
    expect(bumpPriority(3, 'down')).toBe(4);
    expect(bumpPriority(4, 'down')).toBeNull();
    expect(bumpPriority(null, 'up')).toBe(2);
    expect(bumpPriority(null, 'down')).toBe(4);
    expect(bumpPriority(7, 'down')).toBeNull();
  });
});

describe('compareTickets', () => {
  it('sorts a flash ticket (P0) first', () => {
    const tickets = [
      ticket({ id: '1', priority: 1, rank: 10, updated: '2026-11-09' }),
      ticket({ id: '2', priority: 0, rank: null, updated: '2026-01-01' }),
      ticket({ id: '3', priority: null, rank: null }),
    ];
    expect([...tickets].sort(compareTickets).map((t) => t.id)).toEqual(['2', '1', '3']);
  });

  it('sorts by priority, then rank (missing last), then updated desc, then id', () => {
    const tickets = [
      ticket({ id: '1', priority: 2, rank: null, updated: '2026-11-09' }),
      ticket({ id: '2', priority: 2, rank: 20, updated: '2026-01-01' }),
      ticket({ id: '3', priority: 2, rank: 10, updated: '2026-01-01' }),
      ticket({ id: '4', priority: 1, rank: 99, updated: '2026-01-01' }),
      ticket({ id: '5', priority: null, rank: 10 }),
      ticket({ id: '6', priority: 2, rank: null, updated: '2026-11-01' }),
      ticket({ id: '7', priority: 3, rank: null }),
      ticket({ id: '8', priority: 2, rank: null, updated: '2026-11-01' }),
    ];
    expect([...tickets].sort(compareTickets).map((t) => t.id)).toEqual([
      '4',
      '3',
      '2',
      '1',
      '6',
      '8',
      '5',
      '7',
    ]);
  });
});

describe('manual order', () => {
  it('moves a ticket inside its priority group only', () => {
    const group = ['a', 'b', 'c', 'd'];
    expect(reorderGroup(group, 'd', 'b')).toEqual(['a', 'd', 'b', 'c']);
    expect(reorderGroup(group, 'a', 'c')).toEqual(['b', 'c', 'a', 'd']);
    expect(reorderGroup(group, 'a', 'a')).toBeNull();
    // Another priority group: not allowed.
    expect(reorderGroup(group, 'a', 'x')).toBeNull();
    expect(reorderGroup(group, 'x', 'a')).toBeNull();
  });

  it('gives ranks 10, 20, 30… in order', () => {
    expect([...ranksForOrder(['d', 'a', 'b'])]).toEqual([
      ['d', 10],
      ['a', 20],
      ['b', 30],
    ]);
  });
});

describe('card helpers', () => {
  it('offers Park only for tickets that are not parked or archived', () => {
    expect(canPark({ status: 'active' })).toBe(true);
    expect(canPark({ status: 'waiting' })).toBe(true);
    expect(canPark({ status: 'blocked' })).toBe(true);
    expect(canPark({ status: 'parked' })).toBe(false);
    expect(canPark({ status: 'done' })).toBe(false);
    expect(canPark({ status: 'dropped' })).toBe(false);
  });

  it('makes the Goal one paragraph', () => {
    expect(goalPreview('Sync groups.\n\n- from SCIM\n  - to TS')).toBe(
      'Sync groups. - from SCIM - to TS'
    );
    expect(goalPreview('  \n ')).toBeNull();
    expect(goalPreview(null)).toBeNull();
  });
});

describe('ticket session names', () => {
  it('builds a slug and the task name', () => {
    expect(ticketSlug('Add SCIM group sync — to token server!')).toBe(
      'add-scim-group-sync-to-token-server'
    );
    expect(ticketSlug('x'.repeat(50) + ' tail')).toHaveLength(40);
    expect(ticketSessionName({ id: '123', title: 'Fix: login (SSO)' })).toBe(
      'ticket-123-fix-login-sso'
    );
    expect(ticketSessionName({ id: '9', title: '!!!' })).toBe('ticket-9');
  });
});

describe('pmTaskHasNoTicket', () => {
  const tickets = [ticket({ id: '1', pmSession: 'task-1' }), ticket({ id: '2' })];

  it('is true only when no ticket points to the task', () => {
    expect(pmTaskHasNoTicket('task-1', { tickets, error: null })).toBe(false);
    expect(pmTaskHasNoTicket('task-9', { tickets, error: null })).toBe(true);
  });

  it('is false while the list is missing or the vault could not be read', () => {
    expect(pmTaskHasNoTicket('task-9', null)).toBe(false);
    expect(pmTaskHasNoTicket('task-9', { tickets: [], error: 'No vault' })).toBe(false);
  });
});

describe('linkableTickets', () => {
  it('lists tickets with an empty or stale pm_session, open ones first, then by id', () => {
    const tickets = [
      ticket({ id: '10', pmSession: 'gone' }),
      ticket({ id: '2', status: 'done' }),
      ticket({ id: '3', pmSession: 'live' }),
      ticket({ id: '9' }),
    ];
    const ids = linkableTickets(tickets, (taskId) => taskId === 'live').map((t) => t.id);
    expect(ids).toEqual(['9', '10', '2']);
  });
});

describe('ticket statuses', () => {
  it('reads a legacy draft as parked and refuses unknown values', () => {
    expect(normalizeTicketStatus('draft')).toBe('parked');
    expect(normalizeTicketStatus(' Parked ')).toBe('parked');
    expect(normalizeTicketStatus('WAITING')).toBe('waiting');
    expect(normalizeTicketStatus('later')).toBeNull();
    expect(normalizeTicketStatus('')).toBeNull();
  });

  it('counts active, waiting and blocked as started', () => {
    expect(
      ['parked', 'active', 'waiting', 'blocked', 'done', 'dropped'].map((s) => [
        s,
        isStartedStatus(s as never),
      ])
    ).toEqual([
      ['parked', false],
      ['active', true],
      ['waiting', true],
      ['blocked', true],
      ['done', false],
      ['dropped', false],
    ]);
  });
});

describe('panelView', () => {
  it('shows an open panel, with or without a search', () => {
    expect(panelView({ open: true, query: '', matches: 0 })).toEqual({
      show: true,
      autoExpanded: false,
    });
    expect(panelView({ open: true, query: 'scim', matches: 0 })).toEqual({
      show: true,
      autoExpanded: false,
    });
  });

  it('shows a closed panel only while a search matches tickets in it', () => {
    expect(panelView({ open: false, query: '', matches: 5 })).toEqual({
      show: false,
      autoExpanded: false,
    });
    expect(panelView({ open: false, query: '   ', matches: 5 })).toEqual({
      show: false,
      autoExpanded: false,
    });
    expect(panelView({ open: false, query: 'scim', matches: 0 })).toEqual({
      show: false,
      autoExpanded: false,
    });
    expect(panelView({ open: false, query: 'scim', matches: 2 })).toEqual({
      show: true,
      autoExpanded: true,
    });
  });
});

describe('relativeUpdated', () => {
  const now = new Date(2026, 10, 9, 15, 30);
  it('says how long ago, short', () => {
    expect(relativeUpdated('2026-11-09', now)).toBe('today');
    expect(relativeUpdated('2026-11-10', now)).toBe('today');
    expect(relativeUpdated('2026-11-08', now)).toBe('1d');
    expect(relativeUpdated('2026-10-27', now)).toBe('13d');
    expect(relativeUpdated('2026-10-26', now)).toBe('2w');
    expect(relativeUpdated('2026-09-01', now)).toBe('2mo');
    expect(relativeUpdated('2025-11-01', now)).toBe('1y');
  });

  it('is empty when there is no date', () => {
    expect(relativeUpdated(null, now)).toBe('');
    expect(relativeUpdated('soon', now)).toBe('');
  });
});

describe('goalFirstLine', () => {
  it('takes the first non-blank line', () => {
    expect(goalFirstLine('\n  Sync SCIM groups.  \nMore text')).toBe('Sync SCIM groups.');
    expect(goalFirstLine('  \n ')).toBeNull();
    expect(goalFirstLine(null)).toBeNull();
  });
});

describe('ticketForTask', () => {
  const tickets = [ticket({ id: '1', pmSession: 'pm-1' }), ticket({ id: '2', pmSession: null })];
  it('finds the ticket of a PM session first, then of a child task marker', () => {
    expect(ticketForTask('pm-1', tickets, null)).toMatchObject({ role: 'pm', ticket: { id: '1' } });
    expect(ticketForTask('pm-1', tickets, '2')).toMatchObject({ role: 'pm', ticket: { id: '1' } });
    expect(ticketForTask('child', tickets, '2')).toMatchObject({
      role: 'child',
      ticket: { id: '2' },
    });
    expect(ticketForTask('child', tickets, '9')).toBeNull();
    expect(ticketForTask('other', tickets, null)).toBeNull();
  });
});
