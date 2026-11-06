import { describe, expect, it } from 'vitest';
import {
  appendTicketPromptBlock,
  buildTicketPromptBlock,
  compareTicketsForIssues,
  fileUrl,
  firstPromptLine,
  newTicketSessionModalProps,
  pathFromFileUrl,
  pmChildMessage,
  ticketRefFromLinkedIssue,
  ticketToLinkedIssue,
} from './ticket-issues';
import type { TicketSummary } from './tickets';

function ticket(overrides: Partial<TicketSummary>): TicketSummary {
  return {
    id: '1',
    title: 'Ticket',
    status: 'active',
    priority: 3,
    needsOleg: false,
    nextCheck: null,
    pmSession: null,
    updated: '2026-11-01',
    folder: `${overrides.id ?? '1'}-ticket`,
    goal: null,
    nextStep: null,
    waitingOn: [],
    openQuestions: { count: 0, first: null },
    searchText: '',
    ...overrides,
  };
}

const VAULT = '/Users/oleg/Projects/work/vault';

describe('ticketToLinkedIssue', () => {
  it('maps a ticket to an OZ Tickets issue', () => {
    const issue = ticketToLinkedIssue(
      ticket({
        id: '12',
        title: 'Add SCIM sync',
        folder: '12-add-scim',
        goal: 'Sync groups.',
        nextStep: 'Write the ADR (agent)',
        updated: '2026-11-03',
      }),
      VAULT,
      '2026-11-05T10:00:00.000Z'
    );
    expect(issue).toEqual({
      provider: 'oz-tickets',
      identifier: '#12',
      displayIdentifier: '#12',
      title: 'Add SCIM sync',
      url: 'file:///Users/oleg/Projects/work/vault/tickets/12-add-scim/ticket.md',
      description: 'Sync groups.\n\nNext step: Write the ADR (agent)',
      status: 'active',
      updatedAt: '2026-11-03',
      fetchedAt: '2026-11-05T10:00:00.000Z',
    });
  });

  it('leaves out an empty description', () => {
    const issue = ticketToLinkedIssue(ticket({ goal: null, nextStep: null }), VAULT);
    expect(issue.description).toBeUndefined();
  });

  it('round-trips the ticket back for the prompt block', () => {
    const issue = ticketToLinkedIssue(
      ticket({ id: '7', title: 'T', folder: '7-a b#c', goal: 'Do it.', nextStep: 'Step' }),
      '/tmp/my vault'
    );
    expect(ticketRefFromLinkedIssue(issue)).toEqual({
      id: '7',
      title: 'T',
      path: '/tmp/my vault/tickets/7-a b#c/ticket.md',
      goal: 'Do it.',
    });
  });
});

describe('file URLs', () => {
  it('encodes each path segment and decodes it back', () => {
    const url = fileUrl('/a b/c#d/e?f.md');
    expect(url).toBe('file:///a%20b/c%23d/e%3Ff.md');
    expect(pathFromFileUrl(url)).toBe('/a b/c#d/e?f.md');
    expect(pathFromFileUrl('https://example.com/x')).toBeNull();
  });
});

describe('ticketRefFromLinkedIssue', () => {
  it('ignores other providers and missing issues', () => {
    expect(ticketRefFromLinkedIssue(undefined)).toBeNull();
    expect(
      ticketRefFromLinkedIssue({ provider: 'github', identifier: '#1', title: 'x', url: '' })
    ).toBeNull();
  });
});

describe('compareTicketsForIssues', () => {
  it('sorts open tickets first, then by priority, then by id', () => {
    const sorted = [
      ticket({ id: '10', priority: 2 }),
      ticket({ id: '3', priority: null }),
      ticket({ id: '2', priority: 1, status: 'done' }),
      ticket({ id: '9', priority: 2 }),
      ticket({ id: '4', priority: 1 }),
    ].sort(compareTicketsForIssues);
    expect(sorted.map((entry) => entry.id)).toEqual(['4', '9', '10', '3', '2']);
  });
});

describe('buildTicketPromptBlock', () => {
  it('has the ticket, the file, the goal, the rules and the report format', () => {
    const block = buildTicketPromptBlock({
      id: '12',
      title: 'Add SCIM sync',
      path: '/v/tickets/12-add-scim/ticket.md',
      goal: 'Sync groups.',
    });
    expect(block).toContain('ticket #12 "Add SCIM sync"');
    expect(block).toContain(
      'Ticket file (read it for background, do not edit it): /v/tickets/12-add-scim/ticket.md'
    );
    expect(block).toContain('Goal of the ticket:\nSync groups.');
    expect(block).toContain("Follow this repo's own rules first");
    expect(block).toContain('Never merge, never push to the main or release branches');
    expect(block).toMatch(
      /STATUS: working \| needs-input \| blocked \| done\nQUESTION: .*\nPR: .*\nSUMMARY: .*$/
    );
  });

  it('says so when the goal is empty', () => {
    const block = buildTicketPromptBlock({ id: '1', title: 'T', path: null, goal: null });
    expect(block).toContain('(not written yet; see the ticket file)');
    expect(block).not.toContain('Ticket file');
  });
});

describe('appendTicketPromptBlock', () => {
  const base = { id: 'c1', provider: 'claude', title: 'Claude' };

  it('appends to a terminal prompt after what the user typed', () => {
    const result = appendTicketPromptBlock(
      { ...base, type: 'pty', initialPrompt: 'Issue context\n\nFix it' },
      'BLOCK',
      { initialPromptSupported: true }
    );
    expect(result.initialPrompt).toBe('Issue context\n\nFix it\n\nBLOCK');
  });

  it('sends only the block when the user typed nothing', () => {
    const result = appendTicketPromptBlock({ ...base, type: 'pty' }, 'BLOCK', {
      initialPromptSupported: true,
    });
    expect(result.initialPrompt).toBe('BLOCK');
  });

  it('leaves agents without initial prompts alone', () => {
    const conversation = { ...base, type: 'pty' as const };
    expect(appendTicketPromptBlock(conversation, 'BLOCK', { initialPromptSupported: false })).toBe(
      conversation
    );
  });

  it('adds the block to the hidden context of a chat (ACP) prompt', () => {
    const result = appendTicketPromptBlock(
      {
        ...base,
        type: 'acp',
        initialQueue: [{ text: 'Fix it', hiddenContext: 'Issue context' }, { text: 'Then this' }],
      },
      'BLOCK',
      { initialPromptSupported: true }
    );
    expect(result.initialQueue).toEqual([
      { text: 'Fix it', hiddenContext: 'Issue context\n\nBLOCK' },
      { text: 'Then this' },
    ]);
    const empty = appendTicketPromptBlock({ ...base, type: 'acp' }, 'BLOCK', {
      initialPromptSupported: true,
    });
    expect(empty.initialQueue).toEqual([{ text: 'BLOCK' }]);
  });
});

describe('firstPromptLine', () => {
  it('takes the first non-empty line, with mentions as plain labels', () => {
    expect(firstPromptLine('\n  @[#12](issue:v1:abc) Fix @[jwt.ts](src/jwt.ts) now\nmore')).toBe(
      '#12 Fix jwt.ts now'
    );
    expect(firstPromptLine('@[my label](<my label>) x')).toBe('my label x');
  });

  it('shortens long lines to 80 characters', () => {
    const line = firstPromptLine('a'.repeat(100));
    expect(line).toHaveLength(80);
    expect(line.endsWith('…')).toBe(true);
  });

  it('is empty for an empty prompt', () => {
    expect(firstPromptLine('  \n ')).toBe('');
  });
});

describe('pmChildMessage', () => {
  it('names the task, the project and the ticket, and quotes at most 300 characters', () => {
    const message = pmChildMessage({
      taskName: 'scim-sync',
      projectName: 'token-server',
      taskId: 't-1',
      ticketId: '12',
      prompt: `Fix it\n${'x'.repeat(400)}`,
    });
    expect(
      message.startsWith(
        'New child session scim-sync (project token-server, task id t-1) was linked to ticket #12 by Oleg. First prompt: "Fix it xxx'
      )
    ).toBe(true);
    expect(message.endsWith('…". Please record it in the ticket and track it.')).toBe(true);
    const quoted = /First prompt: "(.*)"\./.exec(message)![1]!;
    expect(quoted).toHaveLength(300);
  });
});

describe('newTicketSessionModalProps', () => {
  it('opens the New Task dialog on the project with the ticket as its issue', () => {
    const props = newTicketSessionModalProps(
      ticket({ id: '5', folder: '5-x' }),
      VAULT,
      'project-1'
    );
    expect(props).toMatchObject({
      projectId: 'project-1',
      strategy: 'from-issue',
      initialIssue: { provider: 'oz-tickets', identifier: '#5' },
    });
  });
});
