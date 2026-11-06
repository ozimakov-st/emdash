import { describe, expect, it } from 'vitest';
import {
  groupTickets,
  ticketColumn,
  ticketMatchesQuery,
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
    needsOleg: false,
    nextCheck: null,
    pmSession: null,
    updated: '2026-11-01',
    folder: `${overrides.id ?? '1'}-ticket`,
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
    expect(ticketColumn({ status: 'draft', needsOleg: false })).toBe('draft');
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
  it('groups by column, sorts by priority then newest, and filters by the query', () => {
    const tickets = [
      ticket({ id: '1', priority: 3, updated: '2026-11-01' }),
      ticket({ id: '2', priority: 1, updated: '2026-10-01' }),
      ticket({ id: '3', priority: 3, updated: '2026-11-05' }),
      ticket({ id: '4', status: 'blocked' }),
      ticket({ id: '5', status: 'done', updated: '2026-09-01', title: 'Old' }),
      ticket({ id: '6', status: 'dropped', updated: '2026-10-01' }),
      ticket({ id: '7', status: 'draft', priority: null }),
    ];
    const groups = groupTickets(tickets, '');
    expect(groups.active.map((t) => t.id)).toEqual(['2', '3', '1']);
    expect(groups['needs-oleg'].map((t) => t.id)).toEqual(['4']);
    expect(groups.draft.map((t) => t.id)).toEqual(['7']);
    expect(groups.waiting).toEqual([]);
    expect(groups.archive.map((t) => t.id)).toEqual(['6', '5']);

    const filtered = groupTickets(tickets, 'old');
    expect(filtered.archive.map((t) => t.id)).toEqual(['5']);
    expect(filtered.active).toEqual([]);
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
