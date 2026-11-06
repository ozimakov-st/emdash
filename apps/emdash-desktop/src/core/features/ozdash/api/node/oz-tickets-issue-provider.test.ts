import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createOzTicketsIssueProvider } from './oz-tickets-issue-provider';

function ticketText(id: string, status: string, priority: string, title = `Ticket ${id}`) {
  return `---\nid: ${id}\ntitle: ${title}\nstatus: ${status}\npriority: ${priority}\nneeds_oleg: no\nnext_check:\npm_session:\njira:\ncreated: 2026-10-01\nupdated: 2026-10-02\n---\n\n## Goal\nGoal of ${id}.\n\n## Plan\n- [ ] 1. First step of ${id} (agent)\n`;
}

describe('OZ Tickets issue provider', () => {
  let vault: string;

  function write(folder: string, content: string) {
    mkdirSync(join(vault, 'tickets', folder), { recursive: true });
    writeFileSync(join(vault, 'tickets', folder, 'ticket.md'), content);
  }

  beforeEach(() => {
    vault = mkdtempSync(join(tmpdir(), 'oz-tickets-provider-'));
    write('1-low', ticketText('1', 'active', '3'));
    write('2-done', ticketText('2', 'done', '1', 'Old SCIM work'));
    write('3-top', ticketText('3', 'waiting', '1', 'SCIM group sync'));
    write('4-none', ticketText('4', 'draft', ''));
    write('10-top', ticketText('10', 'blocked', '1'));
  });
  afterEach(() => rmSync(vault, { recursive: true, force: true }));

  it('is always connected and supports issue context', async () => {
    const provider = createOzTicketsIssueProvider({ vaultPath: vault });
    expect(provider.type).toBe('oz-tickets');
    await expect(provider.checkConnection()).resolves.toMatchObject({
      connected: true,
      capabilities: { requiresRepositoryUrl: false, supportsIssueContext: true },
    });
  });

  it('lists open tickets by priority, then id', async () => {
    const provider = createOzTicketsIssueProvider({ vaultPath: vault });
    const result = await provider.listIssues({});
    if (!result.success) throw new Error(result.error.message);
    expect(result.data.map((issue) => issue.identifier)).toEqual(['#3', '#10', '#1', '#4']);
    expect(result.data[0]).toMatchObject({
      provider: 'oz-tickets',
      title: 'SCIM group sync',
      url: `file://${join(vault, 'tickets', '3-top', 'ticket.md')}`,
      description: 'Goal of 3.\n\nNext step: First step of 3 (agent)',
      status: 'waiting',
    });
  });

  it('respects the limit', async () => {
    const provider = createOzTicketsIssueProvider({ vaultPath: vault });
    const result = await provider.listIssues({ limit: 2 });
    expect(result.success && result.data.map((issue) => issue.identifier)).toEqual(['#3', '#10']);
  });

  it('searches archived tickets too, open ones first', async () => {
    const provider = createOzTicketsIssueProvider({ vaultPath: vault });
    const result = await provider.searchIssues({ searchTerm: 'scim' });
    expect(result.success && result.data.map((issue) => issue.identifier)).toEqual(['#3', '#2']);
    const byId = await provider.searchIssues({ searchTerm: '#10' });
    expect(byId.success && byId.data.map((issue) => issue.identifier)).toEqual(['#10']);
    await expect(provider.searchIssues({ searchTerm: '  ' })).resolves.toEqual({
      success: true,
      data: [],
    });
  });

  it('gets one ticket by its identifier', async () => {
    const provider = createOzTicketsIssueProvider({ vaultPath: vault });
    const found = await provider.getIssueContext!({ identifier: '#2' });
    expect(found.success && found.data.title).toBe('Old SCIM work');
    const missing = await provider.getIssueContext!({ identifier: '#99' });
    expect(missing).toMatchObject({ success: false, error: { type: 'not_found_or_no_access' } });
  });

  it('reports a missing vault as an error', async () => {
    const provider = createOzTicketsIssueProvider({ vaultPath: join(vault, 'nope') });
    const result = await provider.listIssues({});
    expect(result).toMatchObject({ success: false, error: { type: 'generic' } });
  });
});
