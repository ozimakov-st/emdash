// Fork (ozimakov-st): the "New ticket" dialog content. In the PM project it replaces
// the New Task dialog (see create-task-modal.tsx); the "No ticket" chip uses it for
// "Create ticket from this task". Creating writes `vault/tickets/<id>-<slug>/ticket.md`
// and syncs the vault once. A new ticket is parked (no PM session; Start it on the
// board). With `existingTask`, that task is its PM session and the ticket is active.
import { Alert, Button, Dialog, Field, Input, Textarea, toast } from '@emdash/ui/react/primitives';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { ticketsStore } from '@core/features/ozdash/api/browser/tickets-store';
import { ConfirmButton } from '@core/primitives/keybindings/browser/confirm-button';

export const NewTicketForm = observer(function NewTicketForm({
  projectId,
  existingTask,
  initialTitle = '',
  onDone,
  onCancel,
}: {
  /** The PM project. */
  projectId: string;
  /** "Create ticket from this task": this task becomes the PM session (no new task). */
  existingTask?: { id: string; name: string };
  initialTitle?: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canCreate = title.trim().length > 0 && !busy;

  const create = async () => {
    if (!canCreate) return;
    setBusy(true);
    setError(null);
    try {
      const result = await ticketsStore.createTicket({
        title,
        description: existingTask ? '' : description,
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
        <Dialog.Title>{existingTask ? 'Create Ticket from This Task' : 'New Ticket'}</Dialog.Title>
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
              <Field.Label>Description (optional)</Field.Label>
              <Textarea
                value={description}
                rows={5}
                placeholder="Goes under Goal in the ticket"
                disabled={busy}
                onChange={(event) => setDescription(event.target.value)}
              />
            </Field.Root>
          )}
          <p className="text-xs text-foreground-passive">
            {existingTask
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
          {busy ? 'Creating…' : 'Create'}
        </ConfirmButton>
      </Dialog.Footer>
    </>
  );
});
