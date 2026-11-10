// Fork (ozimakov-st): Oleg's tickets (PM-managed work items) as the Tickets board
// shows them. The main process reads them from the vault
// (`~/Projects/work/vault/tickets/<id>-<slug>/ticket.md`); see ozdash/node.
import type { AgentPreset } from './agent-palette';
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
  /**
   * 1 = highest of P1-P4; 0 = a flash ticket (P0: urgent, short work, above P1); null
   * when missing or not a number (shown and sorted as P3).
   */
  priority: number | null;
  /** Manual order within the same priority (lower = higher on the board); null when missing. */
  rank: number | null;
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
  /** Open `## Questions for Oleg` items; `items` lists them all (set by the parser). */
  openQuestions: { count: number; first: string | null; items?: string[] };
  /** The whole file, lowercased, for the search box. */
  searchText: string;
  /**
   * The ticket's `icon.svg` (a validated 16x16 pixel-art SVG), or null when there is
   * none or it is not valid. Set by the main process when it lists the vault.
   */
  icon?: string | null;
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

/** Why a PM session is opened; the Log gets `Started (<reason>)` when the ticket starts. */
export type OpenTicketSessionOptions = {
  /** A new flash ticket, started right after it was created: `Started (flash ticket)`. */
  flash?: boolean;
};

export type OpenTicketSessionResult =
  | { success: true; projectId: string; taskId: string; created: boolean; warning?: string }
  | { success: false; error: string };

/** "New ticket" (PM project) and "Create ticket from this task". */
export type CreateTicketInput = {
  title: string;
  /** Goes under `## Goal`; may be empty. */
  description: string;
  /** 0-4 (0 = flash); missing = 3. */
  priority?: number;
  /** The PM project. */
  projectId: string;
  /** Set to use this existing PM project task as the PM session (no new task). */
  existingTask?: { id: string; name: string };
};

/** The fields the Edit ticket form changes (the same as the New ticket form). */
export type EditableTicketFields = {
  title: string;
  /** The `## Goal` text; may be empty. */
  goal: string;
  /** 0-4 (0 = flash). */
  priority: number;
};

/**
 * "Edit ticket": new values, and the values the form was opened with (`base`, from the
 * file). The save is refused when the file's title, Goal or priority no longer match `base`.
 */
export type EditTicketInput = {
  folder: string;
  values: EditableTicketFields;
  base: { title: string; goal: string; priority: number | null };
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
  setPriority: 'ozdash:set-ticket-priority',
  reorder: 'ozdash:reorder-tickets',
  park: 'ozdash:park-ticket',
  edit: 'ozdash:edit-ticket',
  /** The agent palette (see agent-palette.ts). */
  agentPresets: 'ozdash:list-agent-presets',
  changed: 'ozdash:tickets-changed',
} as const;

/** What the preload script adds to `window.ozdash` for tickets. */
export type OzdashTicketsBridge = {
  listTickets(): Promise<TicketList>;
  onTicketsChanged(callback: (list: TicketList) => void): () => void;
  restoreTicket(folder: string): Promise<TicketActionResult>;
  /** Parked ticket -> dropped. */
  archiveTicket(folder: string): Promise<TicketActionResult>;
  openTicketSession(
    folder: string,
    projectId: string,
    options?: OpenTicketSessionOptions
  ): Promise<OpenTicketSessionResult>;
  /** After a task was created from a ticket (see ticket-issues.ts). */
  linkTicketTask(input: LinkTicketTaskInput): Promise<LinkTicketTaskResult>;
  createTicket(input: CreateTicketInput): Promise<CreateTicketResult>;
  linkPmSession(input: LinkPmSessionInput): Promise<TicketActionResult>;
  /** Writes `priority:` (0-4) with a Log line. */
  setTicketPriority(folder: string, priority: number): Promise<TicketActionResult>;
  /** Rewrites `rank:` (10, 20, 30…) of one priority group, in this order. */
  reorderTickets(folders: string[]): Promise<TicketActionResult>;
  /** A ticket that is not parked or archived -> parked. */
  parkTicket(folder: string): Promise<TicketActionResult>;
  /** Rewrites the title, Goal and priority in place (see EditTicketInput). */
  editTicket(input: EditTicketInput): Promise<TicketActionResult>;
  /** The agent palette's presets (empty when the file is missing). */
  listAgentPresets(): Promise<AgentPreset[]>;
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

/** A flash ticket: urgent, short work (a quick investigation or a quick build). Above P1. */
export const FLASH_PRIORITY = 0;
/** The highest priority ▲ reaches (P0 is set only with the Flash toggle). */
export const MIN_PRIORITY = 1;
export const MAX_PRIORITY = 4;
/** The priority of a ticket without one. */
export const DEFAULT_PRIORITY = 3;

/** The priority the board shows and sorts by: 0-4; missing = 3; out of range = clamped. */
export function effectivePriority(priority: number | null): number {
  if (priority === null || !Number.isFinite(priority)) return DEFAULT_PRIORITY;
  return Math.min(MAX_PRIORITY, Math.max(FLASH_PRIORITY, Math.round(priority)));
}

/** True for a flash ticket (P0). */
export function isFlashPriority(priority: number | null): boolean {
  return priority !== null && effectivePriority(priority) === FLASH_PRIORITY;
}

/** A priority a ticket file may get: an integer 0 (flash) to 4. */
export function isValidPriority(priority: number): boolean {
  return Number.isInteger(priority) && priority >= FLASH_PRIORITY && priority <= MAX_PRIORITY;
}

/**
 * The priority after one ▲ (`up`, higher priority = smaller number) or ▼ (`down`).
 * Null at the ends (P1 and P0 cannot go up, P4 cannot go down). ▼ from P0 is P1.
 */
export function bumpPriority(priority: number | null, direction: 'up' | 'down'): number | null {
  const current = effectivePriority(priority);
  const next = direction === 'up' ? current - 1 : current + 1;
  if (direction === 'up') return current <= MIN_PRIORITY ? null : next;
  return next > MAX_PRIORITY ? null : next;
}

/**
 * Board order: priority (0 = flash first, then 1; missing = 3), then rank (missing after ranked ones),
 * then most recently updated, then id.
 */
export function compareTickets(
  a: Pick<TicketSummary, 'id' | 'priority' | 'rank' | 'updated'>,
  b: Pick<TicketSummary, 'id' | 'priority' | 'rank' | 'updated'>
): number {
  const pa = effectivePriority(a.priority);
  const pb = effectivePriority(b.priority);
  if (pa !== pb) return pa - pb;
  const ra = a.rank ?? Number.MAX_SAFE_INTEGER;
  const rb = b.rank ?? Number.MAX_SAFE_INTEGER;
  if (ra !== rb) return ra - rb;
  const ua = a.updated ?? '';
  const ub = b.updated ?? '';
  if (ua !== ub) return ua < ub ? 1 : -1;
  return Number(a.id) - Number(b.id) || a.id.localeCompare(b.id);
}

/** The manual order of a priority group after a drag: ranks 10, 20, 30… in this order. */
export function ranksForOrder(folders: readonly string[]): Map<string, number> {
  return new Map(folders.map((folder, index) => [folder, (index + 1) * 10]));
}

/**
 * Moves `folder` to the place of `overFolder` inside `group` (the folders of one
 * priority group of a column, in board order). Null when either is not in the group
 * (a drop into another priority group is not allowed) or nothing moves.
 */
export function reorderGroup(
  group: readonly string[],
  folder: string,
  overFolder: string
): string[] | null {
  const from = group.indexOf(folder);
  const to = group.indexOf(overFolder);
  if (from < 0 || to < 0 || from === to) return null;
  const next = [...group];
  next.splice(from, 1);
  next.splice(to, 0, folder);
  return next;
}

/** True when the board offers Park: the ticket is not parked and not archived. */
export function canPark(ticket: Pick<TicketSummary, 'status'>): boolean {
  return ticket.status !== 'parked' && !isArchived(ticket);
}

/** The Goal as one paragraph (for a 3-line card preview); null when there is none. */
export function goalPreview(goal: string | null): string | null {
  const text = (goal ?? '').replace(/\s+/g, ' ').trim();
  return text || null;
}

/** Tickets per column or panel, filtered by the query and sorted by `compareTickets`. */
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

/**
 * The ticket a task belongs to: as its PM session (`pm_session`), else as a child task
 * (the task's ticket marker, by ticket id). Null when neither.
 */
export function ticketForTask(
  taskId: string,
  tickets: readonly TicketSummary[],
  markerTicketId: string | null
): { ticket: TicketSummary; role: 'pm' | 'child' } | null {
  const pm = tickets.find((ticket) => ticket.pmSession === taskId);
  if (pm) return { ticket: pm, role: 'pm' };
  if (!markerTicketId) return null;
  const child = tickets.find((ticket) => ticket.id === markerTicketId);
  return child ? { ticket: child, role: 'child' } : null;
}
