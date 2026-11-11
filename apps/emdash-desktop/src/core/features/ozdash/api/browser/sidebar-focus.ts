// Fork (ozimakov-st): live inputs of the sidebar Focus view (rule: ../sidebar-focus.ts).
// The sidebar store reads them through `ozdashSidebarFocusSource` (set in renderer/main.tsx).
import { taskTicketMarkers } from '@core/features/mcp/api/browser/ozdash-task-tickets';
import { isPmManagedTask } from '@core/features/mcp/api/ozdash-task-ticket';
import {
  ozdashSidebarFocusMemento,
  toggleShowAll,
  type OzdashSidebarFocusState,
} from '@core/features/ozdash/contributions/mementos';
import type { MementoHandle } from '@core/primitives/mementos/browser';
import { getMementoClient } from '@core/primitives/mementos/browser/singleton';
import { getNavigation } from '@core/primitives/navigation/browser/navigation-selectors';
import { appSubject } from '@core/primitives/subjects/api';

let handle: MementoHandle<OzdashSidebarFocusState> | undefined;

function focusHandle(): MementoHandle<OzdashSidebarFocusState> {
  handle ??= getMementoClient().subject(appSubject({})).handle(ozdashSidebarFocusMemento);
  return handle;
}

/** True in the Focus view (the default); false in "show all". Observable. */
export function isSidebarFocusOn(): boolean {
  return !focusHandle().value.showAll;
}

export function toggleSidebarFocus(): void {
  focusHandle().update(toggleShowAll);
}

/** True when a PM session manages the task (same rule as muting). Observable. */
export function isPmManagedTaskInWindow(taskId: string): boolean {
  return isPmManagedTask(taskId, taskTicketMarkers().get(taskId)?.ticket);
}

/** The open project / task; the Focus view always shows them. Observable. */
export function openSidebarItem(): { projectId?: string; taskId?: string } {
  const ref = getNavigation().currentRef;
  if (ref.viewId !== 'task' && ref.viewId !== 'project') return {};
  const { projectId, taskId } = ref.params as { projectId?: string; taskId?: string };
  return { projectId, taskId: ref.viewId === 'task' ? taskId : undefined };
}

export const ozdashSidebarFocusSource = {
  isOn: isSidebarFocusOn,
  isPmManagedTask: isPmManagedTaskInWindow,
  selected: openSidebarItem,
};
