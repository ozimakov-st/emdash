// Fork (ozimakov-st): "No ticket" chip in the task header of a PM project task that no
// ticket's `pm_session` points to (in the PM project, every task should be the PM
// session of exactly one ticket). Its menu: "Link to ticket…" and "Create ticket from
// this task". The sidebar marker is in workbench/browser/sidebar/ozdash-pm-session-badge.tsx.
import { Badge, Dialog, DropdownMenu, toast } from '@emdash/ui/react/primitives';
import { CircleDashed, Link2, Plus } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { isPmProjectInWindow } from '@core/features/ozdash/api/browser/ozdash-pm';
import { pmTaskNeedsTicket, ticketsStore } from '@core/features/ozdash/api/browser/tickets-store';
import { isArchived, linkableTickets, type TicketSummary } from '@core/features/ozdash/api/tickets';
import { getProjectStore } from '@core/features/projects/api/browser/stores/project-selectors';
import {
  getTaskManagerStore,
  getTaskStore,
} from '@core/features/tasks/api/browser/task-state/task-selectors';
import { NewTicketForm } from './new-ticket-form';

const NO_TICKET_TOOLTIP = 'No ticket has this task as its PM session.';

/** True for a PM project task that is no ticket's PM session. Call from an `observer`. */
function needsTicket(projectId: string, taskId: string): boolean {
  return isPmProjectInWindow(getProjectStore(projectId)) && pmTaskNeedsTicket(taskId);
}

/** Task header chip with "Link to ticket…" and "Create ticket from this task". */
export const OzdashNoTicketChip = observer(function OzdashNoTicketChip({
  projectId,
  taskId,
}: {
  projectId: string;
  taskId: string;
}) {
  const [creating, setCreating] = useState(false);
  const [linking, setLinking] = useState(false);
  if (!needsTicket(projectId, taskId)) return null;
  const taskName = getTaskStore(projectId, taskId)?.data.name ?? taskId;
  const tasks = getTaskManagerStore(projectId)?.tasks;
  const candidates = linkableTickets(ticketsStore.tickets, (id) => !!tasks?.has(id));

  const link = async (ticket: TicketSummary) => {
    if (linking) return;
    setLinking(true);
    try {
      const result = await ticketsStore.linkPmSession({
        folder: ticket.folder,
        projectId,
        taskId,
        taskName,
      });
      if (!result.success)
        toast.error(`Could not link ticket #${ticket.id}`, { description: result.error });
      else if (result.warning)
        toast.warning(`Linked to ticket #${ticket.id}`, { description: result.warning });
      else toast.success(`Linked to ticket #${ticket.id}`);
    } finally {
      setLinking(false);
    }
  };

  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          aria-label="No ticket: link or create one"
          title={NO_TICKET_TOOLTIP}
          disabled={linking}
          className="hover:bg-muted/30 flex items-center gap-1 rounded-md border border-dashed border-border px-1.5 py-0.5 text-xs text-foreground-muted"
        >
          <CircleDashed className="h-3 w-3 shrink-0" />
          <span className="shrink-0">{linking ? 'Linking…' : 'No ticket'}</span>
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="start">
          <DropdownMenu.Sub>
            <DropdownMenu.SubTrigger>
              <Link2 className="size-4" />
              Link to ticket…
            </DropdownMenu.SubTrigger>
            <DropdownMenu.SubContent className="max-h-80 overflow-y-auto">
              {candidates.length === 0 ? (
                <DropdownMenu.Item disabled>No ticket without a PM session</DropdownMenu.Item>
              ) : (
                candidates.map((ticket) => (
                  <DropdownMenu.Item key={ticket.folder} onClick={() => void link(ticket)}>
                    <span className="font-semibold text-foreground-info">#{ticket.id}</span>
                    <span className="max-w-64 truncate">{ticket.title}</span>
                    {isArchived(ticket) && <Badge variant="outline">{ticket.status}</Badge>}
                  </DropdownMenu.Item>
                ))
              )}
            </DropdownMenu.SubContent>
          </DropdownMenu.Sub>
          <DropdownMenu.Item onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            Create ticket from this task
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
      <Dialog.Root open={creating} onOpenChange={setCreating}>
        {creating && (
          <Dialog.Content size="sm">
            <NewTicketForm
              projectId={projectId}
              existingTask={{ id: taskId, name: taskName }}
              initialTitle={taskName}
              onDone={() => setCreating(false)}
              onCancel={() => setCreating(false)}
            />
          </Dialog.Content>
        )}
      </Dialog.Root>
    </>
  );
});
