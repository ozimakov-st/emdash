import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTicketsService, readTickets, resolveVaultPath } from './tickets-service';
import type { GitRunner } from './vault-sync';

const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as never;
const NOW = new Date(2026, 10, 6, 9, 5);

function ticketText(id: string, status: string, pmSession = ''): string {
  return `---\nid: ${id}\ntitle: Ticket ${id}\nstatus: ${status}\npriority: 2\nneeds_oleg: no\nnext_check:\npm_session:${pmSession ? ` ${pmSession}` : ''}\njira:\ncreated: 2026-10-01\nupdated: 2026-10-02\n---\n\n## Log\n- 2026-10-01 10:00: Created.\n`;
}

describe('tickets service', () => {
  let vault: string;
  let gitCalls: string[];
  const run: GitRunner = async (args) => {
    gitCalls.push(args.slice(2).join(' '));
    if (args[2] === 'rev-parse') return { code: 0, stdout: `${join(vault, '..')}\n`, stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  };

  function write(folder: string, content: string) {
    mkdirSync(join(vault, 'tickets', folder), { recursive: true });
    writeFileSync(join(vault, 'tickets', folder, 'ticket.md'), content);
  }
  const read = (folder: string) =>
    readFileSync(join(vault, 'tickets', folder, 'ticket.md'), 'utf8');

  beforeEach(() => {
    vault = join(realpathSync(mkdtempSync(join(tmpdir(), 'ozdash-tickets-'))), 'vault');
    mkdirSync(vault);
    gitCalls = [];
  });

  afterEach(() => {
    rmSync(join(vault, '..'), { recursive: true, force: true });
  });

  /** A service with a fake git runner and a fixed clock; override the rest. */
  function makeService(overrides: Partial<Parameters<typeof createTicketsService>[0]> = {}) {
    return createTicketsService({
      vaultPath: vault,
      logger,
      run,
      now: () => NOW,
      createPmSession: vi.fn(),
      pmSessionExists: vi.fn(async () => false),
      ...overrides,
    });
  }
  /** `ticketText` after a status change on NOW, with these Log lines appended. */
  const changed = (base: string, from: string, to: string, ...log: string[]) =>
    base
      .replace(`status: ${from}\n`, `status: ${to}\n`)
      .replace('updated: 2026-10-02', 'updated: 2026-11-06')
      .concat(log.map((line) => `- 2026-11-06 09:05: ${line}\n`).join(''));

  it('resolves the vault path', () => {
    expect(resolveVaultPath(undefined, '/home/o')).toBe('/home/o/Projects/work/vault');
    expect(resolveVaultPath('~/v', '/home/o')).toBe('/home/o/v');
    expect(resolveVaultPath('/abs/v', '/home/o')).toBe('/abs/v');
  });

  it('lists tickets and skips malformed files with a warning', async () => {
    write('1-a', ticketText('1', 'active'));
    write('2-b', 'not a ticket');
    mkdirSync(join(vault, 'tickets', '3-empty'));
    const list = await readTickets(vault);
    expect(list.tickets.map((t) => t.id)).toEqual(['1']);
    expect(list.warnings).toEqual([
      'tickets/2-b/ticket.md: no frontmatter (the file must start with ---)',
    ]);
    expect(list.error).toBeNull();
    expect((await readTickets(join(vault, 'missing'))).error).toMatch(/^No vault at /);
  });

  it('lists a valid icon.svg with the ticket; an invalid one is left out', async () => {
    const icon =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect x="1" y="1" width="2" height="2" fill="#0f0"/></svg>';
    write('1-a', ticketText('1', 'active'));
    write('2-b', ticketText('2', 'active'));
    write('3-c', ticketText('3', 'active'));
    writeFileSync(join(vault, 'tickets', '1-a', 'icon.svg'), `${icon}\n`);
    writeFileSync(join(vault, 'tickets', '2-b', 'icon.svg'), '<svg><script/></svg>');
    const list = await readTickets(vault);
    expect(list.tickets.map((t) => [t.id, t.icon ?? null])).toEqual([
      ['1', icon],
      ['2', null],
      ['3', null],
    ]);
  });

  it('restores an archived ticket to parked and syncs the vault', async () => {
    write('5-old', ticketText('5', 'done'));
    const service = createTicketsService({
      vaultPath: vault,
      logger,
      run,
      now: () => NOW,
      createPmSession: vi.fn(),
      pmSessionExists: vi.fn(),
    });

    expect(await service.restore('5-old')).toEqual({ success: true });
    expect(read('5-old')).toBe(
      changed(ticketText('5', 'done'), 'done', 'parked', 'Restored to parked in OZdash')
    );
    expect(gitCalls).toEqual([
      'rev-parse --show-toplevel',
      'pull --rebase --autostash',
      'add -- vault',
      'diff --cached --quiet -- vault',
      'pull --rebase --autostash',
      'push',
    ]);
  });

  it('finds a ticket by id and records a linked task in it, then syncs', async () => {
    write('8-x', ticketText('8', 'active', 'pm-8'));
    const service = createTicketsService({
      vaultPath: vault,
      logger,
      run,
      now: () => NOW,
      createPmSession: vi.fn(),
      pmSessionExists: vi.fn(),
    });
    expect((await service.findTicket('8'))?.folder).toBe('8-x');
    expect(await service.findTicket('80')).toBeNull();

    const link = { taskId: 't-1', taskName: 'child', projectName: 'repo', promptLine: 'Do it' };
    expect(await service.linkChildTask('8-x', link)).toEqual({ success: true });
    expect(read('8-x')).toBe(
      ticketText('8', 'active', 'pm-8')
        .replace('updated: 2026-10-02', 'updated: 2026-11-06')
        .replace(
          '\n## Log\n',
          '\n## Dependencies\n' +
            '| # | Kind | What | Ref | Owner | Status | Last checked | Next check |\n' +
            '|---|------|------|-----|-------|--------|--------------|------------|\n' +
            '| D1 | child | child: Do it | emdash: t-1 (child) | agent | working | 2026-11-06 | |\n' +
            '\n## Log\n'
        )
        .concat('- 2026-11-06 09:05: Oleg linked OZdash task child (repo) to this ticket\n')
    );
    expect(gitCalls).toContain('push');
  });

  it('refuses to restore an open ticket or a path outside tickets/', async () => {
    write('6-open', ticketText('6', 'active'));
    const service = createTicketsService({
      vaultPath: vault,
      logger,
      run,
      createPmSession: vi.fn(),
      pmSessionExists: vi.fn(),
    });
    expect(await service.restore('6-open')).toEqual({
      success: false,
      error: 'Ticket #6 is not archived',
    });
    expect(await service.restore('../x')).toMatchObject({ success: false });
    expect(read('6-open')).toBe(ticketText('6', 'active'));
  });

  it('opens the existing PM session', async () => {
    write('7-x', ticketText('7', 'active', 'task-7'));
    const createPmSession = vi.fn();
    const service = createTicketsService({
      vaultPath: vault,
      logger,
      run,
      createPmSession,
      pmSessionExists: async (taskId, projectId) => taskId === 'task-7' && projectId === 'pm',
    });
    expect(await service.openSession('7-x', 'pm')).toEqual({
      success: true,
      projectId: 'pm',
      taskId: 'task-7',
      created: false,
    });
    expect(createPmSession).not.toHaveBeenCalled();
    expect(gitCalls).toEqual([]);
  });

  it('starts a PM session when there is none, and records it in the ticket', async () => {
    write('8-y', ticketText('8', 'active', 'gone-task'));
    const createPmSession = vi.fn(async () => ({ success: true as const, taskId: 'new-task' }));
    const service = createTicketsService({
      vaultPath: vault,
      logger,
      run,
      now: () => NOW,
      createPmSession,
      pmSessionExists: async () => false,
    });

    const [first, second] = await Promise.all([
      service.openSession('8-y', 'pm'),
      service.openSession('8-y', 'pm'),
    ]);

    expect(first).toEqual({ success: true, projectId: 'pm', taskId: 'new-task', created: true });
    expect(second).toEqual(first);
    expect(createPmSession).toHaveBeenCalledTimes(1);
    expect(createPmSession).toHaveBeenCalledWith({
      projectId: 'pm',
      name: 'ticket-8-ticket-8',
      prompt: '/oz-pm 8',
    });
    expect(read('8-y')).toContain('pm_session: new-task\n');
    expect(read('8-y')).toContain('- 2026-11-06 09:05: PM session new-task started in OZdash\n');
    expect(gitCalls).toContain('push');
  });

  it('reports a failed task creation and leaves the ticket alone', async () => {
    write('9-z', ticketText('9', 'parked'));
    const service = createTicketsService({
      vaultPath: vault,
      logger,
      run,
      createPmSession: async () => ({ success: false, error: 'no claude' }),
      pmSessionExists: async () => false,
    });
    expect(await service.openSession('9-z', 'pm')).toEqual({ success: false, error: 'no claude' });
    expect(read('9-z')).toBe(ticketText('9', 'parked'));
  });

  describe('createTicket', () => {
    const template =
      '---\nid:\ntitle:\nstatus: parked\npm_session:\ncreated:\nupdated:\n---\n\n## Goal\n\n## Log\n';
    const writeTemplate = () => {
      mkdirSync(join(vault, 'templates'), { recursive: true });
      writeFileSync(join(vault, 'templates', 'ticket.md'), template);
    };
    const syncCalls = [
      'add -- vault',
      'diff --cached --quiet -- vault',
      'pull --rebase --autostash',
      'push',
    ];

    it('writes the next ticket from the template as parked, with no PM session, and syncs once', async () => {
      writeTemplate();
      write('3-old', ticketText('3', 'active'));
      // The highest id is in the frontmatter, not the folder name.
      write('4-renamed', ticketText('9', 'active'));
      mkdirSync(join(vault, 'tickets', '7-folder-only'));
      const createPmSession = vi.fn();
      const service = makeService({ createPmSession });

      const result = await service.createTicket({
        title: 'Add SCIM sync',
        description: 'Sync groups.',
        projectId: 'pm',
      });

      expect(result).toEqual({
        success: true,
        ticketId: '10',
        folder: '10-add-scim-sync',
        projectId: 'pm',
        taskId: null,
      });
      expect(createPmSession).not.toHaveBeenCalled();
      expect(read('10-add-scim-sync')).toBe(
        '---\nid: 10\ntitle: "Add SCIM sync"\nstatus: parked\npriority: 3\nneeds_oleg: no\n' +
          'next_check:\npm_session:\ncreated: 2026-11-06\nupdated: 2026-11-06\n---\n\n' +
          '## Goal\nSync groups.\n\n## Log\n- 2026-11-06 09:05: Created in OZdash\n'
      );
      expect(gitCalls).toEqual([
        'rev-parse --show-toplevel',
        'pull --rebase --autostash',
        'rev-parse --show-toplevel',
        ...syncCalls,
      ]);
    });

    it('uses an existing task as the PM session (active) and creates no task', async () => {
      const createPmSession = vi.fn();
      const service = createTicketsService({
        vaultPath: vault,
        logger,
        run,
        now: () => NOW,
        createPmSession,
        pmSessionExists: async (taskId, projectId) => taskId === 'task-x' && projectId === 'pm',
      });
      expect(
        await service.createTicket({
          title: 'Elsewhere',
          description: '',
          projectId: 'other',
          existingTask: { id: 'task-x', name: 'old-pm' },
        })
      ).toEqual({ success: false, error: 'The task is not in the PM project' });

      const result = await service.createTicket({
        title: 'From task',
        description: '',
        projectId: 'pm',
        existingTask: { id: 'task-x', name: 'old-pm' },
      });

      expect(result).toMatchObject({ success: true, ticketId: '1', taskId: 'task-x' });
      expect(createPmSession).not.toHaveBeenCalled();
      expect(read('1-from-task')).toContain('pm_session: task-x\n');
      expect(read('1-from-task')).toContain('status: active\n');
      expect(read('1-from-task')).toContain(
        '- 2026-11-06 09:05: Created in OZdash\n' +
          '- 2026-11-06 09:05: Started (PM session old-pm linked in OZdash)\n'
      );
    });

    it('gives two quick creates different ids, and refuses an empty title', async () => {
      const service = createTicketsService({
        vaultPath: vault,
        logger,
        run,
        createPmSession: async () => ({ success: true, taskId: 't' }),
        pmSessionExists: vi.fn(),
      });
      const [a, b] = await Promise.all([
        service.createTicket({ title: 'Same', description: '', projectId: 'pm' }),
        service.createTicket({ title: 'Same', description: '', projectId: 'pm' }),
      ]);
      expect(
        [a, b].map((r) => (r.success ? r.folder : '')).sort((x, y) => x.localeCompare(y))
      ).toEqual(['1-same', '2-same']);
      expect(await service.createTicket({ title: '  ', description: '', projectId: 'pm' })).toEqual(
        { success: false, error: 'The title is empty' }
      );
    });
  });

  describe('linkPmSession', () => {
    const input = { folder: '4-x', projectId: 'pm', taskId: 'task-new', taskName: 'pm-new' };

    it('links a ticket with a stale pm_session, in place, then syncs', async () => {
      write('4-x', ticketText('4', 'active', 'gone'));
      const service = createTicketsService({
        vaultPath: vault,
        logger,
        run,
        now: () => NOW,
        createPmSession: vi.fn(),
        pmSessionExists: async (taskId) => taskId === 'task-new',
      });
      expect(await service.linkPmSession(input)).toEqual({ success: true });
      expect(read('4-x')).toBe(
        ticketText('4', 'active', 'task-new')
          .replace('updated: 2026-10-02', 'updated: 2026-11-06')
          .concat('- 2026-11-06 09:05: PM session pm-new linked in OZdash\n')
      );
      expect(gitCalls).toContain('push');
    });

    it('starts a parked ticket when it gets a PM session', async () => {
      write('4-x', ticketText('4', 'parked'));
      const service = makeService({ pmSessionExists: async (taskId) => taskId === 'task-new' });
      expect(await service.linkPmSession(input)).toEqual({ success: true });
      expect(read('4-x')).toBe(
        changed(
          ticketText('4', 'parked', 'task-new'),
          'parked',
          'active',
          'PM session pm-new linked in OZdash',
          'Started (PM session pm-new linked in OZdash)'
        )
      );
    });

    it('refuses a ticket whose PM session is live, and a task outside the PM project', async () => {
      write('4-x', ticketText('4', 'active', 'live'));
      const service = createTicketsService({
        vaultPath: vault,
        logger,
        run,
        createPmSession: vi.fn(),
        pmSessionExists: async (taskId) => taskId === 'live' || taskId === 'task-new',
      });
      expect(await service.linkPmSession(input)).toEqual({
        success: false,
        error: 'Ticket #4 already has a PM session (live)',
      });
      expect(await service.linkPmSession({ ...input, taskId: 'other' })).toEqual({
        success: false,
        error: 'The task is not in the PM project',
      });
      expect(read('4-x')).toBe(ticketText('4', 'active', 'live'));
      expect(gitCalls).toEqual([]);
    });
  });

  describe('lifecycle', () => {
    const syncCalls = [
      'rev-parse --show-toplevel',
      'pull --rebase --autostash',
      'add -- vault',
      'diff --cached --quiet -- vault',
      'pull --rebase --autostash',
      'push',
    ];
    const BOARD = 'Started (PM session opened from the OZdash board)';

    it('Start on a parked ticket with no PM session creates one and sets it active', async () => {
      write('3-p', ticketText('3', 'parked'));
      const createPmSession = vi.fn(async () => ({ success: true as const, taskId: 'pm-3' }));
      const service = makeService({ createPmSession });
      expect(await service.openSession('3-p', 'pm')).toEqual({
        success: true,
        projectId: 'pm',
        taskId: 'pm-3',
        created: true,
      });
      expect(createPmSession).toHaveBeenCalledWith({
        projectId: 'pm',
        name: 'ticket-3-ticket-3',
        prompt: '/oz-pm 3',
      });
      expect(read('3-p')).toBe(
        changed(
          ticketText('3', 'parked', 'pm-3'),
          'parked',
          'active',
          'PM session pm-3 started in OZdash',
          BOARD
        )
      );
      expect(gitCalls).toEqual(syncCalls);
    });

    it('treats a pm_session that points to an archived or deleted task as missing', async () => {
      // The PM session closed itself: ticket parked, its task archived (not live).
      write('4-p', ticketText('4', 'parked', 'archived-task'));
      const createPmSession = vi.fn(async () => ({ success: true as const, taskId: 'pm-new' }));
      const pmSessionExists = vi.fn(async () => false);
      const service = makeService({ createPmSession, pmSessionExists });

      expect(await service.openSession('4-p', 'pm')).toMatchObject({
        success: true,
        taskId: 'pm-new',
        created: true,
      });
      expect(pmSessionExists).toHaveBeenCalledWith('archived-task', 'pm');
      expect(createPmSession).toHaveBeenCalledWith({
        projectId: 'pm',
        name: 'ticket-4-ticket-4',
        prompt: '/oz-pm 4',
      });
      expect(read('4-p')).toBe(
        changed(
          ticketText('4', 'parked', 'pm-new'),
          'parked',
          'active',
          'PM session pm-new started in OZdash',
          BOARD
        )
      );
    });

    it('opening a live PM session starts a parked ticket, but no other status', async () => {
      write('5-p', ticketText('5', 'parked', 'live'));
      write('6-w', ticketText('6', 'waiting', 'live'));
      write('7-b', ticketText('7', 'blocked', 'live'));
      const createPmSession = vi.fn();
      const service = makeService({ createPmSession, pmSessionExists: async () => true });

      expect(await service.openSession('6-w', 'pm')).toMatchObject({
        taskId: 'live',
        created: false,
      });
      expect(await service.openSession('7-b', 'pm')).toMatchObject({
        taskId: 'live',
        created: false,
      });
      expect(gitCalls).toEqual([]);
      expect(read('6-w')).toBe(ticketText('6', 'waiting', 'live'));
      expect(read('7-b')).toBe(ticketText('7', 'blocked', 'live'));

      expect(await service.openSession('5-p', 'pm')).toEqual({
        success: true,
        projectId: 'pm',
        taskId: 'live',
        created: false,
      });
      expect(read('5-p')).toBe(
        changed(ticketText('5', 'parked', 'live'), 'parked', 'active', BOARD)
      );
      expect(gitCalls).toEqual(syncCalls);
      expect(createPmSession).not.toHaveBeenCalled();
    });

    it('a child task starts a parked ticket only; waiting and blocked stay', async () => {
      write('8-p', ticketText('8', 'parked', 'pm-8'));
      write('9-w', ticketText('9', 'waiting', 'pm-9'));
      write('10-b', ticketText('10', 'blocked', 'pm-10'));
      const service = makeService();
      const link = { taskId: 't-1', taskName: 'child', projectName: 'repo', promptLine: '' };

      for (const folder of ['8-p', '9-w', '10-b'])
        expect(await service.linkChildTask(folder, link)).toEqual({ success: true });

      expect(read('8-p')).toContain('status: active\n');
      expect(read('8-p')).toMatch(
        /Oleg linked OZdash task child \(repo\) to this ticket\n- 2026-11-06 09:05: Started \(child task child created in OZdash\)\n$/
      );
      for (const [folder, status] of [
        ['9-w', 'waiting'],
        ['10-b', 'blocked'],
      ] as const) {
        expect(read(folder)).toContain(`status: ${status}\n`);
        expect(read(folder)).not.toContain('Started (');
        expect(read(folder)).toContain('| D1 | child | child |');
      }
    });

    it('MCP create_task: startTicket sets a parked (or legacy draft) ticket active', async () => {
      write('11-p', ticketText('11', 'parked', 'pm'));
      write('12-d', ticketText('12', 'draft', 'pm'));
      const service = makeService();
      const reason = 'child task x created via MCP create_task';

      expect(await service.startTicket('11', reason)).toEqual({ success: true });
      expect(await service.startTicket('12', reason)).toEqual({ success: true });
      expect(read('11-p')).toBe(
        changed(ticketText('11', 'parked', 'pm'), 'parked', 'active', `Started (${reason})`)
      );
      expect(read('12-d')).toBe(
        changed(ticketText('12', 'draft', 'pm'), 'draft', 'active', `Started (${reason})`)
      );
      expect(await service.startTicket('99', reason)).toEqual({
        success: false,
        error: 'Ticket #99 was not found in the vault',
      });
    });

    it('startTicket leaves active, waiting and blocked tickets alone (no git)', async () => {
      write('13-a', ticketText('13', 'active'));
      write('14-w', ticketText('14', 'waiting'));
      write('15-b', ticketText('15', 'blocked'));
      const service = makeService();
      for (const id of ['13', '14', '15'])
        expect(await service.startTicket(id, 'x')).toEqual({ success: true });
      expect(read('13-a')).toBe(ticketText('13', 'active'));
      expect(read('14-w')).toBe(ticketText('14', 'waiting'));
      expect(read('15-b')).toBe(ticketText('15', 'blocked'));
      expect(gitCalls).toEqual([]);
    });

    it('archives a parked ticket as dropped; refuses other statuses', async () => {
      write('16-p', ticketText('16', 'parked'));
      write('17-a', ticketText('17', 'active'));
      const service = makeService();

      expect(await service.archive('16-p')).toEqual({ success: true });
      expect(read('16-p')).toBe(
        changed(ticketText('16', 'parked'), 'parked', 'dropped', 'Archived from parked in OZdash')
      );
      expect(gitCalls).toEqual(syncCalls);

      expect(await service.archive('17-a')).toEqual({
        success: false,
        error: 'Ticket #17 is not parked',
      });
      expect(read('17-a')).toBe(ticketText('17', 'active'));
      expect(await service.archive('../x')).toMatchObject({ success: false });
    });

    it('archive then restore goes parked -> dropped -> parked', async () => {
      write('18-p', ticketText('18', 'parked'));
      const service = makeService();
      await service.archive('18-p');
      expect(await service.restore('18-p')).toEqual({ success: true });
      expect(read('18-p')).toContain('status: parked\n');
      expect(read('18-p')).toMatch(
        /Archived from parked in OZdash\n- 2026-11-06 09:05: Restored to parked in OZdash\n$/
      );
    });
  });

  describe('priority, order and park', () => {
    const syncCalls = [
      'rev-parse --show-toplevel',
      'pull --rebase --autostash',
      'add -- vault',
      'diff --cached --quiet -- vault',
      'pull --rebase --autostash',
      'push',
    ];
    /** A ticket with this priority (and rank, when given). */
    const withPriority = (id: string, priority: number, rank?: number) =>
      ticketText(id, 'active').replace(
        'priority: 2\n',
        `priority: ${priority}\n${rank === undefined ? '' : `rank: ${rank}\n`}`
      );

    it('writes the priority in place with a Log line, then syncs once', async () => {
      write('20-a', ticketText('20', 'active'));
      const service = makeService();
      expect(await service.setPriority('20-a', 1)).toEqual({ success: true });
      expect(read('20-a')).toBe(
        ticketText('20', 'active')
          .replace('priority: 2\n', 'priority: 1\n')
          .replace('updated: 2026-10-02', 'updated: 2026-11-06')
          .concat('- 2026-11-06 09:05: Priority set to P1 in OZdash\n')
      );
      expect(gitCalls).toEqual(syncCalls);
    });

    it('refuses priorities outside 1-4 and does not write the same value', async () => {
      write('21-a', ticketText('21', 'active'));
      const service = makeService();
      expect(await service.setPriority('21-a', 0)).toEqual({
        success: false,
        error: 'Priority must be 1-4',
      });
      expect(await service.setPriority('21-a', 5)).toMatchObject({ success: false });
      expect(await service.setPriority('21-a', 2.5)).toMatchObject({ success: false });
      expect(gitCalls).toEqual([]);
      expect(await service.setPriority('21-a', 2)).toEqual({ success: true });
      expect(read('21-a')).toBe(ticketText('21', 'active'));
      expect(gitCalls).not.toContain('push');
    });

    it('rewrites the ranks of one priority group only, in one sync', async () => {
      write('30-a', withPriority('30', 2, 10));
      write('31-b', withPriority('31', 2));
      write('32-c', withPriority('32', 2, 20));
      write('33-other', withPriority('33', 1, 10));
      const service = makeService();

      expect(await service.reorder(['31-b', '30-a', '32-c'])).toEqual({ success: true });
      expect(read('31-b')).toBe(withPriority('31', 2, 10));
      expect(read('30-a')).toBe(withPriority('30', 2, 20));
      expect(read('32-c')).toBe(withPriority('32', 2, 30));
      expect(read('33-other')).toBe(withPriority('33', 1, 10));
      expect(gitCalls).toEqual(syncCalls);
      const list = await readTickets(vault);
      expect(list.tickets.map((t) => [t.id, t.rank])).toEqual([
        ['30', 20],
        ['31', 10],
        ['32', 30],
        ['33', 10],
      ]);
    });

    it('refuses an order that mixes priorities and writes nothing', async () => {
      write('40-a', withPriority('40', 2));
      write('41-b', withPriority('41', 1));
      const service = makeService();
      expect(await service.reorder(['40-a', '41-b'])).toEqual({
        success: false,
        error: 'Tickets of different priorities cannot be reordered',
      });
      expect(await service.reorder(['40-a', '40-a'])).toMatchObject({ success: false });
      expect(await service.reorder(['40-a', '../x'])).toMatchObject({ success: false });
      expect(read('40-a')).toBe(withPriority('40', 2));
      expect(gitCalls).not.toContain('push');
    });

    it('parks a working ticket; refuses parked and archived ones', async () => {
      write('50-w', ticketText('50', 'waiting'));
      write('51-p', ticketText('51', 'parked'));
      write('52-d', ticketText('52', 'done'));
      const service = makeService();
      expect(await service.park('50-w')).toEqual({ success: true });
      expect(read('50-w')).toBe(
        changed(ticketText('50', 'waiting'), 'waiting', 'parked', 'Parked in OZdash')
      );
      expect(gitCalls).toEqual(syncCalls);
      expect(await service.park('51-p')).toEqual({
        success: false,
        error: 'Ticket #51 is already parked',
      });
      expect(await service.park('52-d')).toMatchObject({ success: false });
      expect(read('52-d')).toBe(ticketText('52', 'done'));
    });
  });
});
