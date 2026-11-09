// Fork (ozimakov-st): the Ticket panel in the task's right sidebar (next to Changes /
// Files / Conversations), for a task that is a ticket's PM session (`pm_session`) or a
// child task (ticket marker). The "Ticket" toggle in the task titlebar opens it; the
// sidebar remembers it per task like the other tabs. Follows the ticket file live.
import { Alert, Button, ToggleGroup, Tooltip } from '@emdash/ui/react/primitives';
import { Bot, CircleHelp, Hourglass, KanbanSquare, Ticket } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, type ReactNode } from 'react';
import { useTaskTicketInfo } from '@core/features/mcp/api/browser/ozdash-task-tickets';
import { isPmProjectInWindow } from '@core/features/ozdash/api/browser/ozdash-pm';
import { ticketsStore } from '@core/features/ozdash/api/browser/tickets-store';
import { priorityColor } from '@core/features/ozdash/api/priority-palette';
import {
  relativeUpdated,
  ticketForTask,
  type TicketSummary,
} from '@core/features/ozdash/api/tickets';
import { getProjectManagerStore } from '@core/features/projects/api/browser/stores/project-selectors';
import { projectViewDef } from '@core/features/projects/contributions/views';
import { getTaskManagerStore } from '@core/features/tasks/api/browser/task-state/task-selectors';
import { taskViewDef } from '@core/features/tasks/contributions/views';
import { useNavigate } from '@core/primitives/navigation/browser/navigation-hooks';
import { cn } from '@core/primitives/styling/browser/cn';
import { PriorityControl } from './priority-control';
import { TicketIcon } from './ticket-icon';

/** The PM project's id in this window, or null. Call from an `observer`. */
function pmProjectId(): string | null {
  for (const [id, store] of getProjectManagerStore().projects.entries()) {
    if (isPmProjectInWindow(store)) return id;
  }
  return null;
}

/** The task's ticket (and the task's role for it), or null. Call from an `observer`. */
function useTaskTicket(taskId: string) {
  const marker = useTaskTicketInfo(taskId);
  useEffect(() => {
    ticketsStore.ensureStarted();
  }, []);
  const found = ticketForTask(taskId, ticketsStore.tickets, marker?.ticket.id ?? null);
  return found ? { ...found, marker } : null;
}

const STATUS_LABEL: Record<TicketSummary['status'], string> = {
  parked: 'Parked',
  active: 'Active',
  waiting: 'Waiting',
  blocked: 'Blocked',
  done: 'Done',
  dropped: 'Dropped',
};

/** The titlebar toggle for the Ticket panel. Shown only when the task has a ticket. */
export const OzdashTicketSidebarToggle = observer(function OzdashTicketSidebarToggle({
  taskId,
}: {
  taskId: string;
}) {
  const found = useTaskTicket(taskId);
  if (!found) return null;
  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        render={
          <ToggleGroup.Item size="sm" icon value="ticket" aria-label="Ticket">
            <Ticket className="size-3.5" />
          </ToggleGroup.Item>
        }
      />
      <Tooltip.Content>Ticket #{found.ticket.id}</Tooltip.Content>
    </Tooltip.Root>
  );
});

export const OzdashTicketPanel = observer(function OzdashTicketPanel({
  taskId,
}: {
  taskId: string;
}) {
  const { navigate } = useNavigate();
  const found = useTaskTicket(taskId);
  if (!found) {
    return <p className="p-3 text-xs text-foreground-passive">This task has no ticket.</p>;
  }
  const { ticket, role, marker } = found;
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
  const { accent } = priorityColor(ticket.priority);
  const questions =
    ticket.openQuestions.items ?? (ticket.openQuestions.first ? [ticket.openQuestions.first] : []);
  const waiting = ticket.waitingOn.map((row) =>
    row.owner && row.what ? `${row.owner}: ${row.what}` : row.owner || row.what
  );
  const updated = relativeUpdated(ticket.updated, new Date());

  return (
    <section
      aria-label={`Ticket ${ticket.id}`}
      className="flex h-full min-h-0 flex-col overflow-y-auto text-xs"
    >
      <div
        className="flex flex-col gap-1.5 border-b border-l-[3px] p-3"
        style={{
          backgroundColor: `color-mix(in srgb, ${accent} 8%, var(--color-background))`,
          borderBottomColor: `color-mix(in srgb, ${accent} 30%, var(--color-border))`,
          borderLeftColor: accent,
        }}
      >
        <div className="flex items-center gap-1.5">
          <TicketIcon ticket={ticket} size={32} />
          <span className="shrink-0 font-semibold text-foreground-info">#{ticket.id}</span>
          <PriorityControl ticket={ticket} />
          {updated && (
            <span
              className="ml-auto shrink-0 text-[11px] text-foreground-passive tabular-nums"
              title={ticket.updated ? `Updated ${ticket.updated}` : undefined}
            >
              {updated}
            </span>
          )}
        </div>
        <div className="text-sm font-medium break-words text-foreground">{ticket.title}</div>
        <div className="text-foreground-muted">
          {STATUS_LABEL[ticket.status]}
          {ticket.needsOleg && ticket.status !== 'blocked' ? ' · needs Oleg' : ''}
          {role === 'child' && <span className="text-foreground-passive"> · child task</span>}
        </div>
        {(pmId || pmSession) && (
          <div className="flex flex-wrap gap-1">
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
        )}
      </div>
      {ticketsStore.notice && (
        <div className="px-3 pt-3">
          <Alert.Root
            status={ticketsStore.notice.tone === 'error' ? 'destructive' : 'warning'}
            onDismiss={() => ticketsStore.setNotice(null)}
          >
            {ticketsStore.notice.text}
          </Alert.Root>
        </div>
      )}
      <div className="flex flex-col gap-3 p-3">
        <Field label="Goal">
          <p
            className={cn(
              'break-words whitespace-pre-wrap',
              ticket.goal ? 'text-foreground' : 'text-foreground-passive'
            )}
          >
            {ticket.goal ?? 'No goal yet.'}
          </p>
        </Field>
        {ticket.nextStep && (
          <Field label="Next step">
            <p className="break-words text-foreground-muted">{ticket.nextStep}</p>
          </Field>
        )}
        {waiting.length > 0 && (
          <Field label="Waiting on" icon={<Hourglass className="size-3" aria-hidden />}>
            <ul className="list-disc pl-4 break-words text-foreground-muted">
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
            <ul className="list-disc pl-4 break-words text-foreground">
              {questions.map((text, index) => (
                <li key={index}>{text}</li>
              ))}
            </ul>
          </Field>
        )}
      </div>
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
