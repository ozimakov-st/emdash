// Fork (ozimakov-st): marks a sidebar task row that a PM session controls.
import { Tooltip } from '@emdash/ui/react/primitives';
import { ClipboardList } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { usePmTaskInfo } from '@core/features/mcp/api/browser/ozdash-pm-tasks';
import { pmTaskBadgeText, pmTaskTooltip } from '@core/features/mcp/api/ozdash-pm-task';

export const OzdashPmTaskMarker = observer(function OzdashPmTaskMarker({
  taskId,
}: {
  taskId: string;
}) {
  const info = usePmTaskInfo(taskId);
  if (!info) return null;
  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        render={<span className="flex shrink-0 items-center gap-1 text-foreground-info" />}
      >
        <ClipboardList className="h-3.5 w-3.5" />
        <span className="rounded-md bg-background-info px-1 text-[10px] font-semibold">
          {pmTaskBadgeText(info.pmTask)}
        </span>
      </Tooltip.Trigger>
      <Tooltip.Content>{pmTaskTooltip(info)}</Tooltip.Content>
    </Tooltip.Root>
  );
});
