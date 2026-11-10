// Fork (ozimakov-st): the "Sessions" tab in a PM session's right sidebar: every task of
// the ticket, across all projects, with the sidebar's live agent status (rule:
// ozdash/api/ticket-sessions.ts). A click opens the task, like the left sidebar.
import { AgentStatus } from '@emdash/ui/react/components';
import { RelativeTime, ToggleGroup, Tooltip } from '@emdash/ui/react/primitives';
import { Bot, ListTree } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect } from 'react';
import { AgentIcon } from '@core/features/agents/contributions/browser/agent-icon';
import {
  taskAgentStatus,
  taskConversationStats,
} from '@core/features/conversations/api/browser/conversation-selectors';
import {
  refreshTaskTickets,
  taskTicketMarkers,
} from '@core/features/mcp/api/browser/ozdash-task-tickets';
import { attentionRowClass } from '@core/features/ozdash/api/attention';
import { taskAttentionLevel } from '@core/features/ozdash/api/browser/attention';
import { ticketsStore } from '@core/features/ozdash/api/browser/tickets-store';
import {
  mainProviderId,
  selectTicketSessions,
  sessionStatusLabel,
  type TicketSessionTask,
} from '@core/features/ozdash/api/ticket-sessions';
import {
  asAvailableProject,
  getProjectManagerStore,
  projectDisplayName,
} from '@core/features/projects/api/browser/stores/project-selectors';
import { taskManagerStoreToken } from '@core/features/tasks/contributions/browser/project-store-tokens';
import { taskViewDef } from '@core/features/tasks/contributions/views';
import { useNavigate } from '@core/primitives/navigation/browser/navigation-hooks';
import { cn } from '@core/primitives/styling/browser/cn';
import {
  registeredTaskData,
  unregisteredTaskData,
} from '@core/primitives/task-state/browser/task-state';

/** The ticket whose PM session is this task, or null. Call from an `observer`. */
function usePmTicket(taskId: string) {
  useEffect(() => {
    ticketsStore.ensureStarted();
  }, []);
  return ticketsStore.tickets.find((ticket) => ticket.pmSession === taskId) ?? null;
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
      });
    }
  }
  return rows;
}

/** The titlebar toggle for the Sessions tab. Shown only in a ticket's PM session. */
export const OzdashSessionsSidebarToggle = observer(function OzdashSessionsSidebarToggle({
  taskId,
}: {
  taskId: string;
}) {
  const ticket = usePmTicket(taskId);
  if (!ticket) return null;
  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        render={
          <ToggleGroup.Item size="sm" icon value="sessions" aria-label="Sessions">
            <ListTree className="size-3.5" />
          </ToggleGroup.Item>
        }
      />
      <Tooltip.Content>Sessions of ticket #{ticket.id}</Tooltip.Content>
    </Tooltip.Root>
  );
});

export const OzdashSessionsPanel = observer(function OzdashSessionsPanel({
  taskId,
}: {
  taskId: string;
}) {
  const { navigate } = useNavigate();
  const ticket = usePmTicket(taskId);
  const tasks = allTasks();
  // Markers load per task as sidebar rows mount; read them again when the task set changes.
  const taskKey = tasks.map((task) => task.taskId).join(',');
  useEffect(() => {
    refreshTaskTickets();
  }, [taskKey]);

  if (!ticket) {
    return <p className="p-3 text-xs text-foreground-passive">This task is not a PM session.</p>;
  }
  const sessions = selectTicketSessions(ticket, tasks, taskTicketMarkers());

  return (
    <section
      aria-label={`Sessions of ticket ${ticket.id}`}
      className="flex h-full min-h-0 flex-col overflow-y-auto text-xs"
    >
      <div className="border-b border-border px-3 py-2 text-[11px] font-medium text-foreground-passive">
        Ticket #{ticket.id} · {sessions.length} {sessions.length === 1 ? 'session' : 'sessions'}
      </div>
      {sessions.length === 0 ? (
        <p className="p-3 text-foreground-passive">No sessions for this ticket yet.</p>
      ) : (
        <ul className="flex flex-col gap-0.5 p-1.5">
          {sessions.map((row) => (
            <li key={row.taskId}>
              <button
                type="button"
                aria-label={`Open task ${row.name} in ${row.projectName}: ${sessionStatusLabel(row.status)}`}
                onClick={() =>
                  navigate(taskViewDef({ projectId: row.projectId, taskId: row.taskId }))
                }
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-background-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                  attentionRowClass(row.attention)
                )}
              >
                {row.providerId ? (
                  <AgentIcon id={row.providerId} size={16} />
                ) : (
                  <Bot className="size-4 shrink-0 text-foreground-passive" aria-hidden />
                )}
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-foreground">{row.name}</span>
                  <span className="truncate text-[11px] text-foreground-passive">
                    {row.projectName} · {sessionStatusLabel(row.status)}
                  </span>
                </span>
                <AgentStatus status={row.status} size={16} tooltip />
                {row.lastActivity && (
                  <RelativeTime
                    value={row.lastActivity}
                    className="shrink-0 font-sans text-[11px] text-foreground-passive tabular-nums"
                    compact
                  />
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
});
