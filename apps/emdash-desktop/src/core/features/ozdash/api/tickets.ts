// Fork (ozimakov-st): Oleg's tickets (PM-managed work items) as the Tickets board
// shows them. The main process reads them from the vault
// (`~/Projects/work/vault/tickets/<id>-<slug>/ticket.md`); see ozdash/node.
import type { LinkTicketTaskInput, LinkTicketTaskResult } from './ticket-issues';

export const TICKET_STATUSES = [
  'draft',
  'active',
  'waiting',
  'blocked',
  'done',
  'dropped',
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export type TicketSummary = {
  id: string;
  title: string;
  status: TicketStatus;
  /** 1 = highest; null when missing or not a number. */
  priority: number | null;
  needsOleg: boolean;
  nextCheck: string | null;
  /** The OZdash task id of the ticket's PM session. */
  pmSession: string | null;
  updated: string | null;
  /** The ticket's folder name under `tickets/`, for example `123-add-scim`. */
  folder: string;
  /** The `## Goal` text (trimmed), or null when empty. */
  goal: string | null;
  /** The first unchecked Plan line. */
  nextStep: string | null;
  /** Open Dependencies rows. */
  waitingOn: Array<{ what: string; owner: string }>;
  openQuestions: { count: number; first: string | null };
  /** The whole file, lowercased, for the search box. */
  searchText: string;
};

export type TicketList = {
  vaultPath: string;
  tickets: TicketSummary[];
  /** Files that were skipped, one line each. */
  warnings: string[];
  /** Set when the vault could not be read at all. */
  error: string | null;
};

export type TicketActionResult =
  | { success: true; warning?: string }
  | { success: false; error: string };

export type OpenTicketSessionResult =
  | { success: true; projectId: string; taskId: string; created: boolean; warning?: string }
  | { success: false; error: string };

/** Main-process invoke channels and the push event (see main/host/ozdash-tickets.ts). */
export const OZDASH_TICKETS_CHANNELS = {
  list: 'ozdash:list-tickets',
  restore: 'ozdash:restore-ticket',
  openSession: 'ozdash:open-ticket-session',
  linkTask: 'ozdash:link-ticket-task',
  changed: 'ozdash:tickets-changed',
} as const;

/** What the preload script adds to `window.ozdash` for tickets. */
export type OzdashTicketsBridge = {
  listTickets(): Promise<TicketList>;
  onTicketsChanged(callback: (list: TicketList) => void): () => void;
  restoreTicket(folder: string): Promise<TicketActionResult>;
  openTicketSession(folder: string, projectId: string): Promise<OpenTicketSessionResult>;
  /** After a task was created from a ticket (see ticket-issues.ts). */
  linkTicketTask(input: LinkTicketTaskInput): Promise<LinkTicketTaskResult>;
};

export type TicketColumnId = 'needs-oleg' | 'active' | 'waiting' | 'draft' | 'archive';

export const TICKET_COLUMNS: ReadonlyArray<{ id: TicketColumnId; label: string }> = [
  { id: 'needs-oleg', label: 'Needs Oleg' },
  { id: 'active', label: 'Active' },
  { id: 'waiting', label: 'Waiting' },
  { id: 'draft', label: 'Draft' },
  { id: 'archive', label: 'Archive' },
];

export function isArchived(ticket: Pick<TicketSummary, 'status'>): boolean {
  return ticket.status === 'done' || ticket.status === 'dropped';
}

/** The board column of a ticket. Archived wins over "needs Oleg". */
export function ticketColumn(ticket: Pick<TicketSummary, 'status' | 'needsOleg'>): TicketColumnId {
  if (ticket.status === 'done' || ticket.status === 'dropped') return 'archive';
  if (ticket.status === 'blocked' || ticket.needsOleg) return 'needs-oleg';
  return ticket.status;
}

/** True when every word of the query is in the ticket's `#id`, title, or text. */
export function ticketMatchesQuery(
  ticket: Pick<TicketSummary, 'id' | 'title' | 'searchText'>,
  query: string
): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = `#${ticket.id}\n${ticket.title.toLowerCase()}\n${ticket.searchText}`;
  return words.every((word) => haystack.includes(word));
}

function compareTickets(a: TicketSummary, b: TicketSummary): number {
  const pa = a.priority ?? Number.MAX_SAFE_INTEGER;
  const pb = b.priority ?? Number.MAX_SAFE_INTEGER;
  if (pa !== pb) return pa - pb;
  const ua = a.updated ?? '';
  const ub = b.updated ?? '';
  if (ua !== ub) return ua < ub ? 1 : -1;
  return Number(a.id) - Number(b.id) || a.id.localeCompare(b.id);
}

/** Tickets per column, filtered by the query and sorted by priority, then newest. */
export function groupTickets(
  tickets: readonly TicketSummary[],
  query: string
): Record<TicketColumnId, TicketSummary[]> {
  const groups: Record<TicketColumnId, TicketSummary[]> = {
    'needs-oleg': [],
    active: [],
    waiting: [],
    draft: [],
    archive: [],
  };
  for (const ticket of tickets) {
    if (ticketMatchesQuery(ticket, query)) groups[ticketColumn(ticket)].push(ticket);
  }
  for (const list of Object.values(groups)) list.sort(compareTickets);
  // Newest first reads better for the archive.
  groups.archive.sort((a, b) => (b.updated ?? '').localeCompare(a.updated ?? ''));
  return groups;
}

/** A lowercase slug for task names, for example `add-scim-group-sync`. */
export function ticketSlug(title: string, maxLength = 40): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.slice(0, maxLength).replace(/-+$/, '');
}

/** The name of a ticket's PM session task, for example `ticket-123-add-scim`. */
export function ticketSessionName(ticket: Pick<TicketSummary, 'id' | 'title'>): string {
  const slug = ticketSlug(ticket.title);
  return slug ? `ticket-${ticket.id}-${slug}` : `ticket-${ticket.id}`;
}
