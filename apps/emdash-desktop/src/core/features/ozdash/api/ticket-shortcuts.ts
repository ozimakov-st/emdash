// Fork (ozimakov-st): pure rules for the ticket shortcuts and the board double-click.
// - ⌥⌘B "Open Tickets Board": the PM project's Tickets board, from anywhere.
// - ⌥⌘T "Toggle Ticket Panel": the open task's Ticket tab (only for a task with a ticket).
// - Double-click on a card / parked row: open the live PM session, else ask to start.
import { ticketByFileRef } from './ticket-sessions';
import { isArchived, ticketForTask, type TicketSummary } from './tickets';

/** The first project (by id) that is the PM project, or null. */
export function pmProjectIdIn<T>(
  projects: Iterable<readonly [string, T]>,
  isPm: (project: T) => boolean
): string | null {
  for (const [id, project] of projects) if (isPm(project)) return id;
  return null;
}

/** The task the window shows (navigation ref of the `task` view), or null. */
export function currentTaskOf(ref: {
  viewId: string;
  params: unknown;
}): { projectId: string; taskId: string } | null {
  if (ref.viewId !== 'task') return null;
  const params = ref.params as { projectId?: unknown; taskId?: unknown } | null;
  if (typeof params?.projectId !== 'string' || typeof params.taskId !== 'string') return null;
  if (!params.projectId || !params.taskId) return null;
  return { projectId: params.projectId, taskId: params.taskId };
}

/**
 * The task's ticket and the task's role for it: its PM session (`pm_session`), a child
 * with a marker, or a child named by an `emdash: <task id>` ref in the ticket file.
 */
export function taskTicket<T extends TicketSummary>(
  taskId: string,
  tickets: readonly T[],
  markerTicketId: string | null
): { ticket: T; role: 'pm' | 'child' } | null {
  const found = ticketForTask(taskId, tickets, markerTicketId);
  if (found) return found as { ticket: T; role: 'pm' | 'child' };
  const linked = ticketByFileRef(taskId, tickets);
  return linked ? { ticket: linked, role: 'child' } : null;
}

/** Where "Toggle Ticket Panel" acts: the open task when it has a ticket, else null. */
export function ticketPanelTarget(
  ref: { viewId: string; params: unknown },
  tickets: readonly TicketSummary[],
  markerTicketId: (taskId: string) => string | null
): { projectId: string; taskId: string } | null {
  const task = currentTaskOf(ref);
  if (!task) return null;
  return taskTicket(task.taskId, tickets, markerTicketId(task.taskId)) ? task : null;
}

/** What a double-click on a ticket does. */
export type TicketDoubleClickAction = 'open-session' | 'confirm-start' | 'none';

/**
 * `open-session` when the ticket has a live PM session (`pm_session` names a task that
 * exists and is not archived); `confirm-start` otherwise; `none` for archived tickets.
 * `pmTask` is the task `pm_session` names, or null when it is not in the PM project.
 */
export function ticketDoubleClickAction(
  ticket: Pick<TicketSummary, 'status' | 'pmSession'>,
  pmTask: { archived: boolean } | null
): TicketDoubleClickAction {
  if (isArchived(ticket)) return 'none';
  if (ticket.pmSession && pmTask && !pmTask.archived) return 'open-session';
  return 'confirm-start';
}

/** The confirm text before a double-click starts a ticket. */
export function startTicketQuestion(ticket: Pick<TicketSummary, 'id' | 'title'>): string {
  return `Start ticket #${ticket.id} — ${ticket.title}?`;
}
