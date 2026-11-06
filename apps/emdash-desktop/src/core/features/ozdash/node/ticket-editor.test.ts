import { describe, expect, it } from 'vitest';
import {
  appendLogLine,
  restoreTicketContent,
  setFrontmatterValue,
  setPmSessionContent,
} from './ticket-editor';

const NOW = new Date(2026, 10, 6, 9, 5); // 2026-11-06 09:05 local time

const TICKET = `---
id: 12
title: Old work
status: done              # draft | active | waiting | blocked | done | dropped
priority: 3
needs_oleg: no
next_check:
pm_session:
jira:
created: 2026-10-01
updated: 2026-10-20
---

## Goal
Something.

## Log
- 2026-10-01 10:00: Created.
- 2026-10-20 18:00: Done.

## Notes
Keep me.
`;

/** The lines that differ between two texts, as [before, after] pairs by line number. */
function changedLines(before: string, after: string): Array<[string | undefined, string]> {
  const a = before.split('\n');
  const b = after.split('\n');
  return b.flatMap((line, index) => (a[index] === line ? [] : [[a[index], line]]));
}

describe('setFrontmatterValue', () => {
  it('changes only the value and keeps spacing and the comment', () => {
    const result = setFrontmatterValue(TICKET, 'status', 'active');
    if (!result.success) throw new Error(result.error);
    expect(changedLines(TICKET, result.content)).toEqual([
      [
        'status: done              # draft | active | waiting | blocked | done | dropped',
        'status: active              # draft | active | waiting | blocked | done | dropped',
      ],
    ]);
  });

  it('fills an empty value', () => {
    const result = setFrontmatterValue(TICKET, 'pm_session', 'task-1');
    if (!result.success) throw new Error(result.error);
    expect(changedLines(TICKET, result.content)).toEqual([['pm_session:', 'pm_session: task-1']]);
  });

  it('adds a missing key after the key before it in the vault order', () => {
    const old = TICKET.replace('pm_session:\n', 'manager:\n');
    const result = setFrontmatterValue(old, 'pm_session', 'task-1');
    if (!result.success) throw new Error(result.error);
    expect(result.content).toContain('next_check:\npm_session: task-1\nmanager:\n');
  });

  it('keeps CRLF line endings and a missing final newline', () => {
    const crlf = TICKET.replace(/\n/g, '\r\n').replace(/\r\n$/, '');
    const result = setFrontmatterValue(crlf, 'updated', '2026-11-06');
    if (!result.success) throw new Error(result.error);
    expect(result.content).toBe(crlf.replace('updated: 2026-10-20', 'updated: 2026-11-06'));
  });

  it('fails without frontmatter', () => {
    expect(setFrontmatterValue('# note\n', 'status', 'active')).toEqual({
      success: false,
      error: 'the ticket has no frontmatter',
    });
  });
});

describe('appendLogLine', () => {
  it('appends after the last Log line, before the next section', () => {
    const result = appendLogLine(TICKET, '- 2026-11-06 09:05: Hi');
    if (!result.success) throw new Error(result.error);
    expect(result.content).toBe(
      TICKET.replace(
        '- 2026-10-20 18:00: Done.\n',
        '- 2026-10-20 18:00: Done.\n- 2026-11-06 09:05: Hi\n'
      )
    );
  });

  it('appends at the end when Log is the last section without a final newline', () => {
    const text = '---\nid: 1\n---\n\n## Log\n- a';
    const result = appendLogLine(text, '- b');
    expect(result).toEqual({ success: true, content: '---\nid: 1\n---\n\n## Log\n- a\n- b' });
  });

  it('adds a Log section when there is none', () => {
    const result = appendLogLine('---\nid: 1\n---\n\n## Goal\nx\n', '- b');
    expect(result).toEqual({
      success: true,
      content: '---\nid: 1\n---\n\n## Goal\nx\n\n## Log\n- b\n',
    });
  });
});

describe('ticket edits', () => {
  it('restores: status, updated and one Log line; nothing else changes', () => {
    const result = restoreTicketContent(TICKET, NOW);
    if (!result.success) throw new Error(result.error);
    const expected = TICKET.replace('status: done  ', 'status: active  ')
      .replace('updated: 2026-10-20', 'updated: 2026-11-06')
      .replace(
        '- 2026-10-20 18:00: Done.\n',
        '- 2026-10-20 18:00: Done.\n- 2026-11-06 09:05: Restored from archive in OZdash\n'
      );
    expect(result.content).toBe(expected);
  });

  it('sets the PM session', () => {
    const result = setPmSessionContent(TICKET, 'task-9', NOW);
    if (!result.success) throw new Error(result.error);
    const expected = TICKET.replace('pm_session:\n', 'pm_session: task-9\n')
      .replace('updated: 2026-10-20', 'updated: 2026-11-06')
      .replace(
        '- 2026-10-20 18:00: Done.\n',
        '- 2026-10-20 18:00: Done.\n- 2026-11-06 09:05: PM session task-9 started in OZdash\n'
      );
    expect(result.content).toBe(expected);
  });
});
