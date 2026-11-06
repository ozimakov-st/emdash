// Fork (ozimakov-st): task header chip for a task that a PM session controls.
// Clicking it opens the manager task, when that task still exists.
import { Tooltip } from '@emdash/ui/react/primitives';
import { ClipboardList } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { usePmTaskInfo } from '@core/features/mcp/api/browser/ozdash-pm-tasks';
import { pmTaskChipText, pmTaskTooltip } from '@core/features/mcp/api/ozdash-pm-task';
import { taskViewDef } from '@core/features/tasks/contributions/views';
import { useNavigate } from '@core/primitives/navigation/browser/navigation-hooks';

export const OzdashPmTaskChip = observer(function OzdashPmTaskChip({ taskId }: { taskId: string }) {
  const info = usePmTaskInfo(taskId);
  const { navigate } = useNavigate();
  if (!info) return null;
  const { label, title } = pmTaskChipText(info.pmTask);
  const { manager } = info;
  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        render={
          <button
            type="button"
            disabled={!manager}
            onClick={() => {
              if (manager)
                navigate(taskViewDef({ projectId: manager.projectId, taskId: manager.taskId }));
            }}
            className="hover:bg-muted/30 flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-xs text-foreground-info disabled:cursor-default"
          >
            <ClipboardList className="h-3 w-3 shrink-0" />
            <span className="shrink-0 font-semibold">{label}</span>
            {title && <span className="max-w-[220px] truncate text-foreground-muted">{title}</span>}
          </button>
        }
      />
      <Tooltip.Content>{pmTaskTooltip(info)}</Tooltip.Content>
    </Tooltip.Root>
  );
});
