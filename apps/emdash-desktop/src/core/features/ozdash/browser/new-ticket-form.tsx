// Fork (ozimakov-st): the "New ticket" dialog content. In the PM project it replaces
// the New Task dialog (see create-task-modal.tsx); the "No ticket" chip uses it for
// "Create ticket from this task". Creating writes `vault/tickets/<id>-<slug>/ticket.md`,
// starts the PM session task (unless `existingTask` is set), syncs the vault once, and
// opens the task.
import { Alert, Button, Dialog, Field, Input, Textarea, toast } from '@emdash/ui/react/primitives';
import { when } from 'mobx';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { ticketsStore } from '@core/features/ozdash/api/browser/tickets-store';
import { getTaskManagerStore } from '@core/features/tasks/api/browser/task-state/task-selectors';
import { taskViewDef } from '@core/features/tasks/contributions/views';
import { ConfirmButton } from '@core/primitives/keybindings/browser/confirm-button';
import { useNavigate } from '@core/primitives/navigation/browser/navigation-hooks';

/** How long to wait for a new task to reach the renderer's task list. */
const NEW_TASK_TIMEOUT_MS = 20_000;

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
  const { navigate } = useNavigate();
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Set when the ticket was written but its task was not created: only "Close" is left. */
  const [kept, setKept] = useState<string | null>(null);

  const canCreate = title.trim().length > 0 && !busy && !kept;

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
      if (!result.taskId) {
        setKept(result.warning ?? `Ticket #${result.ticketId} was saved without a PM session.`);
        return;
      }
      if (result.warning)
        toast.warning(`Ticket #${result.ticketId}`, { description: result.warning });
      else toast.success(`Ticket #${result.ticketId} created`);
      if (!existingTask) {
        const taskId = result.taskId;
        // A new task reaches the renderer's task list a moment after it is created.
        await when(() => !!getTaskManagerStore(result.projectId)?.tasks.has(taskId), {
          timeout: NEW_TASK_TIMEOUT_MS,
        }).catch(() => undefined);
        navigate(taskViewDef({ projectId: result.projectId, taskId }));
      }
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
              disabled={busy || !!kept}
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
                disabled={busy || !!kept}
                onChange={(event) => setDescription(event.target.value)}
              />
            </Field.Root>
          )}
          <p className="text-xs text-foreground-passive">
            {existingTask
              ? `Saves a draft ticket in the vault with "${existingTask.name}" as its PM session.`
              : 'Saves a draft ticket in the vault and starts its PM session (/oz-pm).'}
          </p>
          {error && <Alert.Root status="destructive">{error}</Alert.Root>}
          {kept && <Alert.Root status="warning">{kept}</Alert.Root>}
        </Field.Group>
      </Dialog.Body>
      <Dialog.Footer>
        {kept ? (
          <Button variant="primary" onClick={onDone}>
            Close
          </Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
            <ConfirmButton variant="primary" onClick={() => void create()} disabled={!canCreate}>
              {busy ? 'Creating…' : 'Create'}
            </ConfirmButton>
          </>
        )}
      </Dialog.Footer>
    </>
  );
});
