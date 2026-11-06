import { describe, expect, it } from 'vitest';
import { parseTicket } from './ticket-parser';

const TICKET = `---
id: 123
title: Add SCIM group sync to token server
status: active            # draft | active | waiting | blocked | done | dropped
priority: 2               # 1 = highest
needs_oleg: yes
next_check: 2026-11-04
pm_session: 0f3c9a12-aaaa
jira: IUM-1234
created: 2026-11-02
updated: "2026-11-03"
---

## Goal
Sync groups.

## Plan
- [x] 1. Write the ADR draft (agent)
- [ ] 2. Get ADR approval from Ann and Raj (people, via Slack)
- [ ] 3. token-server: add group sync endpoint (child: token-server)

## Dependencies
| # | Kind | What | Ref | Owner | Status | Last checked | Next check |
|---|------|------|-----|-------|--------|--------------|------------|
| D1 | slack | ADR approval | https://x/p123 | Ann, Raj | waiting | 2026-11-02 | 2026-11-03 |
| D2 | child | Step 3 in token-server | emdash: 0f3c (sync) | agent | done | 2026-11-02 | |
| D3 | pr | Step 3 PR | https://github.com/x/pull/42 | reviewers | open | | |

## Questions for Oleg
- [ ] 2026-11-02 (from child lima) Should the sync be hourly or on every login?
- [x] 2026-11-01 Which release window? → Answer: Thursday.
- [ ] 2026-11-03 Who owns the rollout?

## Log
- 2026-11-02 10:14: Created child lima for step 3.
`;

describe('parseTicket', () => {
  it('reads the frontmatter, ignoring comments and quotes', () => {
    const result = parseTicket(TICKET, '123-add-scim');
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.ticket).toMatchObject({
      id: '123',
      title: 'Add SCIM group sync to token server',
      status: 'active',
      priority: 2,
      needsOleg: true,
      nextCheck: '2026-11-04',
      pmSession: '0f3c9a12-aaaa',
      updated: '2026-11-03',
      folder: '123-add-scim',
    });
  });

  it('finds the next step, open dependencies and open questions', () => {
    const result = parseTicket(TICKET, '123-add-scim');
    if (!result.success) throw new Error(result.error);
    expect(result.ticket.nextStep).toBe('Get ADR approval from Ann and Raj (people, via Slack)');
    expect(result.ticket.waitingOn).toEqual([
      { what: 'ADR approval', owner: 'Ann, Raj' },
      { what: 'Step 3 PR', owner: 'reviewers' },
    ]);
    expect(result.ticket.openQuestions).toEqual({
      count: 2,
      first: '2026-11-02 (from child lima) Should the sync be hourly or on every login?',
    });
    expect(result.ticket.searchText).toContain('created child lima');
  });

  it('keeps a # in the title and handles CRLF files', () => {
    const crlf = TICKET.replace('title: Add SCIM', 'title: Fix bug #12 in SCIM').replace(
      /\n/g,
      '\r\n'
    );
    const result = parseTicket(crlf, '123-x');
    if (!result.success) throw new Error(result.error);
    expect(result.ticket.title).toBe('Fix bug #12 in SCIM group sync to token server');
    expect(result.ticket.status).toBe('active');
    expect(result.ticket.nextStep).toBe('Get ADR approval from Ann and Raj (people, via Slack)');
  });

  it('uses defaults for empty fields and missing sections', () => {
    const minimal = `---\nid: 7\ntitle: Small\nstatus: draft\npriority:\nneeds_oleg: no\nnext_check:\npm_session:\n---\n`;
    const result = parseTicket(minimal, '7-small');
    if (!result.success) throw new Error(result.error);
    expect(result.ticket).toMatchObject({
      id: '7',
      priority: null,
      needsOleg: false,
      nextCheck: null,
      pmSession: null,
      updated: null,
      nextStep: null,
      waitingOn: [],
      openQuestions: { count: 0, first: null },
    });
  });

  it('takes the id from the folder when the frontmatter has none', () => {
    const result = parseTicket(`---\ntitle: No id\nstatus: waiting\n---\n`, '42-no-id');
    expect(result.success && result.ticket.id).toBe('42');
  });

  it('rejects malformed files', () => {
    expect(parseTicket('# Just a note\n', '1-x')).toEqual({
      success: false,
      error: 'no frontmatter (the file must start with ---)',
    });
    expect(parseTicket('---\nid: 1\nstatus: active\n', '1-x')).toMatchObject({ success: false });
    expect(parseTicket('---\nid: 1\nstatus: someday\n---\n', '1-x')).toEqual({
      success: false,
      error: 'unknown status "someday"',
    });
    expect(parseTicket('---\ntitle: x\nstatus: active\n---\n', 'notes')).toEqual({
      success: false,
      error: 'no id',
    });
  });
});
