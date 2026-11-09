// Fork (ozimakov-st): the ticket panel at the top of a task view, for a task that is a
// ticket's PM session (`pm_session`) or a child task (ticket marker). Collapsible (one
// state for all tasks, remembered); follows the ticket file live (vault watcher).
import { Button } from '@emdash/ui/react/primitives';
import { ChevronDown, ChevronRight, CircleHelp, Hourglass, KanbanSquare, Bot } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, type ReactNode } from 'react';
import { useTaskTicketInfo } from '@core/features/mcp/api/browser/ozdash-task-tickets';
import { isPmProjectInWindow } from '@core/features/ozdash/api/browser/ozdash-pm';
import { ticketsStore } from '@core/features/ozdash/api/browser/tickets-store';
import { priorityChipStyle, priorityColor } from '@core/features/ozdash/api/priority-palette';
import {
  effectivePriority,
  relativeUpdated,
  ticketForTask,
  type TicketSummary,
} from '@core/features/ozdash/api/tickets';
import {
  ozdashTicketPanelMemento,
  toggleTicketPanelCollapsed,
} from '@core/features/ozdash/contributions/mementos';
import { getProjectManagerStore } from '@core/features/projects/api/browser/stores/project-selectors';
import { projectViewDef } from '@core/features/projects/contributions/views';
import { getTaskManagerStore } from '@core/features/tasks/api/browser/task-state/task-selectors';
import { taskViewDef } from '@core/features/tasks/contributions/views';
import { useMemento } from '@core/primitives/mementos/react';
import { useNavigate } from '@core/primitives/navigation/browser/navigation-hooks';
import { cn } from '@core/primitives/styling/browser/cn';
import { TicketIcon } from './ticket-icon';

/** The PM project's id in this window, or null. Call from an `observer`. */
function pmProjectId(): string | null {
  for (const [id, store] of getProjectManagerStore().projects.entries()) {
    if (isPmProjectInWindow(store)) return id;
  }
  return null;
}

const STATUS_LABEL: Record<TicketSummary['status'], string> = {
  parked: 'Parked',
  active: 'Active',
  waiting: 'Waiting',
  blocked: 'Blocked',
  done: 'Done',
  dropped: 'Dropped',
};

export const OzdashTicketPanel = observer(function OzdashTicketPanel({
  taskId,
}: {
  taskId: string;
}) {
  const { navigate } = useNavigate();
  const marker = useTaskTicketInfo(taskId);
  const [state, setState] = useMemento(ozdashTicketPanelMemento);
  useEffect(() => {
    ticketsStore.ensureStarted();
  }, []);

  const found = ticketForTask(taskId, ticketsStore.tickets, marker?.ticket.id ?? null);
  if (!found) return null;
  const { ticket, role } = found;
  const pmId = pmProjectId();
  // A child task's PM session: the marker's, else the ticket's `pm_session` when it is live.
  const pmSession =
    role !== 'child'
      ? null
      : marker?.pmSession
        ? { projectId: marker.pmSession.projectId, taskId: marker.pmSession.taskId }
        : ticket.pmSession && pmId && getTaskManagerStore(pmId)?.tasks.has(ticket.pmSession)
          ? { projectId: pmId, taskId: ticket.pmSession }
          : null;
  const collapsed = state.collapsed;
  const priority = effectivePriority(ticket.priority);
  const { accent, name } = priorityColor(ticket.priority);
  const questions =
    ticket.openQuestions.items ?? (ticket.openQuestions.first ? [ticket.openQuestions.first] : []);
  const waiting = ticket.waitingOn.map((row) =>
    row.owner && row.what ? `${row.owner}: ${row.what}` : row.owner || row.what
  );
  const updated = relativeUpdated(ticket.updated, new Date());

  return (
    <section
      aria-label={`Ticket ${ticket.id}`}
      className="mx-2 mt-2 shrink-0 rounded-md border border-l-[3px] text-xs"
      style={{
        backgroundColor: `color-mix(in srgb, ${accent} 8%, var(--color-background))`,
        borderColor: `color-mix(in srgb, ${accent} 30%, var(--color-border))`,
        borderLeftColor: accent,
      }}
    >
      <div className="flex h-8 items-center gap-2 px-2">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? 'Show' : 'Hide'} ticket ${ticket.id} details`}
          onClick={() => setState(toggleTicketPanelCollapsed)}
        >
          {collapsed ? (
            <ChevronRight className="size-3.5 shrink-0 text-foreground-passive" />
          ) : (
            <ChevronDown className="size-3.5 shrink-0 text-foreground-passive" />
          )}
          <TicketIcon ticket={ticket} size={collapsed ? 16 : 32} />
          <span className="shrink-0 font-semibold text-foreground-info">#{ticket.id}</span>
          <span className="min-w-0 truncate font-medium text-foreground" title={ticket.title}>
            {ticket.title}
          </span>
          <span
            className="shrink-0 rounded border px-1 text-[11px] leading-4 font-semibold text-foreground tabular-nums"
            style={priorityChipStyle(ticket.priority)}
            title={`Priority ${priority} (${name})`}
          >
            P{priority}
          </span>
          <span className="shrink-0 text-foreground-muted">
            {STATUS_LABEL[ticket.status]}
            {ticket.needsOleg && ticket.status !== 'blocked' ? ' · needs Oleg' : ''}
          </span>
          {role === 'child' && (
            <span className="shrink-0 text-foreground-passive">· child task</span>
          )}
        </button>
        {updated && (
          <span
            className="shrink-0 text-[11px] text-foreground-passive tabular-nums"
            title={ticket.updated ? `Updated ${ticket.updated}` : undefined}
          >
            {updated}
          </span>
        )}
        {pmId && (
          <Button
            type="button"
            size="xs"
            variant="ghost"
            title="Open the Tickets board"
            onClick={() => {
              ticketsStore.setBoardSelected(true);
              navigate(projectViewDef({ projectId: pmId }));
            }}
          >
            <KanbanSquare className="size-3.5" />
            Board
          </Button>
        )}
        {pmSession && (
          <Button
            type="button"
            size="xs"
            variant="ghost"
            title="Open the ticket's PM session"
            onClick={() => navigate(taskViewDef(pmSession))}
          >
            <Bot className="size-3.5" />
            PM session
          </Button>
        )}
      </div>
      {!collapsed && (
        <div className="flex max-h-56 flex-col gap-2 overflow-y-auto px-3 pb-2.5">
          <Field label="Goal">
            <p
              className={cn(
                'whitespace-pre-wrap',
                ticket.goal ? 'text-foreground' : 'text-foreground-passive'
              )}
            >
              {ticket.goal ?? 'No goal yet.'}
            </p>
          </Field>
          {ticket.nextStep && (
            <Field label="Next step">
              <p className="text-foreground-muted">{ticket.nextStep}</p>
            </Field>
          )}
          {waiting.length > 0 && (
            <Field label="Waiting on" icon={<Hourglass className="size-3" aria-hidden />}>
              <ul className="list-disc pl-4 text-foreground-muted">
                {waiting.map((text, index) => (
                  <li key={index}>{text}</li>
                ))}
              </ul>
            </Field>
          )}
          {questions.length > 0 && (
            <Field
              label={`Open questions (${questions.length})`}
              icon={<CircleHelp className="size-3" aria-hidden />}
              warning
            >
              <ul className="list-disc pl-4 text-foreground">
                {questions.map((text, index) => (
                  <li key={index}>{text}</li>
                ))}
              </ul>
            </Field>
          )}
        </div>
      )}
    </section>
  );
});

function Field({
  label,
  icon,
  warning,
  children,
}: {
  label: string;
  icon?: ReactNode;
  warning?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <div
        className={cn(
          'flex items-center gap-1 text-[11px] font-medium',
          warning ? 'text-foreground-warning' : 'text-foreground-passive'
        )}
      >
        {icon}
        {label}
      </div>
      {children}
    </div>
  );
}
