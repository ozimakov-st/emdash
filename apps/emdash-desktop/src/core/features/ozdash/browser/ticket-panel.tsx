// Fork (ozimakov-st): the Ticket panel in the task's right sidebar (next to Changes /
// Files / Conversations), for a task that is a ticket's PM session (`pm_session`) or a
// child task (ticket marker, or an `emdash: <task id>` ref in the ticket file). The
// "Ticket" toggle in the task titlebar opens it; the sidebar remembers it per task like
// the other tabs. It shows the ticket briefly, then the ticket's Sessions (PM session
// first, then its other tasks and their conversations). Follows the ticket file live.
import { Alert, Button, ToggleGroup, Tooltip } from '@emdash/ui/react/primitives';
import { CircleHelp, KanbanSquare, Pencil, Ticket } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useState } from 'react';
import { useTaskTicketInfo } from '@core/features/mcp/api/browser/ozdash-task-tickets';
import { isPmProjectInWindow } from '@core/features/ozdash/api/browser/ozdash-pm';
import { ticketsStore } from '@core/features/ozdash/api/browser/tickets-store';
import { priorityColor } from '@core/features/ozdash/api/priority-palette';
import { ticketByFileRef } from '@core/features/ozdash/api/ticket-sessions';
import {
  isFlashPriority,
  relativeUpdated,
  ticketForTask,
  type TicketSummary,
} from '@core/features/ozdash/api/tickets';
import { getProjectManagerStore } from '@core/features/projects/api/browser/stores/project-selectors';
import { projectViewDef } from '@core/features/projects/contributions/views';
import { useNavigate } from '@core/primitives/navigation/browser/navigation-hooks';
import { ExpandableText } from './expandable-text';
import { EditTicketDialog } from './new-ticket-form';
import { PriorityChip } from './priority-control';
import { TicketIcon } from './ticket-icon';
import { TicketSessionsSection } from './ticket-sessions-panel';

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
  if (found) return found;
  // A child linked by `/oz-ticket-link` has no marker, only a ref in the ticket file.
  const linked = ticketByFileRef(taskId, ticketsStore.tickets);
  return linked ? { ticket: linked, role: 'child' as const } : null;
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
  const [editing, setEditing] = useState(false);
  if (!found) {
    return <p className="p-3 text-xs text-foreground-passive">This task has no ticket.</p>;
  }
  const { ticket, role } = found;
  const pmId = pmProjectId();
  const { accent } = priorityColor(ticket.priority);
  const questionCount = ticket.openQuestions.items?.length ?? ticket.openQuestions.count;
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
          // A flash ticket (P0) glows a little inside the header.
          ...(isFlashPriority(ticket.priority) && {
            boxShadow: `inset 0 0 18px -8px ${accent}`,
          }),
        }}
      >
        <div className="flex items-center gap-1.5">
          <TicketIcon ticket={ticket} size={24} />
          <span className="shrink-0 font-semibold text-foreground-info">#{ticket.id}</span>
          <PriorityChip priority={ticket.priority} />
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
        <div className="flex flex-wrap gap-1">
          <Button
            type="button"
            size="xs"
            variant="ghost"
            title="Edit the title, Goal and priority"
            onClick={() => setEditing(true)}
          >
            <Pencil className="size-3.5" />
            Edit
          </Button>
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
        </div>
      </div>
      <EditTicketDialog ticket={ticket} open={editing} onOpenChange={setEditing} />
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
      <div className="flex flex-col gap-2 border-b border-border p-3">
        {ticket.goal ? (
          <ExpandableText text={ticket.goal} className="text-foreground" />
        ) : (
          <p className="text-foreground-passive">No goal yet.</p>
        )}
        {ticket.nextStep && (
          <p className="break-words text-foreground-muted">
            <span className="text-[11px] font-medium text-foreground-passive">Next step: </span>
            {ticket.nextStep}
          </p>
        )}
        {questionCount > 0 && (
          <div className="flex items-center gap-1 text-[11px] font-medium text-foreground-warning">
            <CircleHelp className="size-3" aria-hidden />
            {questionCount} open {questionCount === 1 ? 'question' : 'questions'}
          </div>
        )}
      </div>
      <TicketSessionsSection ticket={ticket} taskId={taskId} />
    </section>
  );
});
