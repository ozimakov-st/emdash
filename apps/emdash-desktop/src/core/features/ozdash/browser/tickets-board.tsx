// Fork (ozimakov-st): the Tickets board. Shown in the PM project's main panel.
// Columns: Needs Oleg, Active, Waiting. Parked and Archive are toggle panels on the
// right (compact rows, built for many tickets); their open/closed state survives restarts.
// Cards and rows have a P-chip with ▲/▼; cards can be dragged within their priority group.
import {
  closestCenter,
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
  type Modifier,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Alert,
  Badge,
  Button,
  DropdownMenu,
  Popover,
  SearchInput,
  Spinner,
} from '@emdash/ui/react/primitives';
import {
  Archive,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CircleHelp,
  Hourglass,
  Pause,
  Play,
  Plus,
  RotateCcw,
} from 'lucide-react';
import { when } from 'mobx';
import { observer } from 'mobx-react-lite';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type SyntheticEvent,
} from 'react';
import { isPmProjectInWindow } from '@core/features/ozdash/api/browser/ozdash-pm';
import { ticketsStore } from '@core/features/ozdash/api/browser/tickets-store';
import {
  priorityCardStyle,
  priorityChipStyle,
  priorityColor,
} from '@core/features/ozdash/api/priority-palette';
import { newTicketSessionModalProps } from '@core/features/ozdash/api/ticket-issues';
import {
  canPark,
  effectivePriority,
  goalFirstLine,
  goalPreview,
  groupTickets,
  MAX_PRIORITY,
  MIN_PRIORITY,
  panelView,
  relativeUpdated,
  reorderGroup,
  TICKET_COLUMNS,
  TICKET_PANELS,
  ticketColumn,
  type TicketColumnId,
  type TicketPanelId,
  type TicketSummary,
} from '@core/features/ozdash/api/tickets';
import {
  isTicketPanelOpen,
  ozdashTicketsBoardMemento,
  toggleTicketPanel,
} from '@core/features/ozdash/contributions/mementos';
import {
  asAvailableProject,
  getProjectManagerStore,
} from '@core/features/projects/api/browser/stores/project-selectors';
import { getTaskManagerStore } from '@core/features/tasks/api/browser/task-state/task-selectors';
import { taskViewDef } from '@core/features/tasks/contributions/views';
import { useOpenModal } from '@core/manifests/browser/modal-api';
import { BoundShortcut } from '@core/primitives/keybindings/browser/shortcut';
import { useMemento } from '@core/primitives/mementos/react';
import { useNavigate } from '@core/primitives/navigation/browser/navigation-hooks';
import { cn } from '@core/primitives/styling/browser/cn';

type Notice = { tone: 'error' | 'warning'; text: string };

/** How long to wait for a new task to reach the renderer's task list. */
const NEW_TASK_TIMEOUT_MS = 20_000;

export const TicketsBoard = observer(function TicketsBoard({ projectId }: { projectId: string }) {
  const { navigate } = useNavigate();
  // In the PM project the task modal shows the "New ticket" form (create-task-modal.tsx).
  const openNewTicket = useOpenModal('taskModal');
  const [query, setQuery] = useState('');
  const [panelState, setPanelState] = useMemento(ozdashTicketsBoardMemento);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    ticketsStore.ensureStarted();
  }, []);

  const list = ticketsStore.list;
  // With priority / order changes that are not written yet.
  const tickets = list ? ticketsStore.tickets : undefined;
  const groups = useMemo(() => groupTickets(tickets ?? [], query), [tickets, query]);
  const totals = useMemo(() => {
    const counts: Record<TicketPanelId, number> = { parked: 0, archive: 0 };
    for (const ticket of tickets ?? []) {
      const column = ticketColumn(ticket);
      if (column === 'parked' || column === 'archive') counts[column] += 1;
    }
    return counts;
  }, [tickets]);
  const searching = query.trim().length > 0;
  const panels = TICKET_PANELS.map((panel) => {
    const open = isTicketPanelOpen(panelState, panel.id);
    const matches = groups[panel.id].length;
    return {
      ...panel,
      open,
      // While searching, the button shows the matches.
      count: searching ? matches : totals[panel.id],
      ...panelView({ open, query, matches }),
    };
  });
  const shownPanels = panels.filter((panel) => panel.show);

  /** Opens the PM session (Start on a parked ticket); creates it when missing. */
  const openTicket = async (ticket: TicketSummary) => {
    if (busy) return;
    setBusy(ticket.folder);
    setNotice(null);
    try {
      const result = await ticketsStore.openSession(ticket.folder, projectId);
      if (!result.success) {
        setNotice({ tone: 'error', text: `Could not open #${ticket.id}: ${result.error}` });
        return;
      }
      if (result.warning) setNotice({ tone: 'warning', text: result.warning });
      // A new task reaches the renderer's task list a moment after it is created.
      await when(() => !!getTaskManagerStore(result.projectId)?.tasks.has(result.taskId), {
        timeout: NEW_TASK_TIMEOUT_MS,
      }).catch(() => undefined);
      navigate(taskViewDef({ projectId: result.projectId, taskId: result.taskId }));
    } finally {
      setBusy(null);
    }
  };

  const changeStatus = async (ticket: TicketSummary, action: 'restore' | 'archive' | 'park') => {
    if (busy) return;
    setBusy(ticket.folder);
    setNotice(null);
    try {
      const result =
        action === 'restore'
          ? await ticketsStore.restore(ticket.folder)
          : action === 'archive'
            ? await ticketsStore.archive(ticket.folder)
            : await ticketsStore.park(ticket.folder);
      const verb = action;
      if (!result.success) {
        setNotice({ tone: 'error', text: `Could not ${verb} #${ticket.id}: ${result.error}` });
      } else if (result.warning) {
        setNotice({ tone: 'warning', text: `#${ticket.id}: ${result.warning}` });
      }
      void ticketsStore.reload();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-3" data-testid="ozdash-tickets-board">
      <div className="flex items-center gap-2">
        <div className="max-w-80 flex-1">
          <SearchInput
            size="sm"
            value={query}
            placeholder="Search tickets…"
            aria-label="Search tickets"
            onChange={(event) => setQuery(event.target.value)}
            onClear={() => setQuery('')}
          />
        </div>
        {panels.map((panel) => (
          <Button
            key={panel.id}
            type="button"
            size="sm"
            variant={panel.open ? 'secondary' : 'ghost'}
            aria-expanded={panel.open}
            aria-label={`${panel.open ? 'Hide' : 'Show'} ${panel.label.toLowerCase()} tickets`}
            onClick={() => setPanelState((state) => toggleTicketPanel(state, panel.id))}
          >
            {panel.label}
            <span className="text-foreground-passive tabular-nums">{panel.count}</span>
            {panel.open ? (
              <ChevronDown className="size-3.5" />
            ) : (
              <ChevronRight className="size-3.5" />
            )}
          </Button>
        ))}
        <span className="ml-auto truncate text-xs text-foreground-passive" title={list?.vaultPath}>
          {list ? `${list.tickets.length} tickets` : ''}
        </span>
        <Button
          type="button"
          size="sm"
          variant="primary"
          onClick={() => void openNewTicket({ projectId })}
        >
          <Plus className="size-3.5" />
          New Ticket
          <BoundShortcut command="app.newTask" variant="keycaps" />
        </Button>
      </div>

      {notice && (
        <Alert.Root
          status={notice.tone === 'error' ? 'destructive' : 'warning'}
          onDismiss={() => setNotice(null)}
        >
          {notice.text}
        </Alert.Root>
      )}
      {ticketsStore.notice && (
        <Alert.Root
          status={ticketsStore.notice.tone === 'error' ? 'destructive' : 'warning'}
          onDismiss={() => ticketsStore.setNotice(null)}
        >
          {ticketsStore.notice.text}
        </Alert.Root>
      )}
      {(ticketsStore.loadError || list?.error) && (
        <Alert.Root status="destructive">{ticketsStore.loadError ?? list?.error}</Alert.Root>
      )}
      {list && list.warnings.length > 0 && (
        <Alert.Root status="warning">
          Skipped {list.warnings.length} ticket file(s): {list.warnings.join('; ')}
        </Alert.Root>
      )}

      {!list && !ticketsStore.loadError ? (
        <div className="flex flex-1 items-center justify-center">
          <Spinner />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 gap-3">
          <div className="grid min-h-0 min-w-0 flex-1 grid-cols-3 items-start gap-3 overflow-y-auto">
            {TICKET_COLUMNS.map((column) => (
              <TicketColumn
                key={column.id}
                id={column.id}
                label={column.label}
                tickets={groups[column.id]}
                vaultPath={list?.vaultPath ?? null}
                busy={busy}
                // A filtered list is not a whole priority group: no reordering while searching.
                sortable={!searching}
                onOpen={openTicket}
                onPark={(target) => void changeStatus(target, 'park')}
              />
            ))}
          </div>
          {shownPanels.length > 0 && (
            <div className="flex min-h-0 w-72 shrink-0 flex-col gap-3">
              {shownPanels.map((panel) => (
                <TicketPanel
                  key={panel.id}
                  label={panel.label}
                  count={groups[panel.id].length}
                  autoExpanded={panel.autoExpanded}
                  empty={
                    searching
                      ? 'No matches.'
                      : panel.id === 'parked'
                        ? 'No parked tickets.'
                        : 'No archived tickets.'
                  }
                >
                  {groups[panel.id].map((ticket) =>
                    panel.id === 'parked' ? (
                      <ParkedRow
                        key={ticket.folder}
                        ticket={ticket}
                        busy={busy === ticket.folder}
                        onStart={openTicket}
                        onArchive={(target) => void changeStatus(target, 'archive')}
                      />
                    ) : (
                      <ArchivedRow
                        key={ticket.folder}
                        ticket={ticket}
                        busy={busy === ticket.folder}
                        onRestore={(target) => void changeStatus(target, 'restore')}
                      />
                    )
                  )}
                </TicketPanel>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
});

function ColumnHeader({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center gap-2 px-1 text-xs font-medium text-foreground-muted">
      <span>{label}</span>
      <span className="text-foreground-passive">{count}</span>
    </div>
  );
}

/** Keeps clicks, keys and drags on a control from reaching the card or row. */
const stopEvent = (event: SyntheticEvent) => event.stopPropagation();

/** A static P-chip in the priority color (missing = P3). */
function PriorityChip({ priority }: { priority: number | null }) {
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
 * The P-chip with ▲ (higher priority = smaller number) and ▼. The board shows each
 * click at once; the file is written when the clicks stop (see TicketsStore.bumpPriority).
 */
const PriorityControl = observer(function PriorityControl({ ticket }: { ticket: TicketSummary }) {
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

/** The same priority, one after another (a sorted column), as drag groups. */
function priorityGroups(tickets: readonly TicketSummary[]): TicketSummary[][] {
  const groups: TicketSummary[][] = [];
  for (const ticket of tickets) {
    const last = groups[groups.length - 1];
    if (last && effectivePriority(last[0]!.priority) === effectivePriority(ticket.priority))
      last.push(ticket);
    else groups.push([ticket]);
  }
  return groups;
}

/** Cards move up and down only. */
const verticalOnly: Modifier = ({ transform }) => ({ ...transform, x: 0 });

/**
 * Only cards of the dragged card's priority group are drop targets, so a card snaps
 * inside its group and never lands in another one.
 */
const sameGroupCollision: CollisionDetection = (args) => {
  const group = args.active.data.current?.group as string | undefined;
  return closestCenter({
    ...args,
    droppableContainers: args.droppableContainers.filter(
      (container) => container.data.current?.group === group
    ),
  });
};

function TicketColumn({
  id,
  label,
  tickets,
  vaultPath,
  busy,
  sortable,
  onOpen,
  onPark,
}: {
  id: TicketColumnId;
  label: string;
  tickets: TicketSummary[];
  vaultPath: string | null;
  busy: string | null;
  /** Drag & drop within a priority group. */
  sortable: boolean;
  onOpen: (ticket: TicketSummary) => void;
  onPark: (ticket: TicketSummary) => void;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const [dragGroup, setDragGroup] = useState<string | null>(null);
  // The click that ends a drag must not open the ticket.
  const draggedAt = useRef(0);
  const groups = priorityGroups(tickets);
  const groupId = (group: TicketSummary[]) => `${id}:P${effectivePriority(group[0]!.priority)}`;

  const onDragStart = (event: DragStartEvent) =>
    setDragGroup((event.active.data.current?.group as string | undefined) ?? null);
  const onDragEnd = (event: DragEndEvent) => {
    setDragGroup(null);
    draggedAt.current = Date.now();
    const group = groups.find((entry) => groupId(entry) === event.active.data.current?.group);
    if (!group || !event.over) return;
    const next = reorderGroup(
      group.map((ticket) => ticket.folder),
      String(event.active.id),
      String(event.over.id)
    );
    if (next) void ticketsStore.reorder(next);
  };
  const open = (ticket: TicketSummary) => {
    if (Date.now() - draggedAt.current < 300) return;
    onOpen(ticket);
  };

  return (
    <section
      aria-label={label}
      className={cn(
        'flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-background-1 p-2',
        id === 'needs-oleg' && tickets.length > 0 && 'border-border-warning'
      )}
    >
      <ColumnHeader label={label} count={tickets.length} />
      {tickets.length === 0 ? (
        <p className="px-1 py-2 text-xs text-foreground-passive">Nothing here.</p>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={sameGroupCollision}
          modifiers={[verticalOnly]}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragCancel={() => setDragGroup(null)}
        >
          {groups.map((group) => (
            <SortableContext
              key={groupId(group)}
              id={groupId(group)}
              items={group.map((ticket) => ticket.folder)}
              strategy={verticalListSortingStrategy}
            >
              {group.map((ticket) => (
                <SortableTicketCard
                  key={ticket.folder}
                  ticket={ticket}
                  group={groupId(group)}
                  // Other groups fade while a card is dragged: they are not drop targets.
                  dimmed={dragGroup !== null && dragGroup !== groupId(group)}
                  sortable={sortable && group.length > 1}
                  vaultPath={vaultPath}
                  busy={busy === ticket.folder}
                  onOpen={open}
                  onPark={onPark}
                />
              ))}
            </SortableContext>
          ))}
        </DndContext>
      )}
    </section>
  );
}

function SortableTicketCard({
  group,
  dimmed,
  sortable,
  ...card
}: Omit<TicketCardProps, 'drag'> & { group: string; dimmed: boolean; sortable: boolean }) {
  const { setNodeRef, transform, transition, isDragging, listeners } = useSortable({
    id: card.ticket.folder,
    data: { group },
    disabled: !sortable,
  });
  return (
    <TicketCard
      {...card}
      drag={{
        ref: setNodeRef,
        listeners: sortable ? listeners : undefined,
        style: { transform: CSS.Translate.toString(transform), transition },
        dragging: isDragging,
        dimmed,
      }}
    />
  );
}

type TicketCardProps = {
  ticket: TicketSummary;
  /** Shows "New task…" when set. */
  vaultPath: string | null;
  busy: boolean;
  onOpen: (ticket: TicketSummary) => void;
  onPark: (ticket: TicketSummary) => void;
  drag: {
    ref: (node: HTMLElement | null) => void;
    listeners: ReturnType<typeof useSortable>['listeners'];
    style: CSSProperties;
    dragging: boolean;
    dimmed: boolean;
  };
};

function TicketCard({ ticket, vaultPath, busy, onOpen, onPark, drag }: TicketCardProps) {
  const waiting = ticket.waitingOn
    .map((row) => (row.owner && row.what ? `${row.owner}: ${row.what}` : row.owner || row.what))
    .join('; ');
  const goal = goalPreview(ticket.goal);
  return (
    <div
      ref={drag.ref}
      {...drag.listeners}
      role="button"
      tabIndex={0}
      aria-label={`Open ticket ${ticket.id}: ${ticket.title}`}
      onClick={() => onOpen(ticket)}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen(ticket);
        }
      }}
      style={{ ...priorityCardStyle(ticket.priority), ...drag.style }}
      className={cn(
        'group flex cursor-pointer flex-col gap-1.5 rounded-md border border-l-[3px] p-2.5 text-left transition-[border-color,opacity] hover:brightness-110 focus-visible:outline-2',
        busy && 'opacity-60',
        drag.dimmed && 'opacity-40',
        drag.dragging && 'relative z-10 cursor-grabbing shadow-lg'
      )}
    >
      <div className="flex items-center gap-1.5 text-xs">
        <span className="font-semibold text-foreground-info">#{ticket.id}</span>
        <PriorityControl ticket={ticket} />
        {ticket.status === 'blocked' && <Badge variant="outline">blocked</Badge>}
        <span className="ml-auto flex items-center gap-1">
          {busy && <Spinner size="sm" />}
          {canPark(ticket) && (
            <button
              type="button"
              className="flex size-5 items-center justify-center rounded text-foreground-passive opacity-0 group-hover:opacity-100 hover:bg-background-3 hover:text-foreground focus-visible:opacity-100 disabled:opacity-50"
              aria-label={`Park ticket ${ticket.id}`}
              title="Park"
              disabled={busy}
              onPointerDown={stopEvent}
              onKeyDown={stopEvent}
              onClick={(event) => {
                event.stopPropagation();
                onPark(ticket);
              }}
            >
              <Pause className="size-3" />
            </button>
          )}
        </span>
      </div>
      <div className="line-clamp-2 text-sm font-medium text-foreground">{ticket.title}</div>
      {goal && (
        <p className="line-clamp-3 text-xs text-foreground-muted" title={ticket.goal ?? undefined}>
          {goal}
        </p>
      )}
      {ticket.nextStep && (
        <div className="line-clamp-1 text-xs text-foreground-muted">
          <span className="text-foreground-passive">Next: </span>
          {ticket.nextStep}
        </div>
      )}
      {waiting && (
        <div className="flex items-start gap-1 text-xs text-foreground-muted">
          <Hourglass className="mt-0.5 size-3 shrink-0 text-foreground-passive" aria-hidden />
          <span className="line-clamp-1">{waiting}</span>
        </div>
      )}
      {ticket.openQuestions.count > 0 && (
        <div
          className="flex items-start gap-1 text-xs text-foreground-warning"
          title={ticket.openQuestions.first ?? undefined}
        >
          <CircleHelp className="mt-0.5 size-3 shrink-0" aria-hidden />
          <span>
            {ticket.openQuestions.count === 1
              ? '1 open question'
              : `${ticket.openQuestions.count} open questions`}
          </span>
        </div>
      )}
      <div className="flex items-center gap-2 text-[11px] text-foreground-passive">
        {ticket.updated && <span>Updated {ticket.updated}</span>}
        {vaultPath && <NewTaskMenu ticket={ticket} vaultPath={vaultPath} />}
      </div>
    </div>
  );
}

/** A right-side panel (Parked or Archive): a header and a scrolling list of compact rows. */
function TicketPanel({
  label,
  count,
  autoExpanded,
  empty,
  children,
}: {
  label: string;
  count: number;
  /** The panel is closed but shown because the search matches tickets in it. */
  autoExpanded: boolean;
  empty: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={label}
      className="flex min-h-0 flex-1 flex-col rounded-lg border border-border bg-background-1"
    >
      <div className="flex items-center gap-2 px-3 pt-2 pb-1 text-xs font-medium text-foreground-muted">
        <span>{label}</span>
        <span className="text-foreground-passive tabular-nums">{count}</span>
        {autoExpanded && (
          <span className="ml-auto font-normal text-foreground-passive">search matches</span>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-1">
        {count === 0 ? (
          <p className="px-2 py-2 text-xs text-foreground-passive">{empty}</p>
        ) : (
          children
        )}
      </div>
    </section>
  );
}

/** `#id`, priority, title (one line) and how long ago it was updated. */
function RowSummary({ ticket, busy }: { ticket: TicketSummary; busy: boolean }) {
  const updated = relativeUpdated(ticket.updated, new Date());
  return (
    <>
      <span className="shrink-0 font-semibold text-foreground-info">#{ticket.id}</span>
      <PriorityControl ticket={ticket} />
      <span className="min-w-0 flex-1 truncate text-foreground" title={ticket.title}>
        {ticket.title}
      </span>
      {busy ? (
        <Spinner size="sm" className="shrink-0" />
      ) : (
        updated && (
          <span
            className="shrink-0 text-[11px] text-foreground-passive tabular-nums group-focus-within:hidden group-hover:hidden"
            title={ticket.updated ? `Updated ${ticket.updated}` : undefined}
          >
            {updated}
          </span>
        )
      )}
    </>
  );
}

const ROW_CLASS =
  'group flex h-7 items-center gap-1.5 rounded-md px-2 text-xs transition-colors hover:bg-background-2';
const ROW_ACTION_CLASS =
  'hidden size-5 shrink-0 items-center justify-center rounded text-foreground-passive group-hover:flex group-focus-within:flex hover:bg-background-3 hover:text-foreground disabled:opacity-50';

/**
 * A parked ticket. ▶ starts it, the box archives it (-> dropped). A click on the row
 * asks first (Goal + Start / Archive), so a stray click does not start a session.
 */
function ParkedRow({
  ticket,
  busy,
  onStart,
  onArchive,
}: {
  ticket: TicketSummary;
  busy: boolean;
  onStart: (ticket: TicketSummary) => void;
  onArchive: (ticket: TicketSummary) => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [confirming, setConfirming] = useState(false);
  const goal = goalFirstLine(ticket.goal);
  return (
    <>
      <div
        ref={rowRef}
        role="button"
        tabIndex={0}
        aria-label={`Parked ticket ${ticket.id}: ${ticket.title}`}
        aria-haspopup="dialog"
        onClick={() => setConfirming(true)}
        onKeyDown={(event) => {
          // Keys on the Start / Archive buttons are theirs.
          if (event.target !== event.currentTarget) return;
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setConfirming(true);
          }
        }}
        className={cn(ROW_CLASS, 'cursor-pointer', busy && 'opacity-60')}
      >
        <RowSummary ticket={ticket} busy={busy} />
        <button
          type="button"
          className={ROW_ACTION_CLASS}
          aria-label={`Start ticket ${ticket.id}`}
          title="Start"
          disabled={busy}
          onClick={(event) => {
            event.stopPropagation();
            onStart(ticket);
          }}
        >
          <Play className="size-3" />
        </button>
        <button
          type="button"
          className={ROW_ACTION_CLASS}
          aria-label={`Archive ticket ${ticket.id}`}
          title="Archive (dropped)"
          disabled={busy}
          onClick={(event) => {
            event.stopPropagation();
            onArchive(ticket);
          }}
        >
          <Archive className="size-3" />
        </button>
      </div>
      <Popover.Root open={confirming} onOpenChange={setConfirming}>
        <Popover.Content
          anchor={rowRef}
          side="left"
          align="start"
          className="flex w-72 flex-col gap-2 p-3"
        >
          <div className="flex items-center gap-1.5 text-xs">
            <span className="font-semibold text-foreground-info">#{ticket.id}</span>
            <PriorityChip priority={ticket.priority} />
          </div>
          <div className="text-sm font-medium text-foreground">{ticket.title}</div>
          <p className="line-clamp-3 text-xs text-foreground-muted">{goal ?? 'No goal yet.'}</p>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setConfirming(false);
                onArchive(ticket);
              }}
            >
              <Archive className="size-3.5" />
              Archive
            </Button>
            <Button
              type="button"
              size="sm"
              variant="primary"
              autoFocus
              disabled={busy}
              onClick={() => {
                setConfirming(false);
                onStart(ticket);
              }}
            >
              <Play className="size-3.5" />
              Start
            </Button>
          </div>
        </Popover.Content>
      </Popover.Root>
    </>
  );
}

/** An archived (done or dropped) ticket. Restore sets it back to parked. */
function ArchivedRow({
  ticket,
  busy,
  onRestore,
}: {
  ticket: TicketSummary;
  busy: boolean;
  onRestore: (ticket: TicketSummary) => void;
}) {
  return (
    <div
      className={cn(ROW_CLASS, busy && 'opacity-60')}
      title={`${ticket.status}: ${ticket.title}`}
    >
      <RowSummary ticket={ticket} busy={busy} />
      <button
        type="button"
        className={ROW_ACTION_CLASS}
        aria-label={`Restore ticket ${ticket.id} to parked`}
        title="Restore (to parked)"
        disabled={busy}
        onClick={() => onRestore(ticket)}
      >
        <RotateCcw className="size-3" />
      </button>
    </div>
  );
}

/**
 * "New task…": pick a project, then the New Task dialog opens with this ticket as
 * its OZ Tickets issue. Creating the task records it in the ticket (see ticket-issues.ts).
 * The PM project is not offered: its only task for a ticket is the PM session (card click).
 */
const NewTaskMenu = observer(function NewTaskMenu({
  ticket,
  vaultPath,
}: {
  ticket: TicketSummary;
  vaultPath: string;
}) {
  const openCreateTaskModal = useOpenModal('taskModal');
  const projects = [...getProjectManagerStore().projects.entries()]
    .filter(([, store]) => asAvailableProject(store) && store.data && !isPmProjectInWindow(store))
    .map(([id, store]) => ({ id, name: store.data!.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  // The menu is a portal; React still bubbles its events to the card. Stop them here.
  return (
    <span
      className="ml-auto"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          aria-label={`New task for ticket ${ticket.id}`}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-foreground-passive opacity-0 group-hover:opacity-100 hover:bg-background-2 hover:text-foreground focus-visible:opacity-100 data-popup-open:opacity-100"
        >
          <Plus className="size-3" />
          New task…
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="end">
          <DropdownMenu.Group>
            <DropdownMenu.Label>Start a task in project</DropdownMenu.Label>
            {projects.length === 0 ? (
              <DropdownMenu.Item disabled>No projects available</DropdownMenu.Item>
            ) : (
              projects.map((project) => (
                <DropdownMenu.Item
                  key={project.id}
                  onClick={() =>
                    void openCreateTaskModal(
                      newTicketSessionModalProps(ticket, vaultPath, project.id)
                    )
                  }
                >
                  {project.name}
                </DropdownMenu.Item>
              ))
            )}
          </DropdownMenu.Group>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </span>
  );
});
