// OZdash: the attention rule (../attention.ts) applied to the live renderer stores.
import { conversationRegistry } from '@core/features/conversations/api/browser/stores/conversation-registry';
import {
  asAvailableProject,
  getProjectManagerStore,
} from '@core/features/projects/api/browser/stores/project-selectors';
import type { TaskStore } from '@core/features/tasks/api/browser/stores/task-store';
import { taskManagerStoreToken } from '@core/features/tasks/contributions/browser/project-store-tokens';
import {
  countNeedingAttention,
  taskAttention,
  watchBadgeCount,
  type AttentionLevel,
} from '../attention';

export function taskAttentionLevel(task: TaskStore): AttentionLevel | null {
  const manager = conversationRegistry.get(task.data.id);
  return manager ? taskAttention(manager.conversations.values()) : null;
}

/** Tasks the sidebar lists: no automation runs, no archived tasks (as in sidebar-store.ts). */
function isListedTask(task: TaskStore): boolean {
  return (
    task.data.type !== 'automation-run' &&
    (task.state === 'unregistered' || !('archivedAt' in task.data && task.data.archivedAt))
  );
}

function listedTasks(projectId: string): TaskStore[] {
  const project = asAvailableProject(getProjectManagerStore().projects.get(projectId));
  if (!project) return [];
  return Array.from(project.get(taskManagerStoreToken).tasks.values()).filter(isListedTask);
}

/** Tasks under a project row that need attention. Pinned tasks show in the pinned list instead. */
export function projectAttentionCount(projectId: string): number {
  return countNeedingAttention(
    listedTasks(projectId)
      .filter((task) => !task.data.isPinned)
      .map(taskAttentionLevel)
  );
}

/** All listed tasks (pinned too) that need attention: the Dock badge number. */
export function totalAttentionCount(): number {
  let count = 0;
  for (const projectId of getProjectManagerStore().projects.keys()) {
    count += countNeedingAttention(listedTasks(projectId).map(taskAttentionLevel));
  }
  return count;
}

type AttentionBridge = { setAttentionCount?: (count: number) => void };

/** Keeps the macOS Dock badge in sync with the attention count. No-op outside Electron. */
export function startAttentionBadge(): () => void {
  const bridge = (globalThis as { ozdash?: AttentionBridge }).ozdash;
  const send = bridge?.setAttentionCount;
  if (!send) return () => {};
  return watchBadgeCount(totalAttentionCount, (count) => send(count));
}
