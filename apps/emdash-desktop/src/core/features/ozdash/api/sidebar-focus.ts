// Fork (ozimakov-st): the sidebar "Focus" view (on by default).
//
// - The PM project always shows.
// - Other projects show only when they have a direct task (not PM-managed, see
//   `isPmManagedTask` in mcp/api/ozdash-task-ticket.ts), and list only those.
// - PM-managed tasks are hidden: the Ticket tab lists them.
// - The open task (and the open project) always shows.

export type SidebarFocusProject = {
  projectId: string;
  /** The PM project ("work"): always shown. */
  isPm: boolean;
  /** The project's unpinned, unarchived task ids. */
  taskIds: readonly string[];
};

export type SidebarFocusInput = {
  projects: readonly SidebarFocusProject[];
  isPmManagedTask: (taskId: string) => boolean;
  /** The open project / task, if any. They always show. */
  selected: { projectId?: string; taskId?: string };
};

export type SidebarFocus = {
  isProjectShown: (projectId: string) => boolean;
  isTaskShown: (taskId: string) => boolean;
  hiddenProjects: number;
  hiddenPmTasks: number;
};

export function sidebarFocus(input: SidebarFocusInput): SidebarFocus {
  const shownProjects = new Set<string>();
  const hiddenTasks = new Set<string>();
  let hiddenProjects = 0;
  for (const project of input.projects) {
    let shownTasks = 0;
    for (const taskId of project.taskIds) {
      if (taskId !== input.selected.taskId && input.isPmManagedTask(taskId)) {
        hiddenTasks.add(taskId);
      } else {
        shownTasks += 1;
      }
    }
    if (project.isPm || shownTasks > 0 || project.projectId === input.selected.projectId) {
      shownProjects.add(project.projectId);
    } else {
      hiddenProjects += 1;
    }
  }
  return {
    isProjectShown: (projectId) => shownProjects.has(projectId),
    isTaskShown: (taskId) => !hiddenTasks.has(taskId),
    hiddenProjects,
    hiddenPmTasks: hiddenTasks.size,
  };
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/** Footer text, for example `3 projects · 7 PM tasks hidden`; null when nothing is hidden. */
export function focusHiddenText(focus: Pick<SidebarFocus, 'hiddenProjects' | 'hiddenPmTasks'>) {
  const parts: string[] = [];
  if (focus.hiddenProjects > 0) parts.push(plural(focus.hiddenProjects, 'project'));
  if (focus.hiddenPmTasks > 0) parts.push(plural(focus.hiddenPmTasks, 'PM task'));
  return parts.length > 0 ? `${parts.join(' · ')} hidden` : null;
}

/**
 * Applies a new order of the shown items to the full list: shown items take their new
 * order in the slots they held, hidden items keep their places. Drag-and-drop in the
 * Focus view uses it so hidden projects / tasks do not move.
 */
export function mergeShownOrder(all: readonly string[], shownInNewOrder: readonly string[]) {
  const shown = new Set(shownInNewOrder);
  let next = 0;
  return all.map((id) => (shown.has(id) ? shownInNewOrder[next++]! : id));
}
