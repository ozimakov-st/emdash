// Fork (ozimakov-st): a "ticket" marks an Emdash task that a PM session started
// through the MCP create_task tool, and for which of Oleg's tickets.
import { z } from 'zod';

export const TICKET_ID_MAX = 32;
export const TICKET_TITLE_MAX = 200;
const PM_SESSION_ID_MAX = 64;

/** The `ticket` argument of create_task. Blank optional strings count as absent. */
export const ticketInputSchema = z.object({
  id: z
    .string()
    .trim()
    .min(1, 'ticket.id must not be empty')
    .max(TICKET_ID_MAX, `ticket.id must be at most ${TICKET_ID_MAX} characters`)
    .describe('The ticket id, for example "123"'),
  title: z
    .string()
    .trim()
    .max(TICKET_TITLE_MAX, `ticket.title must be at most ${TICKET_TITLE_MAX} characters`)
    .optional()
    .describe('The ticket title'),
  pmSessionId: z
    .string()
    .trim()
    .max(PM_SESSION_ID_MAX, `ticket.pmSessionId must be at most ${PM_SESSION_ID_MAX} characters`)
    .optional()
    .describe('The Emdash task id of the PM session that controls this task'),
});

/** Who made the task: a PM session (MCP create_task) or Oleg (New Task dialog, OZ ticket). */
export type TaskTicketOrigin = 'pm' | 'oleg';

export type TaskTicket = {
  id: string;
  title?: string;
  pmSessionId?: string;
  /** Not part of the create_task input; set by the code path that saves the marker. */
  createdBy?: TaskTicketOrigin;
};

/** What the renderer gets for one ticket-controlled task. */
export type TaskTicketInfo = {
  ticket: TaskTicket;
  /** The PM session task, when `pmSessionId` points to a task that still exists. */
  pmSession: { taskId: string; projectId: string; name: string } | null;
  /** The task talks to its PM session only: no attention marks for Oleg (`isMutedPmTask`). */
  muted: boolean;
};

/**
 * True for a task that a ticket's PM session manages: its marker says a PM session made
 * it (MCP create_task). Markers saved before `createdBy` existed count as PM-made when
 * they name a PM session. The PM session itself is never PM-managed.
 */
export function isPmManagedTask(taskId: string, ticket: TaskTicket | null | undefined): boolean {
  if (!ticket || ticket.pmSessionId === taskId) return false;
  if (ticket.createdBy) return ticket.createdBy === 'pm';
  return !!ticket.pmSessionId;
}

/** `OZDASH_MUTE_PM_TASKS=off` turns muting off (PM-managed tasks notify Oleg again). */
export function mutePmTasksEnabled(env: Record<string, string | undefined>): boolean {
  return env.OZDASH_MUTE_PM_TASKS?.trim().toLowerCase() !== 'off';
}

/**
 * The one rule for Oleg's attention signals (chime, banner, amber row, Dock badge,
 * project count): a PM-managed task talks to its PM session only, so it gives none.
 */
export function isMutedPmTask(
  taskId: string,
  ticket: TaskTicket | null | undefined,
  mutePmTasks: boolean
): boolean {
  return mutePmTasks && isPmManagedTask(taskId, ticket);
}

/** Main-process invoke channel: returns `Record<emdashTaskId, TaskTicketInfo>`. */
export const OZDASH_TASK_TICKETS_CHANNEL = 'ozdash:list-task-tickets';

/** Parses a raw `ticket` argument into its stored form, dropping blank optional fields. */
export function parseTaskTicket(
  raw: unknown
): { success: true; data: TaskTicket } | { success: false; error: string } {
  const parsed = ticketInputSchema.safeParse(raw);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((issue) => issue.message).join('; ') };
  }
  const { id, title, pmSessionId } = parsed.data;
  return {
    success: true,
    data: { id, ...(title && { title }), ...(pmSessionId && { pmSessionId }) },
  };
}

/** Sidebar badge text, for example `Ticket #123`. */
export function ticketBadgeText(ticket: TaskTicket): string {
  return `Ticket #${ticket.id}`;
}

/** Tooltip text, for example `Ticket #123: Fix login (PM session: PM 123)`. */
export function ticketTooltip(info: TaskTicketInfo): string {
  const { id, title } = info.ticket;
  const base = title ? `Ticket #${id}: ${title}` : `Ticket #${id}`;
  return info.pmSession ? `${base} (PM session: ${info.pmSession.name})` : base;
}

/** Task header chip: the `Ticket #123` label and the title cut to `maxTitle` characters. */
export function ticketChipText(
  ticket: TaskTicket,
  maxTitle = 40
): { label: string; title: string | null } {
  const title = ticket.title ?? null;
  return {
    label: `Ticket #${ticket.id}`,
    title: title && title.length > maxTitle ? `${title.slice(0, maxTitle - 1).trimEnd()}…` : title,
  };
}
