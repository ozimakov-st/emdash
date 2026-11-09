// Fork (ozimakov-st): Oleg's tickets (PM-managed work items) as the Tickets board
// shows them. The main process reads them from the vault
// (`~/Projects/work/vault/tickets/<id>-<slug>/ticket.md`); see ozdash/node.
import type { LinkTicketTaskInput, LinkTicketTaskResult } from './ticket-issues';

export const TICKET_STATUSES = [
  'parked',
  'active',
  'waiting',
  'blocked',
  'done',
  'dropped',
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

/** A status value from a file, lowercased; the old `draft` reads as `parked`. Null when unknown. */
export function normalizeTicketStatus(value: string): TicketStatus | null {
  const status = value.trim().toLowerCase();
  if (status === 'draft') return 'parked';
  return (TICKET_STATUSES as readonly string[]).includes(status) ? (status as TicketStatus) : null;
}

/**
 * True when the ticket is being worked on (active, waiting or blocked). A ticket that
 * gets a session is started (set to active) only when this is false.
 */
export function isStartedStatus(status: TicketStatus): boolean {
  return status === 'active' || status === 'waiting' || status === 'blocked';
}

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

/** "New ticket" (PM project) and "Create ticket from this task". */
export type CreateTicketInput = {
  title: string;
  /** Goes under `## Goal`; may be empty. */
  description: string;
  /** The PM project. */
  projectId: string;
  /** Set to use this existing PM project task as the PM session (no new task). */
  existingTask?: { id: string; name: string };
};

export type CreateTicketResult =
  | {
      success: true;
      ticketId: string;
      folder: string;
      projectId: string;
      /** The PM session task, or null when it could not be created. */
      taskId: string | null;
      warning?: string;
    }
  | { success: false; error: string };

/** "Link to ticket…": make this PM project task the ticket's PM session. */
export type LinkPmSessionInput = {
  folder: string;
  projectId: string;
  taskId: string;
  taskName: string;
};

/** Main-process invoke channels and the push event (see main/host/ozdash-tickets.ts). */
export const OZDASH_TICKETS_CHANNELS = {
  list: 'ozdash:list-tickets',
  restore: 'ozdash:restore-ticket',
  archive: 'ozdash:archive-ticket',
  openSession: 'ozdash:open-ticket-session',
  linkTask: 'ozdash:link-ticket-task',
  createTicket: 'ozdash:create-ticket',
  linkPmSession: 'ozdash:link-pm-session',
  changed: 'ozdash:tickets-changed',
} as const;

/** What the preload script adds to `window.ozdash` for tickets. */
export type OzdashTicketsBridge = {
  listTickets(): Promise<TicketList>;
  onTicketsChanged(callback: (list: TicketList) => void): () => void;
  restoreTicket(folder: string): Promise<TicketActionResult>;
  /** Parked ticket -> dropped. */
  archiveTicket(folder: string): Promise<TicketActionResult>;
  openTicketSession(folder: string, projectId: string): Promise<OpenTicketSessionResult>;
  /** After a task was created from a ticket (see ticket-issues.ts). */
  linkTicketTask(input: LinkTicketTaskInput): Promise<LinkTicketTaskResult>;
  createTicket(input: CreateTicketInput): Promise<CreateTicketResult>;
  linkPmSession(input: LinkPmSessionInput): Promise<TicketActionResult>;
};

export type TicketColumnId = 'needs-oleg' | 'active' | 'waiting' | 'parked' | 'archive';

/** The board's three working columns. Parked and Archive are side panels. */
export const TICKET_COLUMNS: ReadonlyArray<{ id: TicketColumnId; label: string }> = [
  { id: 'needs-oleg', label: 'Needs Oleg' },
  { id: 'active', label: 'Active' },
  { id: 'waiting', label: 'Waiting' },
];

export type TicketPanelId = 'parked' | 'archive';

export const TICKET_PANELS: ReadonlyArray<{ id: TicketPanelId; label: string }> = [
  { id: 'parked', label: 'Parked' },
  { id: 'archive', label: 'Archive' },
];

/**
 * Whether a side panel shows. A closed panel still shows while a search is active and
 * it has matches (`autoExpanded`, so the board can say "matches").
 */
export function panelView(input: { open: boolean; query: string; matches: number }): {
  show: boolean;
  autoExpanded: boolean;
} {
  if (input.open) return { show: true, autoExpanded: false };
  const searching = input.query.trim().length > 0;
  const autoExpanded = searching && input.matches > 0;
  return { show: autoExpanded, autoExpanded };
}

/**
 * How long ago `updated` (YYYY-MM-DD) was, short: `today`, `1d`, `5d`, `3w`, `2mo`, `1y`.
 * Empty when missing or not a date.
 */
export function relativeUpdated(updated: string | null, now: Date): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(updated ?? '');
  if (!match) return '';
  const then = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((today.getTime() - then.getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days < 14) return `${days}d`;
  if (days < 60) return `${Math.floor(days / 7)}w`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}y`;
}

/** The first non-blank line of the Goal, for the Start popover; null when there is none. */
export function goalFirstLine(goal: string | null): string | null {
  const line = (goal ?? '').split(/\r?\n/).find((text) => text.trim() !== '');
  return line ? line.trim() : null;
}

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

/** Tickets per column or panel, filtered by the query and sorted by priority, then newest. */
export function groupTickets(
  tickets: readonly TicketSummary[],
  query: string
): Record<TicketColumnId, TicketSummary[]> {
  const groups: Record<TicketColumnId, TicketSummary[]> = {
    'needs-oleg': [],
    active: [],
    waiting: [],
    parked: [],
    archive: [],
  };
  for (const ticket of tickets) {
    if (ticketMatchesQuery(ticket, query)) groups[ticketColumn(ticket)].push(ticket);
  }
  for (const list of Object.values(groups)) list.sort(compareTickets);
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

/**
 * True when a PM project task is no ticket's PM session. False while the list is
 * not loaded or the vault could not be read (no hint rather than a wrong one).
 */
export function pmTaskHasNoTicket(
  taskId: string,
  list: Pick<TicketList, 'tickets' | 'error'> | null
): boolean {
  if (!list || list.error) return false;
  return !list.tickets.some((ticket) => ticket.pmSession === taskId);
}

/**
 * Tickets a PM project task may become the PM session of: no `pm_session`, or one
 * that is not a live task any more. Open tickets first, then by id.
 */
export function linkableTickets(
  tickets: readonly TicketSummary[],
  isLiveTask: (taskId: string) => boolean
): TicketSummary[] {
  return tickets
    .filter((ticket) => !ticket.pmSession || !isLiveTask(ticket.pmSession))
    .sort(
      (a, b) =>
        Number(isArchived(a)) - Number(isArchived(b)) ||
        Number(a.id) - Number(b.id) ||
        a.id.localeCompare(b.id)
    );
}
