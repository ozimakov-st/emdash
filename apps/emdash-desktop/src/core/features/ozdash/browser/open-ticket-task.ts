// Fork (ozimakov-st): go to a ticket's PM session task after it was opened or created
// (Start on the board, a new flash ticket).
import { when } from 'mobx';
import { getTaskManagerStore } from '@core/features/tasks/api/browser/task-state/task-selectors';
import { taskViewDef } from '@core/features/tasks/contributions/views';
import type { NavigateFnTyped } from '@core/primitives/navigation/browser/navigation-hooks';

/** How long to wait for a new task to reach the renderer's task list. */
const NEW_TASK_TIMEOUT_MS = 20_000;

/** Waits until the task is in the renderer's task list (a new task comes a moment later), then opens it. */
export async function navigateToTicketTask(
  navigate: NavigateFnTyped,
  target: { projectId: string; taskId: string }
): Promise<void> {
  await when(() => !!getTaskManagerStore(target.projectId)?.tasks.has(target.taskId), {
    timeout: NEW_TASK_TIMEOUT_MS,
  }).catch(() => undefined);
  navigate(taskViewDef({ projectId: target.projectId, taskId: target.taskId }));
}
