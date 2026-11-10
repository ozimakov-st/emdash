// Fork (ozimakov-st): the "New ticket" dialog content. In the PM project it replaces
// the New Task dialog (see create-task-modal.tsx); the "No ticket" chip uses it for
// "Create ticket from this task". Creating writes `vault/tickets/<id>-<slug>/ticket.md`
// and syncs the vault once. A new ticket is parked (no PM session; Start it on the
// board). With `existingTask`, that task is its PM session and the ticket is active.
// With `ticket`, it is the "Edit ticket" form: the same fields, prefilled from the file,
// rewritten in place (see editTicketContent).
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
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { ticketsStore } from '@core/features/ozdash/api/browser/tickets-store';
import { priorityChipStyle, priorityColor } from '@core/features/ozdash/api/priority-palette';
import {
  DEFAULT_PRIORITY,
  effectivePriority,
  type TicketSummary,
} from '@core/features/ozdash/api/tickets';
import { ConfirmButton } from '@core/primitives/keybindings/browser/confirm-button';

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
  const [title, setTitle] = useState(base?.title ?? initialTitle);
  const [description, setDescription] = useState(base?.goal ?? '');
  const [priority, setPriority] = useState(
    base ? effectivePriority(base.priority) : DEFAULT_PRIORITY
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canCreate = title.trim().length > 0 && !busy;

  const save = async () => {
    if (!ticket || !base) return;
    const result = await ticketsStore.editTicket({
      folder: ticket.folder,
      values: { title, goal: description, priority },
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

  const create = async () => {
    if (!canCreate) return;
    setBusy(true);
    setError(null);
    try {
      if (ticket) {
        await save();
        return;
      }
      const result = await ticketsStore.createTicket({
        title,
        description: existingTask ? '' : description,
        priority,
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
            <PriorityPicker
              value={priority}
              disabled={busy}
              onChange={(next) => {
                setPriority(next);
                setError(null);
              }}
            />
          </Field.Root>
          <p className="text-xs text-foreground-passive">
            {ticket
              ? 'Changes only the title, Goal and priority in the ticket file.'
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
          {ticket ? (busy ? 'Saving…' : 'Save') : busy ? 'Creating…' : 'Create'}
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
        <Dialog.Content size="sm">
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
