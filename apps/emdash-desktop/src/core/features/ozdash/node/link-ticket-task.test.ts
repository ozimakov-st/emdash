import { describe, expect, it, vi } from 'vitest';
import type { TicketSummary } from '../api/tickets';
import {
  linkTicketTask,
  notifyPmSession,
  type LinkTicketTaskDependencies,
} from './link-ticket-task';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never;

function ticket(overrides: Partial<TicketSummary> = {}): TicketSummary {
  return {
    id: '12',
    title: 'Add SCIM sync',
    status: 'active',
    priority: 2,
    rank: null,
    needsOleg: false,
    nextCheck: null,
    pmSession: 'pm-task',
    updated: '2026-11-01',
    folder: '12-add-scim',
    goal: 'Sync groups.',
    nextStep: null,
    waitingOn: [],
    openQuestions: { count: 0, first: null },
    searchText: '',
    ...overrides,
  };
}

function dependencies(
  overrides: Partial<LinkTicketTaskDependencies> = {}
): LinkTicketTaskDependencies & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    tickets: {
      findTicket: async (id) => (id === '12' ? ticket() : null),
      linkChildTask: async (folder, link) => {
        calls.push(`link ${folder} ${link.taskName} ${link.projectName} "${link.promptLine}"`);
        return { success: true };
      },
    },
    setMarker: async (taskId, value) => {
      calls.push(`marker ${taskId} ${JSON.stringify(value)}`);
    },
    projectName: async () => 'token-server',
    taskProject: async (taskId) => (taskId === 'pm-task' ? 'pm-project' : null),
    sendMessage: async (input) => {
      calls.push(`send ${input.projectId} ${input.taskId}`);
      return { success: true };
    },
    logger,
    ...overrides,
  };
}

const INPUT = {
  ticketId: '12',
  taskId: 'child-1',
  taskName: 'scim-sync',
  projectId: 'project-1',
  prompt: 'Add the endpoint\nwith tests',
};

describe('notifyPmSession', () => {
  const message = 'hello';

  it('skips a ticket without pm_session', async () => {
    const deps = dependencies();
    await expect(
      notifyPmSession(deps, { pmSession: null, childTaskId: 'c', message })
    ).resolves.toEqual({ kind: 'skipped', reason: 'the ticket has no pm_session' });
    expect(deps.calls).toEqual([]);
  });

  it('skips a PM session task that does not exist', async () => {
    const deps = dependencies();
    const outcome = await notifyPmSession(deps, { pmSession: 'gone', childTaskId: 'c', message });
    expect(outcome.kind).toBe('skipped');
    expect(deps.calls).toEqual([]);
  });

  it('skips a PM session that is not running', async () => {
    const deps = dependencies({
      sendMessage: async () => ({ success: false, error: 'Conversation x is not running.' }),
    });
    const outcome = await notifyPmSession(deps, {
      pmSession: 'pm-task',
      childTaskId: 'c',
      message,
    });
    expect(outcome).toEqual({
      kind: 'skipped',
      reason: 'PM session not running: Conversation x is not running.',
    });
  });

  it('sends to a running PM session', async () => {
    const send = vi.fn(async () => ({ success: true as const }));
    const outcome = await notifyPmSession(dependencies({ sendMessage: send }), {
      pmSession: 'pm-task',
      childTaskId: 'c',
      message,
    });
    expect(outcome).toEqual({ kind: 'sent' });
    expect(send).toHaveBeenCalledWith({ projectId: 'pm-project', taskId: 'pm-task', message });
  });

  it('never messages the new task itself', async () => {
    const deps = dependencies();
    const outcome = await notifyPmSession(deps, {
      pmSession: 'pm-task',
      childTaskId: 'pm-task',
      message,
    });
    expect(outcome.kind).toBe('skipped');
    expect(deps.calls).toEqual([]);
  });
});

describe('linkTicketTask', () => {
  it('marks the task, updates the ticket, then tells the PM session', async () => {
    const send = vi.fn(async () => ({ success: true as const }));
    const deps = dependencies({ sendMessage: send });
    const result = await linkTicketTask(deps, INPUT);
    expect(result).toEqual({ success: true, pmNotified: true, warnings: [] });
    expect(deps.calls).toEqual([
      'marker child-1 {"id":"12","title":"Add SCIM sync","pmSessionId":"pm-task"}',
      'link 12-add-scim scim-sync token-server "Add the endpoint"',
    ]);
    expect(send).toHaveBeenCalledWith({
      projectId: 'pm-project',
      taskId: 'pm-task',
      message:
        'New child session scim-sync (project token-server, task id child-1) was linked to ' +
        'ticket #12 by Oleg. First prompt: "Add the endpoint with tests". ' +
        'Please record it in the ticket and track it.',
    });
  });

  it('still succeeds when the PM session is not running', async () => {
    const deps = dependencies({
      sendMessage: async () => ({ success: false, error: 'not running' }),
    });
    await expect(linkTicketTask(deps, INPUT)).resolves.toEqual({
      success: true,
      pmNotified: false,
      warnings: [],
    });
  });

  it('reports ticket update problems as warnings', async () => {
    const deps = dependencies({
      tickets: {
        findTicket: async () => ticket({ pmSession: null }),
        linkChildTask: async () => ({ success: false, error: 'disk full' }),
      },
      setMarker: async () => {
        throw new Error('db locked');
      },
    });
    const result = await linkTicketTask(deps, INPUT);
    expect(result).toEqual({
      success: true,
      pmNotified: false,
      warnings: [
        'The task was not marked with the ticket: Error: db locked',
        'Ticket #12 was not updated: disk full',
      ],
    });
  });

  it('marks the task but fails when the ticket is not in the vault', async () => {
    const deps = dependencies();
    const result = await linkTicketTask(deps, { ...INPUT, ticketId: '99' });
    expect(result).toEqual({ success: false, error: 'Ticket #99 was not found in the vault' });
    expect(deps.calls).toEqual(['marker child-1 {"id":"99"}']);
  });

  it('uses the project id when the project name is unknown', async () => {
    const deps = dependencies({ projectName: async () => null });
    await linkTicketTask(deps, INPUT);
    expect(deps.calls[1]).toBe('link 12-add-scim scim-sync project-1 "Add the endpoint"');
  });
});
