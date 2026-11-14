import { openFixture } from '@tooling/utils/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { McpToolDependencies } from '@core/features/mcp/node/server/dependencies';
import {
  createTaskTicketStore,
  type TaskTicketStore,
} from '@core/features/mcp/node/server/ozdash-task-ticket-store';
import {
  clearRecoveryResults,
  getSessionHealth,
  recordRecoveryResult,
} from '@core/features/mcp/node/server/session-health';
import { tasks } from '@core/services/app-db/node/schema';
import { collectRecoveryCandidates } from './ozdash-session-recovery';

const NOW = Date.parse('2026-11-13T18:24:00Z');
const logger = { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} };
const withQueue = JSON.stringify({
  version: '1',
  type: 'acp',
  options: {},
  initialQueue: [{ text: 'Review the PR' }],
});
const noQueue = JSON.stringify({ version: '1', type: 'acp', options: {} });

describe('session recovery (db)', () => {
  let fixture: Awaited<ReturnType<typeof openFixture>>;
  let tickets: TaskTicketStore;
  let mcp: McpToolDependencies;

  beforeEach(async () => {
    fixture = await openFixture('empty');
    tickets = createTaskTicketStore(fixture.db, logger as never);
    mcp = { db: fixture.db, taskTickets: tickets } as unknown as McpToolDependencies;
    fixture.sqlite.prepare(`INSERT INTO projects (id, name) VALUES ('work', 'work')`).run();
    fixture.sqlite.prepare(`INSERT INTO projects (id, name) VALUES ('app', 'app')`).run();
    await fixture.db.insert(tasks).values([
      { id: 'pm-1', projectId: 'work', name: 'ticket-8', status: 'in_progress' },
      { id: 'child-1', projectId: 'app', name: 'iac', status: 'in_progress' },
      { id: 'child-2', projectId: 'app', name: 'k8s', status: 'in_progress' },
      {
        id: 'old',
        projectId: 'app',
        name: 'archived',
        status: 'in_progress',
        archivedAt: '2026-11-01T00:00:00Z',
      },
    ]);
    await tickets.set('pm-1', { id: '8', pmSessionId: 'pm-1' });
    await tickets.set('child-1', { id: '8', pmSessionId: 'pm-1' });
    await tickets.set('child-2', { id: '8', pmSessionId: 'pm-1' });
    clearRecoveryResults();
  });

  afterEach(() => fixture.close());

  function seed(
    id: string,
    taskId: string,
    options: {
      sid?: string | null;
      config?: string;
      createdAt?: string;
      status?: string;
      type?: 'acp' | 'pty';
    } = {}
  ): void {
    fixture.sqlite
      .prepare(
        `INSERT INTO conversations
          (id, project_id, task_id, title, provider, type, location, provider_session_id,
           config, created_at, agent_status)
         VALUES (?, (SELECT project_id FROM tasks WHERE id = ?), ?, ?, 'claude', ?, 'local',
                 ?, ?, ?, ?)`
      )
      .run(
        id,
        taskId,
        taskId,
        id,
        options.type ?? 'acp',
        options.sid === undefined ? 'session-1' : options.sid,
        options.config ?? noQueue,
        options.createdAt ?? '2026-11-13 18:00:00',
        options.status ?? 'idle'
      );
  }

  it('picks interrupted sessions and recent never-started ones in open tasks', async () => {
    seed('c-int', 'child-1');
    seed('c-pm', 'pm-1');
    seed('c-new', 'child-2', { sid: null, config: withQueue });
    seed('c-too-old', 'child-2', {
      sid: null,
      config: withQueue,
      createdAt: '2026-11-08 10:00:00',
    });
    seed('c-no-prompt', 'child-2', { sid: null, config: noQueue });
    seed('c-archived', 'old');
    seed('c-done', 'child-1', { status: 'completed' });

    const found = await collectRecoveryCandidates(mcp, [], ['c-int', 'c-pm', 'c-archived'], NOW);
    const byId = Object.fromEntries(found.map((c) => [c.conversationId, c]));

    expect(Object.keys(byId).sort()).toEqual(['c-int', 'c-new', 'c-pm']);
    expect(byId['c-int']).toMatchObject({ kind: 'interrupted', ticketId: '8', isPm: false });
    expect(byId['c-pm']).toMatchObject({ kind: 'interrupted', ticketId: '8', isPm: true });
    expect(byId['c-new']).toMatchObject({ kind: 'never-started', taskName: 'k8s' });
  });

  it('reports each session state, never-started first, with the last recovery result', async () => {
    seed('c-err', 'child-1', { status: 'error' });
    seed('c-new', 'child-2', { sid: null, config: withQueue });
    seed('c-work', 'child-1', { status: 'working' });
    seed('c-archived', 'old', { status: 'error' });
    recordRecoveryResult({
      kind: 'interrupted',
      projectId: 'app',
      taskId: 'child-1',
      taskName: 'iac',
      conversationId: 'c-work',
      title: 'c-work',
      provider: 'claude',
      type: 'acp',
      ticketId: '8',
      isPm: false,
      at: '2026-11-13T18:24:20.000Z',
      outcome: { status: 'continued' },
    });

    const health = await getSessionHealth(mcp, {});
    expect(health.success).toBe(true);
    if (!health.success) return;
    expect(health.data.sessions.map((s) => [s.conversationId, s.state])).toEqual([
      ['c-err', 'error'],
      ['c-new', 'never-started'],
      ['c-work', 'working'],
    ]);
    expect(health.data.summary).toEqual({ error: 1, 'never-started': 1, working: 1 });
    expect(health.data.sessions[2]!.recovery).toEqual({
      at: '2026-11-13T18:24:20.000Z',
      status: 'continued',
    });

    const filtered = await getSessionHealth(mcp, { taskId: 'child-2' });
    expect(filtered.success && filtered.data.sessions.map((s) => s.conversationId)).toEqual([
      'c-new',
    ]);
  });
});
