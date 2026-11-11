// Fork (ozimakov-st): `#<id>` badge on a PM project task that is some ticket's PM
// session (its id is the ticket's `pm_session`), else a muted "no ticket" marker.
// Uses the Tickets board's list. A small icon after the badge shows the ticket's state
// (the board column), so tickets that need Oleg stand out. `OzdashPmSessionIcon` shows
// the ticket's pixel icon in front of the row (the briefcase when there is no ticket).
import { Tooltip } from '@emdash/ui/react/primitives';
import {
  Archive,
  Briefcase,
  CircleAlert,
  CirclePlay,
  Hourglass,
  Pause,
  type LucideIcon,
} from 'lucide-react';
import { observer } from 'mobx-react-lite';
import {
  pmTaskNeedsTicket,
  ticketForPmSession,
} from '@core/features/ozdash/api/browser/tickets-store';
import { ticketColumn, type TicketColumnId } from '@core/features/ozdash/api/tickets';
import { TicketIcon } from '@core/features/ozdash/contributions/browser';
import { cn } from '@core/primitives/styling/browser/cn';

const STATE_ICON: Record<TicketColumnId, { icon: LucideIcon; label: string; className: string }> = {
  'needs-oleg': { icon: CircleAlert, label: 'Needs you', className: 'text-foreground-warning' },
  active: { icon: CirclePlay, label: 'Active', className: 'text-foreground-success' },
  waiting: { icon: Hourglass, label: 'Waiting', className: 'text-foreground-passive' },
  parked: { icon: Pause, label: 'Parked', className: 'text-foreground-passive' },
  archive: { icon: Archive, label: 'Archived', className: 'text-foreground-passive' },
};

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
  const state = STATE_ICON[ticketColumn(ticket)];
  const StateIcon = state.icon;
  return (
    <Tooltip.Root>
      <Tooltip.Trigger render={<span className="flex shrink-0 items-center gap-1" />}>
        <span className="rounded-md bg-background-info px-1 text-[10px] font-semibold text-foreground-info">
          #{ticket.id}
        </span>
        <StateIcon className={cn('size-3', state.className)} aria-label={state.label} />
      </Tooltip.Trigger>
      <Tooltip.Content>{`Ticket #${ticket.id}: ${ticket.title} · ${state.label}`}</Tooltip.Content>
    </Tooltip.Root>
  );
});

/** The PM session row's icon: its ticket's pixel icon, or the briefcase without a ticket. */
export const OzdashPmSessionIcon = observer(function OzdashPmSessionIcon({
  taskId,
}: {
  taskId: string;
}) {
  const ticket = ticketForPmSession(taskId);
  if (!ticket) return <Briefcase className="h-3.5 w-3.5 shrink-0 text-foreground-info" />;
  return <TicketIcon ticket={ticket} size={16} />;
});
