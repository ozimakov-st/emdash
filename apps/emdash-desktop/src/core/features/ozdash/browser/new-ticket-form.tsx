// Fork (ozimakov-st): the "New ticket" dialog content. In the PM project it replaces
// the New Task dialog (see create-task-modal.tsx); the "No ticket" chip uses it for
// "Create ticket from this task". Creating writes `vault/tickets/<id>-<slug>/ticket.md`
// and syncs the vault once. A new ticket is parked (no PM session; Start it on the
// board). With `existingTask`, that task is its PM session and the ticket is active.
// With `ticket`, it is the "Edit ticket" form: the same fields, prefilled from the file,
// rewritten in place (see editTicketContent).
// The ⚡ Flash toggle saves the ticket as P0 (urgent, short work). A new flash ticket is
// started at once (active + PM session, like Start on the board) and opened. In Edit,
// Flash only changes the priority.
import {
  Alert,
  Button,
  Dialog,
  Field,
  Input,
  Textarea,
  toast,
  ToggleGroup,
} from '@emdash/ui/react/primitives';
import { Zap } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { ticketsStore } from '@core/features/ozdash/api/browser/tickets-store';
import {
  flashGlow,
  priorityChipStyle,
  priorityColor,
  PRIORITY_PALETTE,
} from '@core/features/ozdash/api/priority-palette';
import {
  DEFAULT_PRIORITY,
  effectivePriority,
  FLASH_PRIORITY,
  isFlashPriority,
  MIN_PRIORITY,
  type TicketSummary,
} from '@core/features/ozdash/api/tickets';
import { ConfirmButton } from '@core/primitives/keybindings/browser/confirm-button';
import { useNavigate } from '@core/primitives/navigation/browser/navigation-hooks';
import { cn } from '@core/primitives/styling/browser/cn';
import { navigateToTicketTask } from './open-ticket-task';

const PRIORITIES = [1, 2, 3, 4] as const;

/** P1-P4 segmented control in the priority colors. */
function PriorityPicker({
  value,
  disabled,
  onChange,
}: {
  value: number;
  disabled: boolean;
  onChange: (priority: number) => void;
}) {
  return (
    <ToggleGroup.Root
      aria-label="Priority"
      className={cn(disabled && 'opacity-40')}
      value={[String(value)]}
      onValueChange={([next]) => {
        if (next) onChange(Number(next));
      }}
    >
      {PRIORITIES.map((priority) => (
        <ToggleGroup.Item
          key={priority}
          value={String(priority)}
          disabled={disabled}
          className="gap-1.5 border border-transparent tabular-nums"
          style={priority === value ? priorityChipStyle(priority) : undefined}
          title={`Priority ${priority} (${priorityColor(priority).name})`}
        >
          <span
            aria-hidden
            className="size-2 rounded-full"
            style={{ backgroundColor: priorityColor(priority).accent }}
          />
          P{priority}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}

const FLASH = PRIORITY_PALETTE[FLASH_PRIORITY].accent;

/**
 * The ⚡ Flash switch: a pill that lights up gold with a soft glow when on. The lightning
 * pulses only when the system allows motion (`motion-safe`).
 */
function FlashToggle({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label="Flash ticket"
      title="Flash: urgent, short work (a quick investigation or a quick build). Saved as P0."
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold motion-safe:transition-[background-color,border-color,box-shadow,color] motion-safe:duration-200 focus-visible:outline-2 disabled:opacity-50',
        checked
          ? 'text-foreground'
          : 'border-border text-foreground-muted hover:bg-background-2 hover:text-foreground'
      )}
      style={
        checked
          ? {
              backgroundColor: `color-mix(in srgb, ${FLASH} 24%, var(--color-background))`,
              borderColor: FLASH,
              boxShadow: flashGlow(),
            }
          : undefined
      }
    >
      <Zap
        aria-hidden
        className={cn('size-3.5', checked && 'motion-safe:animate-pulse')}
        strokeWidth={2.5}
        style={checked ? { color: FLASH, fill: FLASH } : undefined}
      />
      Flash
      {/* A small switch track; the knob moves right when on. */}
      <span
        aria-hidden
        className="relative ml-0.5 h-3 w-5 rounded-full border border-current/40"
        style={checked ? { backgroundColor: FLASH, borderColor: FLASH } : undefined}
      >
        <span
          className={cn(
            'absolute top-1/2 left-0.5 size-2 -translate-y-1/2 rounded-full motion-safe:transition-transform motion-safe:duration-200',
            checked ? 'translate-x-2 bg-background' : 'bg-current opacity-60'
          )}
        />
      </span>
    </button>
  );
}

export const NewTicketForm = observer(function NewTicketForm({
  projectId,
  existingTask,
  ticket,
  initialTitle = '',
  onDone,
  onCancel,
}: {
  /** The PM project. */
  projectId: string;
  /** "Create ticket from this task": this task becomes the PM session (no new task). */
  existingTask?: { id: string; name: string };
  /** "Edit ticket": this ticket's title, Goal and priority. */
  ticket?: TicketSummary;
  initialTitle?: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  // Edit: the values in the file when the form opened (later changes do not reset the form).
  const [base] = useState(() => {
    if (!ticket) return null;
    const saved = ticketsStore.savedTicket(ticket.folder) ?? ticket;
    return { title: saved.title, goal: saved.goal ?? '', priority: saved.priority };
  });
  const { navigate } = useNavigate();
  const [title, setTitle] = useState(base?.title ?? initialTitle);
  const [description, setDescription] = useState(base?.goal ?? '');
  const [flash, setFlash] = useState(() => !!base && isFlashPriority(base.priority));
  // The P1-P4 picker keeps its value while Flash is on (a flash ticket opens at P1).
  const [priority, setPriority] = useState(() => {
    if (!base) return DEFAULT_PRIORITY;
    return isFlashPriority(base.priority) ? MIN_PRIORITY : effectivePriority(base.priority);
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canCreate = title.trim().length > 0 && !busy;
  const savedPriority = flash ? FLASH_PRIORITY : priority;
  // A new flash ticket starts at once ("Create ticket from this task" is already active).
  const startsNow = flash && !ticket && !existingTask;

  const save = async () => {
    if (!ticket || !base) return;
    const result = await ticketsStore.editTicket({
      folder: ticket.folder,
      values: { title, goal: description, priority: savedPriority },
      base,
    });
    if (!result.success) {
      setError(result.error);
      return;
    }
    if (result.warning)
      toast.warning(`Ticket #${ticket.id} saved`, { description: result.warning });
    else toast.success(`Ticket #${ticket.id} saved`);
    onDone();
  };

  /** Flash: create (P0), start the PM session like Start on the board, and go to it. */
  const createAndStart = async () => {
    const { created, session } = await ticketsStore.createFlashTicket({
      title,
      description,
      projectId,
    });
    if (!created.success) {
      setError(created.error);
      return;
    }
    const name = `Flash ticket #${created.ticketId}`;
    if (!session?.success) {
      toast.warning(`${name} created`, {
        description: `Could not start its PM session: ${session?.error ?? 'unknown error'}. Start it on the board.`,
      });
      onDone();
      return;
    }
    const warning = [created.warning, session.warning].filter(Boolean).join(' ');
    if (warning) toast.warning(`${name} started`, { description: warning });
    else toast.success(`${name} started`);
    onDone();
    await navigateToTicketTask(navigate, session);
  };

  const create = async () => {
    if (!canCreate) return;
    setBusy(true);
    setError(null);
    try {
      if (ticket) {
        await save();
        return;
      }
      if (startsNow) {
        await createAndStart();
        return;
      }
      const result = await ticketsStore.createTicket({
        title,
        description: existingTask ? '' : description,
        priority: savedPriority,
        projectId,
        ...(existingTask && { existingTask }),
      });
      if (!result.success) {
        setError(result.error);
        return;
      }
      const created = existingTask
        ? `Ticket #${result.ticketId} created`
        : `Ticket #${result.ticketId} saved as parked`;
      if (result.warning) toast.warning(created, { description: result.warning });
      else toast.success(created);
      onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Dialog.Header>
        <Dialog.Title>
          {ticket
            ? `Edit Ticket #${ticket.id}`
            : existingTask
              ? 'Create Ticket from This Task'
              : 'New Ticket'}
        </Dialog.Title>
      </Dialog.Header>
      <Dialog.Body className="pt-0">
        <Field.Group>
          <Field.Root>
            <Field.Label>Title</Field.Label>
            <Input
              value={title}
              autoFocus
              maxLength={200}
              placeholder="What is this ticket about?"
              disabled={busy}
              onChange={(event) => {
                setTitle(event.target.value);
                setError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey) void create();
              }}
            />
          </Field.Root>
          {!existingTask && (
            <Field.Root>
              <Field.Label>{ticket ? 'Goal (optional)' : 'Description (optional)'}</Field.Label>
              <Textarea
                value={description}
                rows={5}
                placeholder="Goes under Goal in the ticket"
                disabled={busy}
                onChange={(event) => {
                  setDescription(event.target.value);
                  setError(null);
                }}
              />
            </Field.Root>
          )}
          <Field.Root>
            <Field.Label>Priority</Field.Label>
            <div className="flex flex-wrap items-center gap-2">
              <FlashToggle
                checked={flash}
                disabled={busy}
                onChange={(next) => {
                  setFlash(next);
                  setError(null);
                }}
              />
              <span className="text-xs text-foreground-passive">
                {flash ? 'P0: urgent, short work' : 'Urgent, short work?'}
              </span>
            </div>
            <PriorityPicker
              value={priority}
              disabled={busy || flash}
              onChange={(next) => {
                setPriority(next);
                setError(null);
              }}
            />
          </Field.Root>
          <p className="text-xs text-foreground-passive">
            {ticket
              ? 'Changes only the title, Goal and priority in the ticket file.'
              : startsNow
                ? 'Saves an active flash ticket in the vault and opens its PM session now.'
                : existingTask
                  ? `Saves an active ticket in the vault with "${existingTask.name}" as its PM session.`
                  : 'Saves a parked ticket in the vault.'}
          </p>
          {error && <Alert.Root status="destructive">{error}</Alert.Root>}
        </Field.Group>
      </Dialog.Body>
      <Dialog.Footer>
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <ConfirmButton variant="primary" onClick={() => void create()} disabled={!canCreate}>
          {ticket
            ? busy
              ? 'Saving…'
              : 'Save'
            : startsNow
              ? busy
                ? 'Starting…'
                : 'Create & start'
              : busy
                ? 'Creating…'
                : 'Create'}
        </ConfirmButton>
      </Dialog.Footer>
    </>
  );
});

/** The "Edit ticket" dialog (from the ticket popup and the task's Ticket panel). */
export function EditTicketDialog({
  ticket,
  open,
  onOpenChange,
}: {
  ticket: TicketSummary;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      {open && (
        // 20% wider than size "sm" (24rem).
        <Dialog.Content size="sm" style={{ maxWidth: 'min(28.8rem, 100%)' }}>
          <NewTicketForm
            projectId="" // Not used when editing.
            ticket={ticket}
            onDone={() => onOpenChange(false)}
            onCancel={() => onOpenChange(false)}
          />
        </Dialog.Content>
      )}
    </Dialog.Root>
  );
}
