// Fork (ozimakov-st): task header chip for a task that a ticket's PM session controls.
// Clicking it opens the PM session, when that task still exists.
import { Tooltip } from '@emdash/ui/react/primitives';
import { ClipboardList } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useTaskTicketInfo } from '@core/features/mcp/api/browser/ozdash-task-tickets';
import { ticketChipText, ticketTooltip } from '@core/features/mcp/api/ozdash-task-ticket';
import { taskViewDef } from '@core/features/tasks/contributions/views';
import { useNavigate } from '@core/primitives/navigation/browser/navigation-hooks';

export const OzdashTicketChip = observer(function OzdashTicketChip({ taskId }: { taskId: string }) {
  const info = useTaskTicketInfo(taskId);
  const { navigate } = useNavigate();
  if (!info) return null;
  const { label, title } = ticketChipText(info.ticket);
  const { pmSession } = info;
  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        render={
          <button
            type="button"
            disabled={!pmSession}
            onClick={() => {
              if (pmSession)
                navigate(taskViewDef({ projectId: pmSession.projectId, taskId: pmSession.taskId }));
            }}
            className="hover:bg-muted/30 flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-xs text-foreground-info disabled:cursor-default"
          >
            <ClipboardList className="h-3 w-3 shrink-0" />
            <span className="shrink-0 font-semibold">{label}</span>
            {title && <span className="max-w-[220px] truncate text-foreground-muted">{title}</span>}
          </button>
        }
      />
      <Tooltip.Content>{ticketTooltip(info)}</Tooltip.Content>
    </Tooltip.Root>
  );
});
