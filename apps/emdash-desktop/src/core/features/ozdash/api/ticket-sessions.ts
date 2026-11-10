// Fork (ozimakov-st): the Sessions list of the Ticket tab (any task of a ticket) shows the
// ticket's PM session first, then every other task of the ticket, across all projects. A
// task belongs to the ticket when its ticket marker (MCP create_task, "New task…" from a
// ticket) has the ticket id, or when the ticket file has a Dependencies row with
// `emdash: <task id>` (`/oz-ticket-link` writes only that).
import type { AgentStatus } from '@core/primitives/agents/api';
import type { AttentionLevel } from './attention';
import type { TicketSummary } from './tickets';

/** One conversation (agent session) of a task, for the Sessions list. */
export type TicketSessionConversation = {
  conversationId: string;
  title: string;
  providerId: string;
  /** The model passed to the agent CLI, or null (CLI default). */
  model: string | null;
  /** The conversation's indicator status (null = idle or seen). */
  status: AgentStatus | null;
};

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
  /** The task's conversations, when the renderer has loaded them (else empty). */
  conversations: TicketSessionConversation[];
};

/** A row of the Sessions list: the PM session or a peer task, maybe the current task. */
export type TicketSessionRow = TicketSessionTask & { role: 'pm' | 'peer'; current: boolean };

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

/** The ticket whose file names this task in an `emdash: <task id>` ref, or null. */
export function ticketByFileRef<T extends Pick<TicketSummary, 'searchText'>>(
  taskId: string,
  tickets: readonly T[]
): T | null {
  return tickets.find((ticket) => ticketFileTaskIds(ticket).has(taskId)) ?? null;
}

/**
 * The Sessions list: the PM session first (when it is open and not archived), then the
 * ticket's other tasks as `selectTicketSessions` sorts them. `current` marks the task
 * whose Ticket tab shows the list.
 */
export function ticketSessionRows(
  ticket: Pick<TicketSummary, 'id' | 'pmSession' | 'searchText'>,
  tasks: readonly TicketSessionTask[],
  markers: ReadonlyMap<string, { ticket: { id: string } }>,
  currentTaskId: string
): TicketSessionRow[] {
  const pm = ticket.pmSession
    ? tasks.find((task) => task.taskId === ticket.pmSession && !task.archived)
    : undefined;
  const rows: TicketSessionRow[] = pm ? [{ ...pm, role: 'pm', current: false }] : [];
  for (const task of selectTicketSessions(ticket, tasks, markers)) {
    rows.push({ ...task, role: 'peer', current: false });
  }
  return rows.map((row) => ({ ...row, current: row.taskId === currentTaskId }));
}

/** The conversations to list under a row: all of them, but only when there are two or more. */
export function listedConversations(
  row: Pick<TicketSessionTask, 'conversations'>
): TicketSessionConversation[] {
  return row.conversations.length > 1 ? row.conversations : [];
}

/** A conversation's label, for example `Review · cursor cursor-grok-4.6-high`. */
export function conversationLabel(
  conversation: Pick<TicketSessionConversation, 'title' | 'providerId' | 'model'>
): string {
  const agent = [conversation.providerId, conversation.model].filter(Boolean).join(' ');
  const title = conversation.title.trim();
  return title && title.toLowerCase() !== agent.toLowerCase() ? `${title} · ${agent}` : agent;
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
