import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { conversationRegistryTable } from '@core/features/conversations/api/node/registry';
import type { TaskTicket } from '@core/features/mcp/api/ozdash-task-ticket';
import type { McpToolDependencies } from '@core/features/mcp/node/server/dependencies';
import { ticketEvent } from '@core/features/ozdash/api/pm-relay';
import type { TicketSummary } from '@core/features/ozdash/api/tickets';
import { tasks } from '@core/services/app-db/node/schema';
import { appendTicketEvent, resolveRelayTarget, resolveTicketEvent } from './ozdash-pm-relay';

type PmRow = { projectId: string; archivedAt: string | null };

/** Answers the PM lookup, the task name lookup and the conversation lookup. */
function fakeDb(pm: PmRow | null) {
  return {
    select: (fields: Record<string, unknown>) => ({
      from: (table: unknown) => {
        const rows =
          table === conversationRegistryTable
            ? [{ title: 'Review', provider: 'cursor' }]
            : table === tasks && 'archivedAt' in fields
              ? pm
                ? [pm]
                : []
              : [{ name: 'fix-login', projectName: 'emdash' }];
        const chain = {
          leftJoin: () => chain,
          where: () => chain,
          limit: async () => rows,
        };
        return chain;
      },
    }),
  };
}

function deps(marker: TaskTicket | null, pm: PmRow | null): McpToolDependencies {
  return {
    db: fakeDb(pm),
    taskTickets: { get: async () => marker },
  } as unknown as McpToolDependencies;
}

const ticket = (extra: Partial<TicketSummary>) => ({ ...extra }) as TicketSummary;
const transition = {
  projectId: 'p1',
  taskId: 'child',
  conversationId: 'c1',
  status: 'awaiting-input' as const,
};
const livePm = { projectId: 'work', archivedAt: null };

describe('resolveRelayTarget', () => {
  it('uses the marker PM session and writes the message', async () => {
    const target = await resolveRelayTarget(
      deps({ id: '5', pmSessionId: 'pm' }, livePm),
      [],
      transition
    );
    expect(target).toEqual({
      pm: { projectId: 'work', taskId: 'pm' },
      message:
        '[OZdash] Ticket #5 · fix-login (emdash) · Review is now awaiting-input. ' +
        'Run: emdash-oz status child --conversation c1',
    });
  });

  it("finds a linked child by the ticket file's ref and uses its pm_session", async () => {
    const tickets = [ticket({ id: '9', pmSession: 'pm', searchText: 'emdash: child (x)' })];
    const target = await resolveRelayTarget(deps(null, livePm), tickets, transition);
    expect(target?.pm.taskId).toBe('pm');
    expect(target?.message).toContain('Ticket #9');
  });

  it('does not relay the PM session itself, a task without ticket, or to an archived PM', async () => {
    const tickets = [ticket({ id: '9', pmSession: 'child', searchText: 'emdash: child' })];
    expect(await resolveRelayTarget(deps(null, livePm), tickets, transition)).toBeNull();
    expect(await resolveRelayTarget(deps(null, livePm), [], transition)).toBeNull();
    expect(
      await resolveRelayTarget(
        deps({ id: '5', pmSessionId: 'pm' }, { projectId: 'work', archivedAt: '2026-11-01' }),
        [],
        transition
      )
    ).toBeNull();
    expect(
      await resolveRelayTarget(deps({ id: '5', pmSessionId: 'pm' }, null), [], transition)
    ).toBeNull();
  });
});

describe('resolveTicketEvent (file mode)', () => {
  it('needs no live PM session; skips the PM itself and tasks without a ticket', async () => {
    const event = await resolveTicketEvent(
      deps({ id: '5', pmSessionId: 'pm' }, null),
      [],
      transition,
      Date.UTC(2026, 10, 10)
    );
    expect(event).toMatchObject({
      ticket: '5',
      taskId: 'child',
      taskName: 'fix-login',
      projectName: 'emdash',
      conversationTitle: 'Review',
      provider: 'cursor',
      status: 'awaiting-input',
      hint: 'emdash-oz status child --conversation c1',
    });
    const pmItself = [ticket({ id: '9', pmSession: 'child', searchText: 'emdash: child' })];
    expect(await resolveTicketEvent(deps(null, livePm), pmItself, transition, 0)).toBeNull();
    expect(await resolveTicketEvent(deps(null, livePm), [], transition, 0)).toBeNull();
  });
});

describe('appendTicketEvent', () => {
  const event = (ticketId: string) =>
    ticketEvent({
      now: 0,
      ticketId,
      transition,
      taskName: 'fix-login',
      projectName: 'emdash',
      conversationTitle: 'Review',
      provider: 'cursor',
    });

  it('creates the folder and appends one JSON line per event', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ozdash-events-'));
    try {
      const dir = join(root, 'ticket-events');
      await appendTicketEvent(dir, event('5'));
      await appendTicketEvent(dir, { ...event('5'), status: 'completed' });
      const lines = (await readFile(join(dir, '5.jsonl'), 'utf8')).trim().split('\n');
      expect(lines.map((line) => JSON.parse(line).status)).toEqual(['awaiting-input', 'completed']);
      await expect(appendTicketEvent(dir, event('../x'))).rejects.toThrow('unsafe ticket id');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
