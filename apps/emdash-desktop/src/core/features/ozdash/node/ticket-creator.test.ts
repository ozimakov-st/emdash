import { describe, expect, it } from 'vitest';
import {
  addSectionText,
  cleanTitle,
  DEFAULT_TICKET_TEMPLATE,
  linkPmSessionContent,
  newTicketContent,
  nextTicketId,
  quoteYamlString,
  ticketFolderName,
} from './ticket-creator';
import { parseTicket } from './ticket-parser';

const NOW = new Date(2026, 10, 6, 9, 5);

describe('nextTicketId', () => {
  it('is 1 for an empty vault', () => {
    expect(nextTicketId([])).toBe(1);
  });

  it('is the highest folder number + 1, ignoring other folders', () => {
    expect(nextTicketId(['1-a', '12-b', '3-c', 'notes', 'x-12', '7'])).toBe(13);
  });

  it('also counts ticket ids', () => {
    expect(nextTicketId(['2-a'], ['40'])).toBe(41);
  });
});

describe('ticketFolderName and titles', () => {
  it('uses <id>-<slug> with a lowercase slug of at most 40 chars', () => {
    expect(ticketFolderName(12, 'Add SCIM group sync!')).toBe('12-add-scim-group-sync');
    const long = ticketFolderName(3, 'A very long title that goes on and on and on forever');
    expect(long.slice(2).length).toBeLessThanOrEqual(40);
    expect(long).toMatch(/^3-[a-z0-9-]+[a-z0-9]$/);
  });

  it('falls back to "ticket" when the title has no slug letters', () => {
    expect(ticketFolderName(4, '???')).toBe('4-ticket');
  });

  it('cleans and quotes the title', () => {
    expect(cleanTitle('  two\nlines  ')).toBe('two lines');
    expect(quoteYamlString('Fix "login" in C:\\x')).toBe('"Fix \\"login\\" in C:\\\\x"');
  });
});

describe('newTicketContent', () => {
  const input = {
    id: 5,
    title: 'Fix "login": #1 bug',
    description: 'First line\nSecond line',
    pmSession: 'task-5',
    now: NOW,
  };

  it('fills the vault template: frontmatter, Goal, and one Log line', () => {
    const result = newTicketContent(DEFAULT_TICKET_TEMPLATE, input);
    expect(result).toEqual({
      success: true,
      content: [
        '---',
        'id: 5',
        'title: "Fix \\"login\\": #1 bug"',
        'status: draft',
        'priority: 3',
        'needs_oleg: no',
        'next_check:',
        'pm_session: task-5',
        'jira:',
        'created: 2026-11-06',
        'updated: 2026-11-06',
        '---',
        '',
        '## Goal',
        'First line',
        'Second line',
        '',
        '## Requirements',
        '',
        '## Plan',
        '',
        '## Dependencies',
        '| # | Kind | What | Ref | Owner | Status | Last checked | Next check |',
        '|---|------|------|-----|-------|--------|--------------|------------|',
        '',
        '## People',
        '',
        '## Questions for Oleg',
        '',
        '## Decisions',
        '',
        '## Log',
        '- 2026-11-06 09:05: Created in OZdash',
        '',
      ].join('\n'),
    });
  });

  it('round-trips through the parser (title with quotes, #, and backslash)', () => {
    const result = newTicketContent(null, { ...input, title: 'Say "hi" #2 \\o/' });
    if (!result.success) throw new Error(result.error);
    const parsed = parseTicket(result.content, '5-say-hi-2-o');
    if (!parsed.success) throw new Error(parsed.error);
    expect(parsed.ticket).toMatchObject({
      id: '5',
      title: 'Say "hi" #2 \\o/',
      status: 'draft',
      priority: 3,
      needsOleg: false,
      nextCheck: null,
      pmSession: 'task-5',
      updated: '2026-11-06',
      goal: 'First line\nSecond line',
    });
  });

  it('uses a custom template and keeps its other text', () => {
    const template = '---\nid:\ntitle:\nstatus: active\nowner: oleg\n---\n\n## Goal\n\n## Log\n';
    const result = newTicketContent(template, { ...input, description: '', pmSession: '' });
    expect(result).toEqual({
      success: true,
      content:
        '---\nid: 5\ntitle: "Fix \\"login\\": #1 bug"\nstatus: draft\npriority: 3\n' +
        'needs_oleg: no\nnext_check:\npm_session:\ncreated: 2026-11-06\nupdated: 2026-11-06\n' +
        'owner: oleg\n---\n\n## Goal\n\n## Log\n- 2026-11-06 09:05: Created in OZdash\n',
    });
  });

  it('adds a Goal section when the template has none', () => {
    expect(addSectionText('---\nid: 1\n---\n\n## Log\n', 'Goal', 'Do it')).toEqual({
      success: true,
      content: '---\nid: 1\n---\n\n## Goal\nDo it\n\n## Log\n',
    });
  });
});

describe('linkPmSessionContent', () => {
  it('edits in place: pm_session, updated, one Log line; other bytes unchanged', () => {
    const before =
      '---\r\nid: 9\r\ntitle: "X"\r\nstatus: active  # keep\r\npm_session: old-task # was\r\n' +
      'updated: 2026-10-01\r\n---\r\n\r\n## Notes\r\nfree text  \r\n\r\n## Log\r\n' +
      '- 2026-10-01 10:00: Created.\r\n\r\n## After\r\nmore\r\n';
    expect(linkPmSessionContent(before, 'task-9', 'pm-task-9', NOW)).toEqual({
      success: true,
      content: before
        .replace('pm_session: old-task # was', 'pm_session: task-9 # was')
        .replace('updated: 2026-10-01', 'updated: 2026-11-06')
        .replace(
          '- 2026-10-01 10:00: Created.\r\n',
          '- 2026-10-01 10:00: Created.\r\n- 2026-11-06 09:05: PM session pm-task-9 linked in OZdash\r\n'
        ),
    });
  });

  it('adds a missing pm_session key in vault order', () => {
    const before = '---\nid: 9\nnext_check:\njira:\nupdated: 2026-10-01\n---\n\n## Log\n';
    const result = linkPmSessionContent(before, 't', 'name', NOW);
    expect(result.success && result.content).toBe(
      '---\nid: 9\nnext_check:\npm_session: t\njira:\nupdated: 2026-11-06\n---\n\n## Log\n' +
        '- 2026-11-06 09:05: PM session name linked in OZdash\n'
    );
  });
});
