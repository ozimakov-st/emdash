import { describe, expect, it } from 'vitest';
import { parsePmTask, pmTaskBadgeText, pmTaskChipText, pmTaskTooltip } from './ozdash-pm-task';

describe('parsePmTask', () => {
  it('trims fields and drops blank optional ones', () => {
    expect(parsePmTask({ id: ' 123 ', title: '  ', managerTaskId: '' })).toEqual({
      success: true,
      data: { id: '123' },
    });
    expect(parsePmTask({ id: '7', title: 'Fix login', managerTaskId: 'task-pm' })).toEqual({
      success: true,
      data: { id: '7', title: 'Fix login', managerTaskId: 'task-pm' },
    });
  });

  it('rejects an empty or too long id and a too long title', () => {
    expect(parsePmTask({ id: '   ' })).toMatchObject({ success: false });
    expect(parsePmTask({ id: 'x'.repeat(33) })).toEqual({
      success: false,
      error: 'pmTask.id must be at most 32 characters',
    });
    expect(parsePmTask({ id: '1', title: 't'.repeat(201) })).toEqual({
      success: false,
      error: 'pmTask.title must be at most 200 characters',
    });
    expect(parsePmTask('123')).toMatchObject({ success: false });
  });
});

describe('PM task text', () => {
  const pmTask = { id: '123', title: 'Fix login', managerTaskId: 'task-pm' };

  it('builds the badge and tooltip', () => {
    expect(pmTaskBadgeText(pmTask)).toBe('#123');
    expect(pmTaskTooltip({ pmTask, manager: null })).toBe('PM task #123: Fix login');
    expect(
      pmTaskTooltip({
        pmTask,
        manager: { taskId: 'task-pm', projectId: 'work', name: 'PM 123' },
      })
    ).toBe('PM task #123: Fix login (managed by PM 123)');
    expect(pmTaskTooltip({ pmTask: { id: '9' }, manager: null })).toBe('PM task #9');
  });

  it('builds the header chip and cuts a long title', () => {
    expect(pmTaskChipText(pmTask)).toEqual({ label: 'PM #123', title: 'Fix login' });
    expect(pmTaskChipText({ id: '1' })).toEqual({ label: 'PM #1', title: null });
    expect(pmTaskChipText({ id: '1', title: 'abcdefghij' }, 5)).toEqual({
      label: 'PM #1',
      title: 'abcd…',
    });
  });
});
