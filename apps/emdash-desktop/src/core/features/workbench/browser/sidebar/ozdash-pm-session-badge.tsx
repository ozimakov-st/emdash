// Fork (ozimakov-st): `#<id>` badge on a PM project task that is some ticket's PM
// session (its id is the ticket's `pm_session`), else a muted "no ticket" marker.
// Uses the Tickets board's list.
import { Tooltip } from '@emdash/ui/react/primitives';
import { observer } from 'mobx-react-lite';
import {
  pmTaskNeedsTicket,
  ticketForPmSession,
} from '@core/features/ozdash/api/browser/tickets-store';

export const OzdashPmSessionBadge = observer(function OzdashPmSessionBadge({
  taskId,
}: {
  taskId: string;
}) {
  const ticket = ticketForPmSession(taskId);
  if (!ticket) {
    if (!pmTaskNeedsTicket(taskId)) return null;
    return (
      <Tooltip.Root>
        <Tooltip.Trigger
          render={
            <span className="shrink-0 rounded-md border border-dashed border-border px-1 text-[10px] whitespace-nowrap text-foreground-passive" />
          }
        >
          no ticket
        </Tooltip.Trigger>
        <Tooltip.Content>No ticket has this task as its PM session.</Tooltip.Content>
      </Tooltip.Root>
    );
  }
  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        render={
          <span className="shrink-0 rounded-md bg-background-info px-1 text-[10px] font-semibold text-foreground-info" />
        }
      >
        #{ticket.id}
      </Tooltip.Trigger>
      <Tooltip.Content>{`Ticket #${ticket.id}: ${ticket.title}`}</Tooltip.Content>
    </Tooltip.Root>
  );
});
