// Fork (ozimakov-st): the ticket P-chip. The board shows it read-only; the parked
// ticket popup and the task's Ticket panel show it with ▲/▼ to change the priority.
// A flash ticket (P0) shows a gold lightning + `P0`; ▲ stops at P1 (P0 is set only with
// the Flash toggle in New / Edit ticket), ▼ from P0 goes to P1.
import { ChevronDown, ChevronUp, Zap } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import type { SyntheticEvent } from 'react';
import { ticketsStore } from '@core/features/ozdash/api/browser/tickets-store';
import { priorityChipStyle, priorityColor } from '@core/features/ozdash/api/priority-palette';
import {
  bumpPriority,
  effectivePriority,
  isFlashPriority,
  type TicketSummary,
} from '@core/features/ozdash/api/tickets';

/** Keeps clicks, keys and drags on a control from reaching the card or row. */
export const stopEvent = (event: SyntheticEvent) => event.stopPropagation();

/** The chip's tooltip: `Priority 2 (Orchid)`, or the flash text for P0. */
function priorityTitle(priority: number | null): string {
  return isFlashPriority(priority)
    ? 'Flash ticket (P0): urgent, short work'
    : `Priority ${effectivePriority(priority)} (${priorityColor(priority).name})`;
}

/** The chip's label: `P2`, or a gold lightning and `P0` for a flash ticket. */
function PriorityLabel({ priority }: { priority: number | null }) {
  if (!isFlashPriority(priority)) return <>P{effectivePriority(priority)}</>;
  return (
    <>
      <Zap
        aria-hidden
        className="size-2.5"
        strokeWidth={2.5}
        style={{ color: priorityColor(priority).accent, fill: priorityColor(priority).accent }}
      />
      P0
    </>
  );
}

/** A static P-chip in the priority color (missing = P3). */
export function PriorityChip({ priority }: { priority: number | null }) {
  return (
    <span
      className="inline-flex h-4 shrink-0 items-center gap-0.5 rounded border px-1 text-[11px] leading-none font-semibold text-foreground tabular-nums"
      style={priorityChipStyle(priority)}
      title={priorityTitle(priority)}
    >
      <PriorityLabel priority={priority} />
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
  const flash = isFlashPriority(ticket.priority);
  return (
    <span
      className="inline-flex h-4 shrink-0 items-stretch overflow-hidden rounded border text-[11px] leading-none font-semibold text-foreground"
      style={priorityChipStyle(ticket.priority)}
      onClick={stopEvent}
      onKeyDown={stopEvent}
      onPointerDown={stopEvent}
    >
      <span
        className="flex items-center gap-0.5 px-1 tabular-nums"
        title={priorityTitle(ticket.priority)}
      >
        <PriorityLabel priority={ticket.priority} />
      </span>
      <span className="flex flex-col border-l border-inherit">
        <button
          type="button"
          className={PRIORITY_STEP_CLASS}
          aria-label={`Raise priority of ticket ${ticket.id}`}
          title={flash ? 'Flash is the top (P0 is set with Flash in Edit)' : 'Higher priority'}
          disabled={bumpPriority(ticket.priority, 'up') === null}
          onClick={() => ticketsStore.bumpPriority(ticket.folder, 'up')}
        >
          <ChevronUp className="size-2.5" strokeWidth={3} />
        </button>
        <button
          type="button"
          className={PRIORITY_STEP_CLASS}
          aria-label={`Lower priority of ticket ${ticket.id}`}
          title={flash ? 'Not flash any more: P1' : 'Lower priority'}
          disabled={bumpPriority(ticket.priority, 'down') === null}
          onClick={() => ticketsStore.bumpPriority(ticket.folder, 'down')}
        >
          <ChevronDown className="size-2.5" strokeWidth={3} />
        </button>
      </span>
    </span>
  );
});
