// OZdash: sidebar marks for tasks that need Oleg (rule: ozdash/api/attention.ts).
// 'input' (waits for input, or failed) is strong; 'done' (finished, unseen) is soft.
import { Tooltip } from '@emdash/ui/react/primitives';
import { BellRing } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import type { AttentionLevel } from '@core/features/ozdash/api/attention';
import { projectAttentionCount } from '@core/features/ozdash/api/browser/attention';
import { getSidebarStore } from '@core/features/workbench/contributions/browser/app-stores';
import { cn } from '@core/primitives/styling/browser/cn';

const LABEL: Record<AttentionLevel, string> = {
  input: 'Needs your input',
  done: 'Finished, not seen yet',
};

/**
 * Row background for a task that needs attention. The warning background (amber-3) is
 * pale, so a low opacity of it does not show: 'input' uses it in full with an amber
 * outline, 'done' uses it at 70%.
 */
export function ozdashAttentionRowClass(level: AttentionLevel | null): string | false {
  if (level === 'input') return 'bg-background-warning ring-1 ring-inset ring-border-warning';
  if (level === 'done') return 'bg-background-warning/70';
  return false;
}

export function OzdashAttentionIcon({ level }: { level: AttentionLevel | null }) {
  if (!level) return null;
  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        render={
          <span
            aria-label={LABEL[level]}
            className="flex shrink-0 items-center text-foreground-warning"
          >
            <BellRing className={cn('h-3.5 w-3.5', level === 'done' && 'opacity-60')} />
          </span>
        }
      />
      <Tooltip.Content>{LABEL[level]}</Tooltip.Content>
    </Tooltip.Root>
  );
}

/** How many tasks need attention, shown on a collapsed project row. */
export const OzdashProjectAttentionCount = observer(function OzdashProjectAttentionCount({
  projectId,
}: {
  projectId: string;
}) {
  if (getSidebarStore().expandedProjectIds.has(projectId)) return null;
  const count = projectAttentionCount(projectId);
  if (count === 0) return null;
  const label = `${count} ${count === 1 ? 'task needs' : 'tasks need'} attention`;
  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        render={
          <span
            aria-label={label}
            className="flex h-5 shrink-0 items-center gap-0.5 rounded-md bg-background-warning px-1.5 text-[11px] font-medium text-foreground-warning tabular-nums"
          >
            <BellRing className="h-3 w-3" />
            {count}
          </span>
        }
      />
      <Tooltip.Content>{label}</Tooltip.Content>
    </Tooltip.Root>
  );
});
