// Fork (ozimakov-st): the ticket P-chip. The board shows it read-only; the parked
// ticket popup and the task's Ticket panel show it with ▲/▼ to change the priority.
import { ChevronDown, ChevronUp } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import type { SyntheticEvent } from 'react';
import { ticketsStore } from '@core/features/ozdash/api/browser/tickets-store';
import { priorityChipStyle, priorityColor } from '@core/features/ozdash/api/priority-palette';
import {
  effectivePriority,
  MAX_PRIORITY,
  MIN_PRIORITY,
  type TicketSummary,
} from '@core/features/ozdash/api/tickets';

/** Keeps clicks, keys and drags on a control from reaching the card or row. */
export const stopEvent = (event: SyntheticEvent) => event.stopPropagation();

/** A static P-chip in the priority color (missing = P3). */
export function PriorityChip({ priority }: { priority: number | null }) {
  return (
    <span
      className="inline-flex h-4 shrink-0 items-center rounded border px-1 text-[11px] leading-none font-semibold text-foreground tabular-nums"
      style={priorityChipStyle(priority)}
      title={`Priority ${effectivePriority(priority)} (${priorityColor(priority).name})`}
    >
      P{effectivePriority(priority)}
    </span>
  );
}

const PRIORITY_STEP_CLASS =
  'flex h-2 w-3.5 items-center justify-center text-foreground-muted hover:bg-background-3 hover:text-foreground disabled:pointer-events-none disabled:opacity-30';

/**
 * The P-chip with ▲ (higher priority = smaller number) and ▼. Each click shows at
 * once; the file is written when the clicks stop (see TicketsStore.bumpPriority).
 */
export const PriorityControl = observer(function PriorityControl({
  ticket,
}: {
  ticket: TicketSummary;
}) {
  const priority = effectivePriority(ticket.priority);
  return (
    <span
      className="inline-flex h-4 shrink-0 items-stretch overflow-hidden rounded border text-[11px] leading-none font-semibold text-foreground"
      style={priorityChipStyle(ticket.priority)}
      onClick={stopEvent}
      onKeyDown={stopEvent}
      onPointerDown={stopEvent}
    >
      <span
        className="flex items-center px-1 tabular-nums"
        title={`Priority ${priority} (${priorityColor(ticket.priority).name})`}
      >
        P{priority}
      </span>
      <span className="flex flex-col border-l border-inherit">
        <button
          type="button"
          className={PRIORITY_STEP_CLASS}
          aria-label={`Raise priority of ticket ${ticket.id}`}
          title="Higher priority"
          disabled={priority <= MIN_PRIORITY}
          onClick={() => ticketsStore.bumpPriority(ticket.folder, 'up')}
        >
          <ChevronUp className="size-2.5" strokeWidth={3} />
        </button>
        <button
          type="button"
          className={PRIORITY_STEP_CLASS}
          aria-label={`Lower priority of ticket ${ticket.id}`}
          title="Lower priority"
          disabled={priority >= MAX_PRIORITY}
          onClick={() => ticketsStore.bumpPriority(ticket.folder, 'down')}
        >
          <ChevronDown className="size-2.5" strokeWidth={3} />
        </button>
      </span>
    </span>
  );
});
