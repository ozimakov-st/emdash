import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  toast: { error: vi.fn(), warning: vi.fn() },
  refreshTaskTickets: vi.fn(),
}));
vi.mock('@emdash/ui/react/primitives', () => ({ toast: mocks.toast }));
vi.mock('@core/features/mcp/api/browser/ozdash-task-tickets', () => ({
  refreshTaskTickets: mocks.refreshTaskTickets,
}));
vi.mock('@core/primitives/logging/browser/logger', () => ({ log: { error: vi.fn() } }));

import {
  isOzTicketsProvider,
  linkOzTicketTask,
  prepareOzTicketTask,
  withOzTicketsProvider,
} from './oz-tickets-integration';

const ISSUE = {
  provider: 'oz-tickets' as const,
  identifier: '#12',
  title: 'Add SCIM sync',
  url: 'file:///v/tickets/12-add-scim/ticket.md',
  description: 'Sync groups.\n\nNext step: Write the ADR',
};
const BASE = {
  initialPromptSupported: true,
  taskId: 'task-1',
  taskName: 'scim-sync',
  projectId: 'project-1',
  prompt: 'Fix it',
};
const CONVERSATION = {
  id: 'c1',
  provider: 'claude',
  title: 'Claude',
  type: 'pty' as const,
  initialPrompt: 'Fix it',
};

describe('withOzTicketsProvider', () => {
  it('adds OZ Tickets once, at the end', () => {
    expect(withOzTicketsProvider(['github', 'linear'])).toEqual(['github', 'linear', 'oz-tickets']);
    expect(withOzTicketsProvider(['oz-tickets'])).toEqual(['oz-tickets']);
    expect(isOzTicketsProvider('oz-tickets')).toBe(true);
    expect(isOzTicketsProvider('github')).toBe(false);
  });
});

describe('prepareOzTicketTask', () => {
  it('changes nothing for tasks not based on an OZ ticket', () => {
    const result = prepareOzTicketTask({
      ...BASE,
      linkedIssue: { provider: 'github', identifier: '#1', title: 'x', url: '' },
      conversation: CONVERSATION,
    });
    expect(result).toEqual({ conversation: CONVERSATION, link: null });
  });

  it('appends the ticket block and returns the link input', () => {
    const result = prepareOzTicketTask({ ...BASE, linkedIssue: ISSUE, conversation: CONVERSATION });
    expect(result.conversation?.initialPrompt).toMatch(/^Fix it\n\n---\nTicket context \(OZdash\)/);
    expect(result.conversation?.initialPrompt).toContain(
      'Ticket file (read it for background, do not edit it): /v/tickets/12-add-scim/ticket.md'
    );
    expect(result.conversation?.initialPrompt).toContain('Goal of the ticket:\nSync groups.\n');
    expect(result.link).toEqual({
      ticketId: '12',
      taskId: 'task-1',
      taskName: 'scim-sync',
      projectId: 'project-1',
      prompt: 'Fix it',
    });
  });

  it('still links a task without a conversation', () => {
    const result = prepareOzTicketTask({ ...BASE, linkedIssue: ISSUE, conversation: undefined });
    expect(result.conversation).toBeUndefined();
    expect(result.link?.ticketId).toBe('12');
  });
});

describe('linkOzTicketTask', () => {
  afterEach(() => {
    delete (globalThis as { ozdash?: unknown }).ozdash;
    vi.clearAllMocks();
  });
  const link = { ...BASE, ticketId: '12' };

  it('sends the link to the main process and refreshes the task markers', async () => {
    const linkTicketTask = vi.fn(async () => ({
      success: true as const,
      pmNotified: true,
      warnings: [],
    }));
    (globalThis as { ozdash?: unknown }).ozdash = { linkTicketTask };
    await linkOzTicketTask(link);
    expect(linkTicketTask).toHaveBeenCalledWith(link);
    expect(mocks.refreshTaskTickets).toHaveBeenCalled();
    expect(mocks.toast.error).not.toHaveBeenCalled();
    expect(mocks.toast.warning).not.toHaveBeenCalled();
  });

  it('shows warnings and errors as toasts', async () => {
    (globalThis as { ozdash?: unknown }).ozdash = {
      linkTicketTask: async () => ({ success: true, pmNotified: false, warnings: ['sync failed'] }),
    };
    await linkOzTicketTask(link);
    expect(mocks.toast.warning).toHaveBeenCalledWith('Ticket #12 linked with problems', {
      description: 'sync failed',
    });
    (globalThis as { ozdash?: unknown }).ozdash = {
      linkTicketTask: async () => {
        throw new Error('ipc down');
      },
    };
    await linkOzTicketTask(link);
    expect(mocks.toast.error).toHaveBeenCalledWith('Ticket #12 was not linked', {
      description: 'Error: ipc down',
    });
  });

  it('does nothing without a link or outside OZdash', async () => {
    await linkOzTicketTask(null);
    await linkOzTicketTask(link);
    expect(mocks.refreshTaskTickets).not.toHaveBeenCalled();
  });
});
