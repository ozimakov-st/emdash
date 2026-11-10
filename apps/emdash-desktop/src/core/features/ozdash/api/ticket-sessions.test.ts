import { describe, expect, it } from 'vitest';
import {
  mainProviderId,
  selectTicketSessions,
  sessionSortGroup,
  sessionStatusLabel,
  ticketFileTaskIds,
  type TicketSessionTask,
} from './ticket-sessions';

const task = (taskId: string, extra: Partial<TicketSessionTask> = {}): TicketSessionTask => ({
  taskId,
  projectId: 'p1',
  name: taskId,
  projectName: 'Project',
  archived: false,
  status: null,
  attention: null,
  lastActivity: null,
  providerId: null,
  ...extra,
});

const ticket = (searchText = '') => ({ id: '7', pmSession: 'pm', searchText });
const marked = (...ids: Array<[string, string]>) =>
  new Map(ids.map(([taskId, ticketId]) => [taskId, { ticket: { id: ticketId } }]));
const ids = (rows: TicketSessionTask[]) => rows.map((row) => row.taskId);

describe('ticketFileTaskIds', () => {
  it('reads the task ids of `emdash:` refs in the ticket file', () => {
    const text =
      '| d1 | child | fix | emdash: 4f1c-aa (fix-login) | agent | working |\n' +
      '| d2 | child | docs | emdash:b2 | agent | done |\n| d3 | person | ask | bob |';
    expect([...ticketFileTaskIds({ searchText: text })]).toEqual(['4f1c-aa', 'b2']);
  });
});

describe('selectTicketSessions', () => {
  it('keeps tasks with the ticket marker or named in the file, in any project', () => {
    const tasks = [
      task('a', { projectId: 'p1' }),
      task('b', { projectId: 'p2' }),
      task('c'),
      task('d'),
    ];
    const rows = selectTicketSessions(
      ticket('emdash: b (x)'),
      tasks,
      marked(['a', '7'], ['d', '8'])
    );
    expect(ids(rows).sort()).toEqual(['a', 'b']);
  });

  it('leaves out the PM session and archived tasks', () => {
    const tasks = [task('pm'), task('a', { archived: true }), task('b')];
    const rows = selectTicketSessions(ticket(), tasks, marked(['pm', '7'], ['a', '7'], ['b', '7']));
    expect(ids(rows)).toEqual(['b']);
  });

  it('sorts needs-attention first, then working, then the rest by recent activity', () => {
    const tasks = [
      task('old-idle', { lastActivity: '2026-11-01T00:00:00Z' }),
      task('working', { status: 'working', lastActivity: '2026-11-02T00:00:00Z' }),
      task('new-done', { status: 'completed', lastActivity: '2026-11-09T00:00:00Z' }),
      task('error', { status: 'error', lastActivity: '2026-11-03T00:00:00Z' }),
      task('input', { attention: 'input', lastActivity: '2026-11-05T00:00:00Z' }),
      task('never'),
    ];
    const markers = marked(...tasks.map((row): [string, string] => [row.taskId, '7']));
    expect(ids(selectTicketSessions(ticket(), tasks, markers))).toEqual([
      'input',
      'error',
      'working',
      'new-done',
      'old-idle',
      'never',
    ]);
  });

  it('returns nothing when no task belongs to the ticket', () => {
    expect(selectTicketSessions(ticket(), [task('a')], marked())).toEqual([]);
  });
});

describe('sessionSortGroup', () => {
  it('ranks awaiting input and error first, working second', () => {
    expect(sessionSortGroup({ status: 'awaiting-input', attention: null })).toBe(0);
    expect(sessionSortGroup({ status: null, attention: 'input' })).toBe(0);
    expect(sessionSortGroup({ status: 'working', attention: null })).toBe(1);
    expect(sessionSortGroup({ status: 'completed', attention: 'done' })).toBe(2);
  });
});

describe('mainProviderId', () => {
  it('picks the agent with the most conversations', () => {
    expect(mainProviderId({ codex: 1, claude: 3 })).toBe('claude');
    expect(mainProviderId({})).toBeNull();
  });
});

describe('sessionStatusLabel', () => {
  it('names each status; null is idle', () => {
    expect(sessionStatusLabel('awaiting-input')).toBe('Awaiting input');
    expect(sessionStatusLabel(null)).toBe('Idle');
  });
});
