// Fork (ozimakov-st): the "Sessions" tab of a PM session lists every task of its ticket,
// across all projects. A task belongs to the ticket when its ticket marker (MCP
// create_task, "New task…" from a ticket) has the ticket id, or when the ticket file
// has a Dependencies row with `emdash: <task id>` (`/oz-ticket-link` writes only that).
import type { AgentStatus } from '@core/primitives/agents/api';
import type { AttentionLevel } from './attention';
import type { TicketSummary } from './tickets';

/** One task as the Sessions list needs it (read from the live renderer stores). */
export type TicketSessionTask = {
  taskId: string;
  projectId: string;
  name: string;
  projectName: string;
  archived: boolean;
  /** The sidebar's live status (`taskAgentStatus`); null = idle. */
  status: AgentStatus | null;
  /** The sidebar's attention mark (`taskAttentionLevel`). */
  attention: AttentionLevel | null;
  /** ISO time of the last activity (`lastInteractedAt ?? updatedAt`), or null. */
  lastActivity: string | null;
  /** The agent of the task's main conversation, or null. */
  providerId: string | null;
};

/** Task ids the ticket file names in `emdash: <task id>` refs (Dependencies `child` rows). */
export function ticketFileTaskIds(ticket: Pick<TicketSummary, 'searchText'>): Set<string> {
  const ids = new Set<string>();
  for (const match of ticket.searchText.matchAll(/emdash:\s*([\w-]+)/g)) ids.add(match[1]);
  return ids;
}

/** 0 = needs Oleg (awaiting input / error), 1 = working, 2 = the rest. */
export function sessionSortGroup(task: Pick<TicketSessionTask, 'status' | 'attention'>): number {
  if (task.attention === 'input' || task.status === 'awaiting-input' || task.status === 'error') {
    return 0;
  }
  return task.status === 'working' ? 1 : 2;
}

/**
 * The ticket's sessions: tasks with its marker or named in its file, minus the PM
 * session and archived tasks. Needs-attention first, then working, then the rest; most
 * recent activity first inside each group.
 */
export function selectTicketSessions(
  ticket: Pick<TicketSummary, 'id' | 'pmSession' | 'searchText'>,
  tasks: readonly TicketSessionTask[],
  markers: ReadonlyMap<string, { ticket: { id: string } }>
): TicketSessionTask[] {
  const fileIds = ticketFileTaskIds(ticket);
  return tasks
    .filter(
      (task) =>
        !task.archived &&
        task.taskId !== ticket.pmSession &&
        (markers.get(task.taskId)?.ticket.id === ticket.id || fileIds.has(task.taskId))
    )
    .sort(
      (a, b) =>
        sessionSortGroup(a) - sessionSortGroup(b) ||
        (b.lastActivity ?? '').localeCompare(a.lastActivity ?? '') ||
        a.taskId.localeCompare(b.taskId)
    );
}

/** The agent with the most conversations in `stats` (providerId -> count), or null. */
export function mainProviderId(stats: Record<string, number>): string | null {
  let best: string | null = null;
  for (const [id, count] of Object.entries(stats)) {
    if (best === null || count > stats[best]) best = id;
  }
  return best;
}

const STATUS_LABEL: Record<AgentStatus, string> = {
  working: 'Working',
  'awaiting-input': 'Awaiting input',
  error: 'Error',
  completed: 'Completed',
  idle: 'Idle',
};

/** A short status word for a row (null = idle). */
export function sessionStatusLabel(status: AgentStatus | null): string {
  return STATUS_LABEL[status ?? 'idle'];
}
