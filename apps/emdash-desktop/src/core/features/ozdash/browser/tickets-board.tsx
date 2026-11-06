// Fork (ozimakov-st): the Tickets board. Shown in the PM project's main panel.
// Columns: Needs Oleg, Active, Waiting, Draft, and (on demand) Archive.
import {
  Alert,
  Badge,
  Button,
  DropdownMenu,
  SearchInput,
  Spinner,
  Switch,
} from '@emdash/ui/react/primitives';
import { CircleHelp, Hourglass, Plus, RotateCcw } from 'lucide-react';
import { when } from 'mobx';
import { observer } from 'mobx-react-lite';
import { useEffect, useMemo, useState } from 'react';
import { isPmProjectInWindow } from '@core/features/ozdash/api/browser/ozdash-pm';
import { ticketsStore } from '@core/features/ozdash/api/browser/tickets-store';
import { newTicketSessionModalProps } from '@core/features/ozdash/api/ticket-issues';
import {
  groupTickets,
  TICKET_COLUMNS,
  type TicketColumnId,
  type TicketSummary,
} from '@core/features/ozdash/api/tickets';
import {
  asAvailableProject,
  getProjectManagerStore,
} from '@core/features/projects/api/browser/stores/project-selectors';
import { getTaskManagerStore } from '@core/features/tasks/api/browser/task-state/task-selectors';
import { taskViewDef } from '@core/features/tasks/contributions/views';
import { useOpenModal } from '@core/manifests/browser/modal-api';
import { BoundShortcut } from '@core/primitives/keybindings/browser/shortcut';
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
  const [showArchive, setShowArchive] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    ticketsStore.ensureStarted();
  }, []);

  const list = ticketsStore.list;
  const groups = useMemo(() => groupTickets(list?.tickets ?? [], query), [list, query]);

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

  const restoreTicket = async (ticket: TicketSummary) => {
    if (busy) return;
    setBusy(ticket.folder);
    setNotice(null);
    try {
      const result = await ticketsStore.restore(ticket.folder);
      if (!result.success) {
        setNotice({ tone: 'error', text: `Could not restore #${ticket.id}: ${result.error}` });
      } else if (result.warning) {
        setNotice({ tone: 'warning', text: `#${ticket.id} restored. ${result.warning}` });
      }
      void ticketsStore.reload();
    } finally {
      setBusy(null);
    }
  };

  const boardColumns = TICKET_COLUMNS.filter((column) => column.id !== 'archive');

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-3" data-testid="ozdash-tickets-board">
      <div className="flex items-center gap-3">
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
        <label className="flex items-center gap-2 text-xs text-foreground-muted select-none">
          <Switch size="sm" checked={showArchive} onCheckedChange={setShowArchive} />
          Show archive
        </label>
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
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
          <div className="grid grid-cols-4 gap-3">
            {boardColumns.map((column) => (
              <TicketColumn
                key={column.id}
                id={column.id}
                label={column.label}
                tickets={groups[column.id]}
                vaultPath={list?.vaultPath ?? null}
                busy={busy}
                onOpen={openTicket}
              />
            ))}
          </div>
          {showArchive && (
            <section aria-label="Archive" className="flex flex-col gap-2">
              <ColumnHeader label="Archive" count={groups.archive.length} />
              {groups.archive.length === 0 ? (
                <p className="text-xs text-foreground-passive">No archived tickets.</p>
              ) : (
                <div className="grid grid-cols-2 gap-2 xl:grid-cols-3">
                  {groups.archive.map((ticket) => (
                    <TicketCard
                      key={ticket.folder}
                      ticket={ticket}
                      busy={busy === ticket.folder}
                      onOpen={openTicket}
                      onRestore={restoreTicket}
                    />
                  ))}
                </div>
              )}
            </section>
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

function TicketColumn({
  id,
  label,
  tickets,
  vaultPath,
  busy,
  onOpen,
}: {
  id: TicketColumnId;
  label: string;
  tickets: TicketSummary[];
  vaultPath: string | null;
  busy: string | null;
  onOpen: (ticket: TicketSummary) => void;
}) {
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
        tickets.map((ticket) => (
          <TicketCard
            key={ticket.folder}
            ticket={ticket}
            vaultPath={vaultPath}
            busy={busy === ticket.folder}
            onOpen={onOpen}
          />
        ))
      )}
    </section>
  );
}

function TicketCard({
  ticket,
  vaultPath,
  busy,
  onOpen,
  onRestore,
}: {
  ticket: TicketSummary;
  /** Set on open tickets: shows "New task…". */
  vaultPath?: string | null;
  busy: boolean;
  onOpen: (ticket: TicketSummary) => void;
  onRestore?: (ticket: TicketSummary) => void;
}) {
  const waiting = ticket.waitingOn
    .map((row) => (row.owner && row.what ? `${row.owner}: ${row.what}` : row.owner || row.what))
    .join('; ');
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Open ticket ${ticket.id}: ${ticket.title}`}
      onClick={() => onOpen(ticket)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen(ticket);
        }
      }}
      className={cn(
        'group flex cursor-pointer flex-col gap-1.5 rounded-md border border-border bg-background p-2.5 text-left transition-colors hover:border-foreground-passive/40 focus-visible:outline-2',
        busy && 'opacity-60'
      )}
    >
      <div className="flex items-center gap-1.5 text-xs">
        <span className="font-semibold text-foreground-info">#{ticket.id}</span>
        {ticket.priority !== null && (
          <Badge
            tone={ticket.priority <= 1 ? 'error' : ticket.priority === 2 ? 'warning' : 'neutral'}
          >
            P{ticket.priority}
          </Badge>
        )}
        {ticket.status !== 'active' && ticket.status !== 'waiting' && ticket.status !== 'draft' && (
          <Badge variant="outline">{ticket.status}</Badge>
        )}
        {busy && <Spinner size="sm" className="ml-auto" />}
      </div>
      <div className="line-clamp-2 text-sm font-medium text-foreground">{ticket.title}</div>
      {ticket.nextStep && (
        <div className="line-clamp-2 text-xs text-foreground-muted">
          <span className="text-foreground-passive">Next: </span>
          {ticket.nextStep}
        </div>
      )}
      {waiting && (
        <div className="flex items-start gap-1 text-xs text-foreground-muted">
          <Hourglass className="mt-0.5 size-3 shrink-0 text-foreground-passive" aria-hidden />
          <span className="line-clamp-2">{waiting}</span>
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
        {onRestore && (
          <Button
            type="button"
            size="xs"
            variant="secondary"
            className="ml-auto"
            disabled={busy}
            onClick={(event) => {
              event.stopPropagation();
              onRestore(ticket);
            }}
          >
            <RotateCcw className="size-3" />
            Restore
          </Button>
        )}
      </div>
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
