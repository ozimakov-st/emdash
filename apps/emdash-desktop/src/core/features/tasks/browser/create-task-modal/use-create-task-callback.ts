import { useCallback, useRef } from 'react';
import {
  linkOzTicketTask,
  prepareOzTicketTask,
} from '@core/features/ozdash/api/browser/oz-tickets-integration';
import { getTaskManagerStore } from '@core/features/tasks/api/browser/task-state/task-selectors';
import type { InitialConversationState } from '@core/features/tasks/contributions/browser/task-config/initial-conversation-section';
import { taskViewDef } from '@core/features/tasks/contributions/views';
import { log } from '@core/primitives/logging/browser/logger';
import type { NavigateFnTyped } from '@core/primitives/navigation/browser/navigation-hooks';
import { buildInitialConversation, deriveInitialStatus } from './build-create-task-params';
import type { CreateTaskState } from './use-create-task-state';

interface UseCreateTaskCallbackParams {
  selectedProjectId: string | undefined;
  state: CreateTaskState;
  initialConversation: InitialConversationState;
  navigate: NavigateFnTyped;
  onCreated: () => void;
}

export function useCreateTaskCallback({
  selectedProjectId,
  state,
  initialConversation,
  navigate,
  onCreated,
}: UseCreateTaskCallbackParams): { handleCreateTask: () => void; canCreate: boolean } {
  const submitting = useRef(false);
  const canCreate = !!selectedProjectId && state.isValid && initialConversation.settingsReady;

  const handleCreateTask = useCallback(async () => {
    if (!selectedProjectId || !canCreate || submitting.current) return;
    const taskManager = getTaskManagerStore(selectedProjectId);
    if (!taskManager) return;

    submitting.current = true;
    try {
      await initialConversation.flushSettings();
    } catch (error) {
      submitting.current = false;
      log.error('Could not save conversation settings', error);
      return;
    }
    const id = crypto.randomUUID();
    const linkedIssue = state.linkedType === 'issue' ? (state.linkedIssue ?? undefined) : undefined;
    // Fork (ozimakov-st): a task based on an OZ ticket gets the ticket block in its
    // prompt, and is recorded in the ticket once it exists.
    const ozTicket = prepareOzTicketTask({
      linkedIssue,
      conversation: buildInitialConversation(initialConversation),
      initialPromptSupported: initialConversation.initialPromptSupported,
      taskId: id,
      taskName: state.taskName.effectiveTaskName,
      projectId: selectedProjectId,
      prompt: initialConversation.prompt,
    });
    void taskManager
      .createTask({
        id,
        projectId: selectedProjectId,
        taskConfig: {
          version: '1',
          name: state.taskName.effectiveTaskName,
          linkedIssue,
          initialStatus: deriveInitialStatus(state.linkedType, state.linkedPR),
          initialConversation: ozTicket.conversation,
        },
        workspaceConfig: state.workspaceConfig.resolvedConfig,
      })
      .then(() => linkOzTicketTask(ozTicket.link))
      .catch((e) => log.error('create task failed', e));

    navigate(taskViewDef({ projectId: selectedProjectId, taskId: id }));
    onCreated();
  }, [selectedProjectId, state, initialConversation, navigate, onCreated, canCreate]);

  return { handleCreateTask: () => void handleCreateTask(), canCreate };
}
