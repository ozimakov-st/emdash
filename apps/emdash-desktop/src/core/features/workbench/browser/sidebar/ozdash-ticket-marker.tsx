// Fork (ozimakov-st): marks a sidebar task row that a ticket's PM session controls.
import { Tooltip } from '@emdash/ui/react/primitives';
import { ClipboardList } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useTaskTicketInfo } from '@core/features/mcp/api/browser/ozdash-task-tickets';
import { ticketBadgeText, ticketTooltip } from '@core/features/mcp/api/ozdash-task-ticket';

export const OzdashTicketMarker = observer(function OzdashTicketMarker({
  taskId,
}: {
  taskId: string;
}) {
  const info = useTaskTicketInfo(taskId);
  if (!info) return null;
  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        render={<span className="flex shrink-0 items-center gap-1 text-foreground-info" />}
      >
        <ClipboardList className="h-3.5 w-3.5" />
        <span className="rounded-md bg-background-info px-1 text-[10px] font-semibold whitespace-nowrap">
          {ticketBadgeText(info.ticket)}
        </span>
      </Tooltip.Trigger>
      <Tooltip.Content>{ticketTooltip(info)}</Tooltip.Content>
    </Tooltip.Root>
  );
});
