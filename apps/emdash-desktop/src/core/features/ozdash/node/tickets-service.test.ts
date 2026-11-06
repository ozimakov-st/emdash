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

  it('restores an archived ticket and syncs the vault', async () => {
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
      ticketText('5', 'active')
        .replace('updated: 2026-10-02', 'updated: 2026-11-06')
        .concat('- 2026-11-06 09:05: Restored from archive in OZdash\n')
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
    write('9-z', ticketText('9', 'draft'));
    const service = createTicketsService({
      vaultPath: vault,
      logger,
      run,
      createPmSession: async () => ({ success: false, error: 'no claude' }),
      pmSessionExists: async () => false,
    });
    expect(await service.openSession('9-z', 'pm')).toEqual({ success: false, error: 'no claude' });
    expect(read('9-z')).toBe(ticketText('9', 'draft'));
  });
});
