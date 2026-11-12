// Fork (ozimakov-st): the Tickets board. Shown in the PM project's main panel.
// Columns: Needs Oleg, Active, Waiting. Parked and Archive are toggle panels on the
// right (compact rows, built for many tickets); their open/closed state survives restarts.
// Cards and rows have a read-only P-chip; cards can be dragged within their priority group.
// A click on a card or parked row opens the ticket popup (priority ▲/▼, Edit, actions).
// A double-click opens the live PM session, or asks to start the ticket.
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
  Dialog,
  DropdownMenu,
  Popover,
  SearchInput,
  Spinner,
} from '@emdash/ui/react/primitives';
import {
  Archive,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Hourglass,
  Pause,
  Pencil,
  Play,
  Plus,
  RotateCcw,
} from 'lucide-react';
import { observer } from 'mobx-react-lite';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { isPmProjectInWindow } from '@core/features/ozdash/api/browser/ozdash-pm';
import { ticketsStore } from '@core/features/ozdash/api/browser/tickets-store';
import { flashRowStyle, priorityCardStyle } from '@core/features/ozdash/api/priority-palette';
import { newTicketSessionModalProps } from '@core/features/ozdash/api/ticket-issues';
import {
  startTicketQuestion,
  ticketDoubleClickAction,
} from '@core/features/ozdash/api/ticket-shortcuts';
import {
  canPark,
  effectivePriority,
  goalPreview,
  groupTickets,
  isFlashPriority,
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
import { useOpenModal } from '@core/manifests/browser/modal-api';
import { BoundShortcut } from '@core/primitives/keybindings/browser/shortcut';
import { useMemento } from '@core/primitives/mementos/react';
import { useNavigate } from '@core/primitives/navigation/browser/navigation-hooks';
import { cn } from '@core/primitives/styling/browser/cn';
import { ExpandableText } from './expandable-text';
import { EditTicketDialog } from './new-ticket-form';
import { navigateToTicketTask } from './open-ticket-task';
import { PriorityChip, PriorityControl, stopEvent } from './priority-control';
import { TicketIcon } from './ticket-icon';

type Notice = { tone: 'error' | 'warning'; text: string };

export const TicketsBoard = observer(function TicketsBoard({ projectId }: { projectId: string }) {
  const { navigate } = useNavigate();
  // In the PM project the task modal shows the "New ticket" form (create-task-modal.tsx).
  const openNewTicket = useOpenModal('taskModal');
  const [query, setQuery] = useState('');
  const [panelState, setPanelState] = useMemento(ozdashTicketsBoardMemento);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  /** A double-clicked ticket without a live PM session: "Start ticket …?" */
  const [confirmStart, setConfirmStart] = useState<TicketSummary | null>(null);

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
      await navigateToTicketTask(navigate, result);
    } finally {
      setBusy(null);
    }
  };

  /** Double-click: open the live PM session, else ask before Start. */
  const onDoubleOpen = (ticket: TicketSummary) => {
    const action = ticketDoubleClickAction(ticket, pmSessionTask(projectId, ticket.pmSession));
    if (action === 'open-session') void openTicket(ticket);
    else if (action === 'confirm-start') setConfirmStart(ticket);
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
                onDoubleOpen={onDoubleOpen}
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
                        onDoubleOpen={onDoubleOpen}
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
      <StartTicketDialog
        ticket={confirmStart}
        onCancel={() => setConfirmStart(null)}
        onStart={(ticket) => {
          setConfirmStart(null);
          void openTicket(ticket);
        }}
      />
    </div>
  );
});

/** The task `pm_session` names in the PM project (and whether it is archived), or null. */
function pmSessionTask(projectId: string, taskId: string | null): { archived: boolean } | null {
  const task = taskId ? getTaskManagerStore(projectId)?.tasks.get(taskId) : undefined;
  if (!task) return null;
  return {
    archived: task.state !== 'unregistered' && 'archivedAt' in task.data && !!task.data.archivedAt,
  };
}

/** Asks before a double-click starts a ticket (Start = the popup's Start / Open session). */
function StartTicketDialog({
  ticket,
  onCancel,
  onStart,
}: {
  ticket: TicketSummary | null;
  onCancel: () => void;
  onStart: (ticket: TicketSummary) => void;
}) {
  return (
    <Dialog.Root open={ticket !== null} onOpenChange={(open) => !open && onCancel()}>
      {ticket && (
        <Dialog.Content size="xs">
          <Dialog.Header showCloseButton={false}>
            <Dialog.Title className="break-words">{startTicketQuestion(ticket)}</Dialog.Title>
          </Dialog.Header>
          <Dialog.Body>
            <p className="text-sm text-foreground-muted">
              This makes it active and opens a PM session.
            </p>
          </Dialog.Body>
          <Dialog.Footer>
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="button" variant="primary" autoFocus onClick={() => onStart(ticket)}>
              <Play className="size-3.5" />
              Start
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      )}
    </Dialog.Root>
  );
}

/** After a click, wait this long for a second click before the popup opens. */
const SINGLE_CLICK_DELAY_MS = 220;

/**
 * A click opens the popup after a short delay; a double-click cancels it and runs
 * `onDouble` instead, so the popup never flashes. A keyboard click (detail 0) opens at
 * once. A double-click on a button inside the card or row (Park, Start, …) or in a
 * portal (menus) is not the card's.
 */
function useClickOrDoubleClick(onSingle: () => void, onDouble: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return {
    onClick: (event: MouseEvent<HTMLElement>) => {
      clearTimeout(timer.current);
      if (event.detail === 0) onSingle();
      else if (event.detail === 1) timer.current = setTimeout(onSingle, SINGLE_CLICK_DELAY_MS);
      // detail >= 2: the dblclick handler runs.
    },
    onDoubleClick: (event: MouseEvent<HTMLElement>) => {
      clearTimeout(timer.current);
      const target = event.target as Element;
      if (!event.currentTarget.contains(target) || target.closest('button')) return;
      onDouble();
    },
  };
}

function ColumnHeader({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center gap-2 px-1 text-xs font-medium text-foreground-muted">
      <span>{label}</span>
      <span className="text-foreground-passive">{count}</span>
    </div>
  );
}

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
  onDoubleOpen,
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
  onDoubleOpen: (ticket: TicketSummary) => void;
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
  const justDragged = () => Date.now() - draggedAt.current < 300;

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
                  justDragged={justDragged}
                  onOpen={onOpen}
                  onDoubleOpen={onDoubleOpen}
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
  /** True right after a drag ends: that click must not open the popup. */
  justDragged: () => boolean;
  /** Opens the PM session (the popup's "Open session"). */
  onOpen: (ticket: TicketSummary) => void;
  /** Double-click: open the live PM session, or ask to start. */
  onDoubleOpen: (ticket: TicketSummary) => void;
  onPark: (ticket: TicketSummary) => void;
  drag: {
    ref: (node: HTMLElement | null) => void;
    listeners: ReturnType<typeof useSortable>['listeners'];
    style: CSSProperties;
    dragging: boolean;
    dimmed: boolean;
  };
};

function TicketCard({
  ticket,
  vaultPath,
  busy,
  justDragged,
  onOpen,
  onDoubleOpen,
  onPark,
  drag,
}: TicketCardProps) {
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const [popup, setPopup] = useState(false);
  const clicks = useClickOrDoubleClick(
    () => setPopup(true),
    () => {
      // A slow double-click may come after the popup opened.
      setPopup(false);
      onDoubleOpen(ticket);
    }
  );
  const waiting = ticket.waitingOn
    .map((row) => (row.owner && row.what ? `${row.owner}: ${row.what}` : row.owner || row.what))
    .join('; ');
  const goal = goalPreview(ticket.goal);
  return (
    <>
      <div
        ref={(node) => {
          drag.ref(node);
          anchorRef.current = node;
        }}
        {...drag.listeners}
        role="button"
        tabIndex={0}
        aria-label={`Ticket ${ticket.id}: ${ticket.title}`}
        aria-haspopup="dialog"
        onClick={(event) => {
          if (!justDragged()) clicks.onClick(event);
        }}
        onDoubleClick={(event) => {
          if (!justDragged()) clicks.onDoubleClick(event);
        }}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setPopup(true);
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
          <TicketIcon ticket={ticket} size={32} />
          <span className="font-semibold text-foreground-info">#{ticket.id}</span>
          <PriorityChip priority={ticket.priority} />
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
          <p
            className="line-clamp-3 text-xs text-foreground-muted"
            title={ticket.goal ?? undefined}
          >
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
      {/* A sibling, not a child: events in the popup must not reach the card (click, drag). */}
      <TicketPopover
        ticket={ticket}
        anchor={anchorRef}
        side="right"
        open={popup}
        onOpenChange={setPopup}
      >
        {canPark(ticket) && (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => {
              setPopup(false);
              onPark(ticket);
            }}
          >
            <Pause className="size-3.5" />
            Park
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          variant="primary"
          autoFocus
          disabled={busy}
          onClick={() => {
            setPopup(false);
            onOpen(ticket);
          }}
        >
          <Play className="size-3.5" />
          Open session
        </Button>
      </TicketPopover>
    </>
  );
}

/**
 * The ticket popup: priority ▲/▼ (the quick control), Edit (title, Goal, priority), the
 * Goal with "Show more", and actions.
 */
function TicketPopover({
  ticket,
  anchor,
  side,
  open,
  onOpenChange,
  children,
}: {
  ticket: TicketSummary;
  anchor: RefObject<HTMLDivElement | null>;
  side: 'left' | 'right';
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The action buttons. */
  children: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <>
      <Popover.Root open={open} onOpenChange={onOpenChange}>
        <Popover.Content
          anchor={anchor}
          side={side}
          align="start"
          className="flex w-72 flex-col gap-2 p-3"
        >
          <div className="flex items-center gap-1.5 text-xs">
            <TicketIcon ticket={ticket} size={32} />
            <span className="font-semibold text-foreground-info">#{ticket.id}</span>
            <PriorityControl ticket={ticket} />
            <Button
              type="button"
              size="xs"
              variant="ghost"
              className="ml-auto"
              title="Edit the title, Goal and priority"
              onClick={() => {
                onOpenChange(false);
                setEditing(true);
              }}
            >
              <Pencil className="size-3.5" />
              Edit
            </Button>
          </div>
          <div className="text-sm font-medium text-foreground">{ticket.title}</div>
          {ticket.goal?.trim() ? (
            <ExpandableText text={ticket.goal.trim()} className="text-xs text-foreground-muted" />
          ) : (
            <p className="text-xs text-foreground-passive">No goal yet.</p>
          )}
          <div className="flex justify-end gap-2">{children}</div>
        </Popover.Content>
      </Popover.Root>
      <EditTicketDialog ticket={ticket} open={editing} onOpenChange={setEditing} />
    </>
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
      <TicketIcon ticket={ticket} size={16} />
      <span className="shrink-0 font-semibold text-foreground-info">#{ticket.id}</span>
      <PriorityChip priority={ticket.priority} />
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
/** A flash ticket's row is tinted gold (see flashRowStyle). */
const rowStyle = (ticket: TicketSummary) =>
  isFlashPriority(ticket.priority) ? flashRowStyle() : undefined;
const ROW_ACTION_CLASS =
  'hidden size-5 shrink-0 items-center justify-center rounded text-foreground-passive group-hover:flex group-focus-within:flex hover:bg-background-3 hover:text-foreground disabled:opacity-50';

/**
 * A parked ticket. ▶ starts it, the box archives it (-> dropped). A click on the row
 * asks first (a popup: priority ▲/▼, the Goal with "Show more", Start / Archive), so a
 * stray click does not start a session.
 */
function ParkedRow({
  ticket,
  busy,
  onStart,
  onDoubleOpen,
  onArchive,
}: {
  ticket: TicketSummary;
  busy: boolean;
  onStart: (ticket: TicketSummary) => void;
  onDoubleOpen: (ticket: TicketSummary) => void;
  onArchive: (ticket: TicketSummary) => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [confirming, setConfirming] = useState(false);
  const clicks = useClickOrDoubleClick(
    () => setConfirming(true),
    () => {
      setConfirming(false);
      onDoubleOpen(ticket);
    }
  );
  return (
    <>
      <div
        ref={rowRef}
        role="button"
        tabIndex={0}
        aria-label={`Parked ticket ${ticket.id}: ${ticket.title}`}
        aria-haspopup="dialog"
        onClick={clicks.onClick}
        onDoubleClick={clicks.onDoubleClick}
        onKeyDown={(event) => {
          // Keys on the Start / Archive buttons are theirs.
          if (event.target !== event.currentTarget) return;
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setConfirming(true);
          }
        }}
        style={rowStyle(ticket)}
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
      <TicketPopover
        ticket={ticket}
        anchor={rowRef}
        side="left"
        open={confirming}
        onOpenChange={setConfirming}
      >
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
      </TicketPopover>
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
      style={rowStyle(ticket)}
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
 * The PM project is not offered: its only task for a ticket is the PM session (Open session in the ticket popup).
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
