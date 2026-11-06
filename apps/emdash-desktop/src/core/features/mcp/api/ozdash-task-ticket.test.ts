import { describe, expect, it } from 'vitest';
import {
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

describe('ticket text', () => {
  const ticket = { id: '123', title: 'Fix login', pmSessionId: 'task-pm' };

  it('builds the badge and tooltip', () => {
    expect(ticketBadgeText(ticket)).toBe('Ticket #123');
    expect(ticketTooltip({ ticket, pmSession: null })).toBe('Ticket #123: Fix login');
    expect(
      ticketTooltip({
        ticket,
        pmSession: { taskId: 'task-pm', projectId: 'work', name: 'PM 123' },
      })
    ).toBe('Ticket #123: Fix login (PM session: PM 123)');
    expect(ticketTooltip({ ticket: { id: '9' }, pmSession: null })).toBe('Ticket #9');
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
