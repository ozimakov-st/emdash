// Fork (ozimakov-st): create_task with a `ticket` tells OZdash, so a parked ticket starts.
import { ok } from '@emdash/shared';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it, vi } from 'vitest';
import { createTaskFromPrompt } from './create-task-from-prompt';
import type { McpToolDependencies } from './dependencies';
import { buildEmdashMcpServer } from './register-tools';

vi.mock(import('./create-task-from-prompt'), async (importOriginal) => ({
  ...(await importOriginal()),
  createTaskFromPrompt: vi.fn(),
}));

const created = {
  taskId: 'task-1',
  taskName: 'child',
  branchName: 'child',
  provider: 'claude',
  model: null,
  conversationType: 'pty',
  autoApprove: null,
  workspacePath: '/w',
};

async function createTask(deps: McpToolDependencies, args: Record<string, unknown>) {
  const server = buildEmdashMcpServer(deps);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client.callTool({ name: 'create_task', arguments: args });
}

function deps(onTicketTaskCreated: McpToolDependencies['onTicketTaskCreated']) {
  return {
    appVersion: '0.0.0',
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    onTicketTaskCreated,
  } as unknown as McpToolDependencies;
}

describe('create_task ticket hook', () => {
  it('reports a task created with a ticket', async () => {
    const ticket = { id: '12', title: 'T' };
    vi.mocked(createTaskFromPrompt).mockResolvedValueOnce(ok({ ...created, ticket }) as never);
    const hook = vi.fn();
    await createTask(deps(hook), { projectId: 'p', ticket });
    expect(hook).toHaveBeenCalledWith({
      projectId: 'p',
      taskId: 'task-1',
      taskName: 'child',
      ticket,
    });
  });

  it('stays quiet without a ticket', async () => {
    vi.mocked(createTaskFromPrompt).mockResolvedValueOnce(
      ok({ ...created, ticket: null }) as never
    );
    const hook = vi.fn();
    await createTask(deps(hook), { projectId: 'p' });
    expect(hook).not.toHaveBeenCalled();
  });
});
