import { describe, expect, it } from 'vitest';
import {
  isMutedPmTask,
  isPmManagedTask,
  mutePmTasksEnabled,
  parseTaskTicket,
  ticketBadgeText,
  ticketChipText,
  ticketTooltip,
} from './ozdash-task-ticket';

describe('parseTaskTicket', () => {
  it('trims fields and drops blank optional ones', () => {
    expect(parseTaskTicket({ id: ' 123 ', title: '  ', pmSessionId: '' })).toEqual({
      success: true,
      data: { id: '123' },
    });
    expect(parseTaskTicket({ id: '7', title: 'Fix login', pmSessionId: 'task-pm' })).toEqual({
      success: true,
      data: { id: '7', title: 'Fix login', pmSessionId: 'task-pm' },
    });
  });

  it('rejects an empty or too long id and a too long title', () => {
    expect(parseTaskTicket({ id: '   ' })).toMatchObject({ success: false });
    expect(parseTaskTicket({ id: 'x'.repeat(33) })).toEqual({
      success: false,
      error: 'ticket.id must be at most 32 characters',
    });
    expect(parseTaskTicket({ id: '1', title: 't'.repeat(201) })).toEqual({
      success: false,
      error: 'ticket.title must be at most 200 characters',
    });
    expect(parseTaskTicket({ id: '1', pmSessionId: 'p'.repeat(65) })).toEqual({
      success: false,
      error: 'ticket.pmSessionId must be at most 64 characters',
    });
    expect(parseTaskTicket('123')).toMatchObject({ success: false });
  });
});

describe('isMutedPmTask (PM-managed tasks do not notify Oleg)', () => {
  const pmChild = { id: '7', pmSessionId: 'pm-task', createdBy: 'pm' as const };

  it('mutes a task a PM session created through MCP create_task', () => {
    expect(isPmManagedTask('child', pmChild)).toBe(true);
    expect(isMutedPmTask('child', pmChild, true)).toBe(true);
  });

  it('mutes a PM-made task without a PM session id (the origin decides)', () => {
    expect(isMutedPmTask('child', { id: '7', createdBy: 'pm' }, true)).toBe(true);
  });

  it('keeps notifying for a task Oleg created, even when the ticket has a PM session', () => {
    expect(isMutedPmTask('child', { ...pmChild, createdBy: 'oleg' }, true)).toBe(false);
  });

  it('keeps notifying for a task without a marker (Oleg made it in a repo)', () => {
    expect(isMutedPmTask('repo-task', null, true)).toBe(false);
    expect(isMutedPmTask('repo-task', undefined, true)).toBe(false);
  });

  it('keeps notifying for the PM session itself', () => {
    expect(isMutedPmTask('pm-task', pmChild, true)).toBe(false);
    expect(isMutedPmTask('pm-task', { id: '7', pmSessionId: 'pm-task' }, true)).toBe(false);
  });

  it('treats a legacy marker (no createdBy) as PM-managed only when it names a PM session', () => {
    expect(isMutedPmTask('child', { id: '7', pmSessionId: 'pm-task' }, true)).toBe(true);
    expect(isMutedPmTask('child', { id: '7' }, true)).toBe(false);
  });

  it('mutes nothing when OZDASH_MUTE_PM_TASKS=off', () => {
    expect(mutePmTasksEnabled({})).toBe(true);
    expect(mutePmTasksEnabled({ OZDASH_MUTE_PM_TASKS: 'on' })).toBe(true);
    expect(mutePmTasksEnabled({ OZDASH_MUTE_PM_TASKS: ' OFF ' })).toBe(false);
    expect(isMutedPmTask('child', pmChild, false)).toBe(false);
  });
});

describe('ticket text', () => {
  const ticket = { id: '123', title: 'Fix login', pmSessionId: 'task-pm' };

  it('builds the badge and tooltip', () => {
    expect(ticketBadgeText(ticket)).toBe('Ticket #123');
    expect(ticketTooltip({ ticket, pmSession: null, muted: true })).toBe('Ticket #123: Fix login');
    expect(
      ticketTooltip({
        ticket,
        pmSession: { taskId: 'task-pm', projectId: 'work', name: 'PM 123' },
        muted: true,
      })
    ).toBe('Ticket #123: Fix login (PM session: PM 123)');
    expect(ticketTooltip({ ticket: { id: '9' }, pmSession: null, muted: false })).toBe('Ticket #9');
  });

  it('builds the header chip and cuts a long title', () => {
    expect(ticketChipText(ticket)).toEqual({ label: 'Ticket #123', title: 'Fix login' });
    expect(ticketChipText({ id: '1' })).toEqual({ label: 'Ticket #1', title: null });
    expect(ticketChipText({ id: '1', title: 'abcdefghij' }, 5)).toEqual({
      label: 'Ticket #1',
      title: 'abcd…',
    });
  });
});
