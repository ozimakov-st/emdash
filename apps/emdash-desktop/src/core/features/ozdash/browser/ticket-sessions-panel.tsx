// Fork (ozimakov-st): the "Sessions" part of the Ticket tab (any task of a ticket): the
// PM session first, then every other task of the ticket, across all projects, with the
// sidebar's live agent status (rule: ozdash/api/ticket-sessions.ts). A task with two or
// more conversations (executor, reviewers) lists them too. A click opens the task (and
// the conversation), like the left sidebar and the command palette. Archived tasks are
// hidden; "Show archived (n)" at the bottom lists them dimmed, with Restore.
import { AgentStatus } from '@emdash/ui/react/components';
import { Button, RelativeTime } from '@emdash/ui/react/primitives';
import { ArchiveRestore, Bot } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useState } from 'react';
import { AgentIcon } from '@core/features/agents/contributions/browser/agent-icon';
import {
  taskAgentStatus,
  taskConversationStats,
} from '@core/features/conversations/api/browser/conversation-selectors';
import { formatConversationTitleForDisplay } from '@core/features/conversations/api/browser/conversation-title-utils';
import { conversationRegistry } from '@core/features/conversations/api/browser/stores/conversation-registry';
import {
  refreshTaskTickets,
  taskTicketMarkers,
} from '@core/features/mcp/api/browser/ozdash-task-tickets';
import { attentionRowClass } from '@core/features/ozdash/api/attention';
import { taskAttentionLevel } from '@core/features/ozdash/api/browser/attention';
import {
  archivedTicketSessionCount,
  conversationLabel,
  listedConversations,
  mainProviderId,
  sessionStatusLabel,
  ticketSessionRows,
  type TicketSessionConversation,
  type TicketSessionRow,
  type TicketSessionTask,
} from '@core/features/ozdash/api/ticket-sessions';
import type { TicketSummary } from '@core/features/ozdash/api/tickets';
import { ozdashTicketSessionsMemento } from '@core/features/ozdash/contributions/mementos';
import {
  asAvailableProject,
  getProjectManagerStore,
  projectDisplayName,
} from '@core/features/projects/api/browser/stores/project-selectors';
import { taskManagerStoreToken } from '@core/features/tasks/contributions/browser/project-store-tokens';
import { taskViewDef } from '@core/features/tasks/contributions/views';
import { getTaskComposition } from '@core/features/workbench/api/browser/task-composition-selectors';
import { useMemento } from '@core/primitives/mementos/react';
import { useNavigate } from '@core/primitives/navigation/browser/navigation-hooks';
import { cn } from '@core/primitives/styling/browser/cn';
import {
  registeredTaskData,
  unregisteredTaskData,
} from '@core/primitives/task-state/browser/task-state';

/** The task's loaded conversations (empty when the renderer has not loaded them). */
function taskConversations(taskId: string): TicketSessionConversation[] {
  const manager = conversationRegistry.get(taskId);
  if (!manager) return [];
  return [...manager.conversations.values()].map((conversation) => ({
    conversationId: conversation.data.id,
    title: formatConversationTitleForDisplay(
      conversation.data.providerId,
      conversation.data.title ?? ''
    ),
    providerId: conversation.data.providerId,
    model: conversation.data.model || null,
    status: conversation.indicatorStatus,
  }));
}

/** Every task in every open project, as the Sessions list needs it. Call from an `observer`. */
function allTasks(): TicketSessionTask[] {
  const rows: TicketSessionTask[] = [];
  for (const [projectId, store] of getProjectManagerStore().projects.entries()) {
    const project = asAvailableProject(store);
    if (!project) continue;
    const projectName = projectDisplayName(store) ?? projectId;
    for (const task of project.get(taskManagerStoreToken).tasks.values()) {
      if (task.data.type === 'automation-run') continue;
      rows.push({
        taskId: task.data.id,
        projectId,
        name: task.data.name,
        projectName,
        archived:
          task.state !== 'unregistered' && 'archivedAt' in task.data && !!task.data.archivedAt,
        status: taskAgentStatus(task),
        attention: taskAttentionLevel(task),
        // Same instant as the left sidebar's "updated" sort.
        lastActivity:
          registeredTaskData(task)?.lastInteractedAt ??
          registeredTaskData(task)?.updatedAt ??
          unregisteredTaskData(task)?.lastInteractedAt ??
          null,
        providerId: mainProviderId(taskConversationStats(task)),
        conversations: taskConversations(task.data.id),
      });
    }
  }
  return rows;
}

/** Restores an archived task: the same store call as Restore in the left sidebar. */
async function restoreArchivedTask(projectId: string, taskId: string): Promise<void> {
  const store = getProjectManagerStore().projects.get(projectId);
  const project = store ? asAvailableProject(store) : undefined;
  if (!project) throw new Error('The project is not open');
  await project.get(taskManagerStoreToken).restoreTask(taskId);
}

/** The Sessions part of the Ticket tab. Call with the ticket of `taskId`. */
export const TicketSessionsSection = observer(function TicketSessionsSection({
  ticket,
  taskId,
}: {
  ticket: Pick<TicketSummary, 'id' | 'pmSession' | 'searchText'>;
  taskId: string;
}) {
  const { navigate } = useNavigate();
  const tasks = allTasks();
  // Markers load per task as sidebar rows mount; read them again when the task set changes.
  const taskKey = tasks.map((task) => task.taskId).join(',');
  useEffect(() => {
    refreshTaskTickets();
  }, [taskKey]);
  const [panelState, setPanelState] = useMemento(ozdashTicketSessionsMemento);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const markers = taskTicketMarkers();
  const archivedCount = archivedTicketSessionCount(ticket, tasks, markers);
  const showArchived = panelState.showArchived && archivedCount > 0;
  const rows = ticketSessionRows(ticket, tasks, markers, taskId, {
    includeArchived: showArchived,
  });

  const restore = (row: TicketSessionRow) => {
    setRestoring(row.taskId);
    setRestoreError(null);
    restoreArchivedTask(row.projectId, row.taskId)
      .catch((error: unknown) => setRestoreError(`Could not restore ${row.name}: ${String(error)}`))
      .finally(() => setRestoring(null));
  };

  const open = (row: TicketSessionRow, conversationId?: string) => {
    // Select the conversation first (the palette does the same), then open the task.
    const selectConversation = (): boolean => {
      const composition = getTaskComposition(row.projectId, row.taskId);
      if (!conversationId || !composition) return false;
      composition.paneLayout.open('conversation', { conversationId }, { preview: false });
      return true;
    };
    const selected = selectConversation();
    navigate(taskViewDef({ projectId: row.projectId, taskId: row.taskId }));
    // A task not opened yet has no composition before the navigation: try once more.
    if (conversationId && !selected) requestAnimationFrame(() => void selectConversation());
  };

  return (
    <section aria-label={`Sessions of ticket ${ticket.id}`} className="flex flex-col">
      <div className="px-3 pt-1 text-[11px] font-medium text-foreground-passive">
        Sessions · {rows.filter((row) => !row.archived).length}
      </div>
      {rows.length === 0 ? (
        <p className="px-3 py-2 text-foreground-passive">No sessions for this ticket yet.</p>
      ) : (
        <ul className="flex flex-col gap-0.5 p-1.5">
          {rows.map((row) => (
            <li key={row.taskId} className={cn(row.archived && 'opacity-60')}>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label={`Open task ${row.name} in ${row.projectName}: ${row.archived ? 'archived' : sessionStatusLabel(row.status)}`}
                  aria-current={row.current ? 'page' : undefined}
                  onClick={() => open(row)}
                  className={cn(
                    'flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-background-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                    row.current && 'bg-background-2',
                    !row.archived && attentionRowClass(row.attention)
                  )}
                >
                  {row.providerId ? (
                    <AgentIcon id={row.providerId} size={16} />
                  ) : (
                    <Bot className="size-4 shrink-0 text-foreground-passive" aria-hidden />
                  )}
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="flex min-w-0 items-center gap-1">
                      {row.role === 'pm' && (
                        <span className="shrink-0 rounded bg-background-info px-1 text-[10px] font-semibold text-foreground-info">
                          PM
                        </span>
                      )}
                      <span className="truncate text-foreground">{row.name}</span>
                    </span>
                    <span className="truncate text-[11px] text-foreground-passive">
                      {row.projectName} ·{' '}
                      {row.archived ? 'archived' : sessionStatusLabel(row.status)}
                      {row.current && ' · this task'}
                    </span>
                  </span>
                  {!row.archived && <AgentStatus status={row.status} size={16} tooltip />}
                  {row.lastActivity && (
                    <RelativeTime
                      value={row.lastActivity}
                      className="shrink-0 font-sans text-[11px] text-foreground-passive tabular-nums"
                      compact
                    />
                  )}
                </button>
                {row.archived && (
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    title={`Restore ${row.name} (undo archive)`}
                    disabled={restoring === row.taskId}
                    onClick={() => restore(row)}
                  >
                    <ArchiveRestore className="size-3.5" />
                    Restore
                  </Button>
                )}
              </div>
              {listedConversations(row).length > 0 && (
                <ul className="flex flex-col gap-0.5 pl-6">
                  {listedConversations(row).map((conversation) => (
                    <li key={conversation.conversationId}>
                      <button
                        type="button"
                        aria-label={`Open conversation ${conversationLabel(conversation)}: ${sessionStatusLabel(conversation.status)}`}
                        onClick={() => open(row, conversation.conversationId)}
                        className="focus-visible:ring-ring flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-[11px] hover:bg-background-2 focus-visible:ring-2 focus-visible:outline-none"
                      >
                        <AgentIcon id={conversation.providerId} size={12} />
                        <span className="min-w-0 flex-1 truncate text-foreground-muted">
                          {conversationLabel(conversation)}
                        </span>
                        <span className="shrink-0 text-foreground-passive">
                          {sessionStatusLabel(conversation.status)}
                        </span>
                        <AgentStatus status={conversation.status} size={12} tooltip />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
      {restoreError && (
        <p className="px-3 py-1 text-[11px] text-foreground-error">{restoreError}</p>
      )}
      {archivedCount > 0 && (
        <button
          type="button"
          aria-pressed={showArchived}
          onClick={() =>
            setPanelState((state) => ({ ...state, showArchived: !state.showArchived }))
          }
          className="focus-visible:ring-ring mx-3 mb-1 self-start rounded text-[11px] text-foreground-passive hover:text-foreground focus-visible:ring-2 focus-visible:outline-none"
        >
          {showArchived ? 'Hide archived' : 'Show archived'} ({archivedCount})
        </button>
      )}
    </section>
  );
});
