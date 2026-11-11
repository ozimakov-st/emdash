import { describe, expect, it } from 'vitest';
import {
  focusHiddenText,
  mergeShownOrder,
  sidebarFocus,
  type SidebarFocusInput,
} from './sidebar-focus';

const pmManaged = new Set(['pm-child-1', 'pm-child-2', 'pm-child-3', 'work-child']);

function input(overrides: Partial<SidebarFocusInput> = {}): SidebarFocusInput {
  return {
    projects: [
      { projectId: 'work', isPm: true, taskIds: ['pm-session', 'work-child'] },
      { projectId: 'mixed', isPm: false, taskIds: ['direct-1', 'pm-child-1'] },
      { projectId: 'pm-only', isPm: false, taskIds: ['pm-child-2', 'pm-child-3'] },
      { projectId: 'empty', isPm: false, taskIds: [] },
    ],
    isPmManagedTask: (taskId) => pmManaged.has(taskId),
    selected: {},
    ...overrides,
  };
}

describe('sidebarFocus', () => {
  it('shows the PM project, and other projects only with a direct task', () => {
    const focus = sidebarFocus(input());
    expect(focus.isProjectShown('work')).toBe(true);
    expect(focus.isProjectShown('mixed')).toBe(true);
    expect(focus.isProjectShown('pm-only')).toBe(false);
    expect(focus.isProjectShown('empty')).toBe(false);
  });

  it('shows the PM project even when it has no tasks', () => {
    const focus = sidebarFocus(
      input({ projects: [{ projectId: 'work', isPm: true, taskIds: [] }] })
    );
    expect(focus.isProjectShown('work')).toBe(true);
    expect(focus.hiddenProjects).toBe(0);
  });

  it('hides PM-managed tasks and keeps direct tasks and PM sessions', () => {
    const focus = sidebarFocus(input());
    expect(focus.isTaskShown('pm-session')).toBe(true);
    expect(focus.isTaskShown('direct-1')).toBe(true);
    expect(focus.isTaskShown('pm-child-1')).toBe(false);
    expect(focus.isTaskShown('work-child')).toBe(false);
  });

  it('counts hidden projects and hidden PM tasks', () => {
    const focus = sidebarFocus(input());
    expect(focus.hiddenProjects).toBe(2);
    expect(focus.hiddenPmTasks).toBe(4);
  });

  it('always shows the open task, and so its project', () => {
    const focus = sidebarFocus(input({ selected: { projectId: 'pm-only', taskId: 'pm-child-2' } }));
    expect(focus.isTaskShown('pm-child-2')).toBe(true);
    expect(focus.isTaskShown('pm-child-3')).toBe(false);
    expect(focus.isProjectShown('pm-only')).toBe(true);
    expect(focus.hiddenProjects).toBe(1);
    expect(focus.hiddenPmTasks).toBe(3);
  });

  it('always shows the open project', () => {
    const focus = sidebarFocus(input({ selected: { projectId: 'empty' } }));
    expect(focus.isProjectShown('empty')).toBe(true);
  });
});

describe('focusHiddenText', () => {
  it('names what is hidden', () => {
    expect(focusHiddenText({ hiddenProjects: 3, hiddenPmTasks: 7 })).toBe(
      '3 projects · 7 PM tasks hidden'
    );
    expect(focusHiddenText({ hiddenProjects: 1, hiddenPmTasks: 0 })).toBe('1 project hidden');
    expect(focusHiddenText({ hiddenProjects: 0, hiddenPmTasks: 1 })).toBe('1 PM task hidden');
  });

  it('is null when nothing is hidden', () => {
    expect(focusHiddenText({ hiddenProjects: 0, hiddenPmTasks: 0 })).toBeNull();
  });
});

describe('mergeShownOrder', () => {
  it('reorders the shown items and keeps hidden items in place', () => {
    expect(mergeShownOrder(['a', 'h1', 'b', 'c', 'h2'], ['c', 'a', 'b'])).toEqual([
      'c',
      'h1',
      'a',
      'b',
      'h2',
    ]);
  });

  it('is the new order when nothing is hidden', () => {
    expect(mergeShownOrder(['a', 'b', 'c'], ['b', 'c', 'a'])).toEqual(['b', 'c', 'a']);
  });
});
