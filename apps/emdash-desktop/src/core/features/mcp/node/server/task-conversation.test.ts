import { err, ok } from '@emdash/shared';
import { describe, expect, it, vi } from 'vitest';
import { conversationRegistryTable } from '@core/features/conversations/api/node/registry';
import type { McpToolDependencies } from './dependencies';
import { getTaskStatus, sendTaskMessage, terminalOutputToText } from './task-conversation';

type TaskRow = {
  id: string;
  status: string;
  archivedAt: string | null;
  workspaceId: string | null;
};
type ConversationRow = {
  id: string;
  provider: string | null;
  type: string | null;
  agentStatus: string | null;
  lastSessionActivityAt: string | null;
  updatedAt: string;
};

const TASK: TaskRow = {
  id: 'task-1',
  status: 'in_progress',
  archivedAt: null,
  workspaceId: 'workspace-1',
};

const PTY_CONVERSATION: ConversationRow = {
  id: 'conv-pty',
  provider: 'claude',
  type: 'pty',
  agentStatus: 'awaiting-input',
  lastSessionActivityAt: '2026-11-05T10:00:00.000Z',
  updatedAt: '2026-11-05 09:00:00',
};

const ACP_CONVERSATION: ConversationRow = {
  id: 'conv-acp',
  provider: 'codex',
  type: 'acp',
  agentStatus: null,
  lastSessionActivityAt: null,
  updatedAt: '2026-11-05 08:00:00',
};

/** Answers the task lookup and the conversation list from separate row sets. */
function fakeDb(tasks: TaskRow[], conversations: ConversationRow[]) {
  return {
    select: () => ({
      from: (table: unknown) => {
        const rows = table === conversationRegistryTable ? conversations : tasks;
        const chain = {
          where: () => chain,
          limit: async () => rows,
          then: (resolve: (value: unknown) => unknown) => Promise.resolve(rows).then(resolve),
        };
        return chain;
      },
    }),
  };
}

function snapshotState(data: unknown) {
  return { state: () => ({ snapshot: async () => ({ data }) }) };
}

type ClientOptions = {
  tuiSessions?: Record<string, { status: string }>;
  tuiAgentStates?: Record<string, { lastAssistantMessage?: string }>;
  ptyOutput?: string;
  acpSessions?: Record<string, { lifecycle: string; suspended?: true }>;
  acpSessionState?: unknown;
  acpHistory?: unknown;
  sendInput?: ReturnType<typeof vi.fn>;
  sendPrompt?: ReturnType<typeof vi.fn>;
};

function fakeClient(options: ClientOptions) {
  const sendInput = options.sendInput ?? vi.fn(async () => ok(undefined));
  const sendPrompt = options.sendPrompt ?? vi.fn(async () => ok({ queued: false }));
  const loadHistory = vi.fn(async () => ok(options.acpHistory ?? { kind: 'unavailable' }));
  return {
    sendInput,
    sendPrompt,
    loadHistory,
    client: {
      tuiAgents: {
        sessions: snapshotState(options.tuiSessions ?? {}),
        agentStates: snapshotState(options.tuiAgentStates ?? {}),
        output: {
          handle: () => ({
            snapshot: async () => ({
              data: { baseOffset: 0, text: options.ptyOutput ?? '', truncated: false },
            }),
          }),
        },
        sendInput,
      },
      acp: {
        sessions: snapshotState(options.acpSessions ?? {}),
        session: snapshotState(
          options.acpSessionState ?? { lifecycle: 'closed', transcript: null }
        ),
        loadHistory,
        sendPrompt,
      },
    },
  };
}

function dependencies(options: {
  tasks?: TaskRow[];
  conversations?: ConversationRow[];
  client?: ReturnType<typeof fakeClient>['client'];
  hostUnavailable?: boolean;
}): McpToolDependencies {
  return {
    db: fakeDb(options.tasks ?? [TASK], options.conversations ?? [PTY_CONVERSATION]),
    runtimes: {
      client: async () =>
        options.hostUnavailable ? err({ type: 'unreachable' }) : ok(options.client ?? {}),
    },
    logger: { warn: () => {} },
    workspaceIdentity: {
      resolve: async () => ({ host: { type: 'local', id: 'local' }, path: '/worktrees/task-1' }),
    },
  } as unknown as McpToolDependencies;
}

const base = { projectId: 'project-1', taskId: 'task-1' };

describe('sendTaskMessage', () => {
  it('pastes the message into a running PTY agent and then presses Enter', async () => {
    const fake = fakeClient({ tuiSessions: { 'conv-pty': { status: 'running' } } });
    const deps = dependencies({ client: fake.client });

    await expect(
      sendTaskMessage(deps, { ...base, message: '  continue please  ' }, { submitDelayMs: 0 })
    ).resolves.toEqual(ok({ conversationId: 'conv-pty', delivered: true }));
    expect(fake.sendInput.mock.calls).toEqual([
      [{ conversationId: 'conv-pty', data: '\x1b[200~continue please\x1b[201~' }],
      [{ conversationId: 'conv-pty', data: '\r' }],
    ]);
  });

  it('defaults to the most recently active conversation', async () => {
    const fake = fakeClient({
      tuiSessions: { 'conv-pty': { status: 'running' } },
      acpSessions: { 'conv-acp': { lifecycle: 'ready' } },
    });
    const deps = dependencies({
      client: fake.client,
      conversations: [ACP_CONVERSATION, PTY_CONVERSATION],
    });

    const result = await sendTaskMessage(deps, { ...base, message: 'hi' }, { submitDelayMs: 0 });
    expect(result).toEqual(ok({ conversationId: 'conv-pty', delivered: true }));
    expect(fake.sendPrompt).not.toHaveBeenCalled();
  });

  it('sends a user prompt to a running ACP conversation', async () => {
    const fake = fakeClient({ acpSessions: { 'conv-acp': { lifecycle: 'working' } } });
    const deps = dependencies({
      client: fake.client,
      conversations: [PTY_CONVERSATION, ACP_CONVERSATION],
    });

    await expect(
      sendTaskMessage(deps, { ...base, message: 'next step', conversationId: 'conv-acp' })
    ).resolves.toEqual(ok({ conversationId: 'conv-acp', delivered: true }));
    expect(fake.sendPrompt).toHaveBeenCalledWith({
      conversationId: 'conv-acp',
      promptId: expect.any(String),
      prompt: { text: 'next step' },
    });
    expect(fake.sendInput).not.toHaveBeenCalled();
  });

  it('rejects an empty message', async () => {
    const fake = fakeClient({ tuiSessions: { 'conv-pty': { status: 'running' } } });
    const result = await sendTaskMessage(dependencies({ client: fake.client }), {
      ...base,
      message: '   ',
    });
    expect(result).toEqual(err('message must not be empty'));
    expect(fake.sendInput).not.toHaveBeenCalled();
  });

  it('rejects an unknown task', async () => {
    const result = await sendTaskMessage(dependencies({ tasks: [] }), { ...base, message: 'hi' });
    expect(result).toEqual(err('Task not found in project project-1: task-1'));
  });

  it('rejects an archived task', async () => {
    const deps = dependencies({ tasks: [{ ...TASK, archivedAt: '2026-11-01T00:00:00Z' }] });
    const result = await sendTaskMessage(deps, { ...base, message: 'hi' });
    expect(result).toMatchObject({ success: false, error: expect.stringContaining('archived') });
  });

  it('rejects a task without conversations', async () => {
    const result = await sendTaskMessage(dependencies({ conversations: [] }), {
      ...base,
      message: 'hi',
    });
    expect(result).toMatchObject({
      success: false,
      error: expect.stringContaining('no agent conversation'),
    });
  });

  it('rejects a conversation id that is not part of the task', async () => {
    const result = await sendTaskMessage(dependencies({}), {
      ...base,
      message: 'hi',
      conversationId: 'other',
    });
    expect(result).toMatchObject({ success: false, error: expect.stringContaining('other') });
  });

  it('rejects a PTY conversation that is not running', async () => {
    const fake = fakeClient({ tuiSessions: { 'conv-pty': { status: 'exited' } } });
    const result = await sendTaskMessage(dependencies({ client: fake.client }), {
      ...base,
      message: 'hi',
    });
    expect(result).toMatchObject({ success: false, error: expect.stringContaining('not running') });
    expect(fake.sendInput).not.toHaveBeenCalled();
  });

  it('rejects a suspended ACP conversation', async () => {
    const fake = fakeClient({
      acpSessions: { 'conv-acp': { lifecycle: 'ready', suspended: true } },
    });
    const deps = dependencies({ client: fake.client, conversations: [ACP_CONVERSATION] });
    const result = await sendTaskMessage(deps, { ...base, message: 'hi' });
    expect(result).toMatchObject({ success: false, error: expect.stringContaining('not running') });
    expect(fake.sendPrompt).not.toHaveBeenCalled();
  });

  it('reports a host that cannot be reached', async () => {
    const result = await sendTaskMessage(dependencies({ hostUnavailable: true }), {
      ...base,
      message: 'hi',
    });
    expect(result).toMatchObject({ success: false, error: expect.stringContaining('unavailable') });
  });

  it('reports a failed PTY write', async () => {
    const fake = fakeClient({
      tuiSessions: { 'conv-pty': { status: 'running' } },
      sendInput: vi.fn(async () => err({ type: 'not-found', conversationId: 'conv-pty' })),
    });
    const result = await sendTaskMessage(dependencies({ client: fake.client }), {
      ...base,
      message: 'hi',
    });
    expect(result).toMatchObject({ success: false, error: expect.stringContaining('not-found') });
    expect(fake.sendInput).toHaveBeenCalledTimes(1);
  });

  it('reports a rejected ACP prompt', async () => {
    const fake = fakeClient({
      acpSessions: { 'conv-acp': { lifecycle: 'ready' } },
      sendPrompt: vi.fn(async () => err({ type: 'invalid-state', message: 'busy' })),
    });
    const deps = dependencies({ client: fake.client, conversations: [ACP_CONVERSATION] });
    const result = await sendTaskMessage(deps, { ...base, message: 'hi' });
    expect(result).toMatchObject({ success: false, error: expect.stringContaining('busy') });
  });
});

describe('getTaskStatus', () => {
  it('lists conversations newest first with the tail of the PTY output', async () => {
    const fake = fakeClient({
      ptyOutput:
        '\x1b[2J\x1b[1;1H\x1b[32mWorking...\x1b[0m\r\nSTATUS: needs-input\r\nQUESTION: ok?\r\n',
      tuiAgentStates: { 'conv-pty': { lastAssistantMessage: 'STATUS: needs-input' } },
    });
    const deps = dependencies({
      client: fake.client,
      conversations: [ACP_CONVERSATION, PTY_CONVERSATION],
    });

    await expect(getTaskStatus(deps, base)).resolves.toEqual(
      ok({
        taskId: 'task-1',
        taskStatus: 'in_progress',
        conversations: [
          {
            conversationId: 'conv-pty',
            provider: 'claude',
            type: 'pty',
            agentStatus: 'awaiting-input',
            updatedAt: '2026-11-05T10:00:00.000Z',
          },
          {
            conversationId: 'conv-acp',
            provider: 'codex',
            type: 'acp',
            agentStatus: 'idle',
            updatedAt: '2026-11-05 08:00:00',
          },
        ],
        latestOutput: {
          conversationId: 'conv-pty',
          text: 'Working...\nSTATUS: needs-input\nQUESTION: ok?\n',
          lastAssistantMessage: 'STATUS: needs-input',
        },
      })
    );
  });

  it('keeps only the last maxChars characters', async () => {
    const fake = fakeClient({ ptyOutput: 'abcdefghij' });
    const result = await getTaskStatus(dependencies({ client: fake.client }), {
      ...base,
      maxChars: 4,
    });
    expect(result).toMatchObject({ data: { latestOutput: { text: 'ghij' } } });
  });

  it('reads the latest assistant message of the active ACP turn', async () => {
    const fake = fakeClient({
      acpSessionState: {
        lifecycle: 'working',
        transcript: {
          activeTurn: {
            items: [
              { kind: 'message', role: 'user', text: 'do it' },
              { kind: 'message', role: 'assistant', text: 'first' },
              { kind: 'tool_call', id: 't' },
              { kind: 'message', role: 'assistant', text: 'STATUS: working' },
            ],
          },
        },
      },
    });
    const deps = dependencies({ client: fake.client, conversations: [ACP_CONVERSATION] });

    const result = await getTaskStatus(deps, base);
    expect(result).toMatchObject({
      data: { latestOutput: { conversationId: 'conv-acp', text: 'STATUS: working' } },
    });
    expect(fake.loadHistory).not.toHaveBeenCalled();
  });

  it('falls back to ACP history when no turn is active', async () => {
    const fake = fakeClient({
      acpSessionState: { lifecycle: 'ready', transcript: { activeTurn: null } },
      acpHistory: {
        kind: 'available',
        turns: [
          { items: [{ kind: 'message', role: 'assistant', text: 'older' }] },
          {
            items: [
              { kind: 'message', role: 'assistant', text: 'STATUS: done' },
              { kind: 'message', role: 'user', text: 'thanks' },
            ],
          },
          { items: [{ kind: 'message', role: 'user', text: 'queued' }] },
        ],
      },
    });
    const deps = dependencies({ client: fake.client, conversations: [ACP_CONVERSATION] });

    const result = await getTaskStatus(deps, base);
    expect(result).toMatchObject({ data: { latestOutput: { text: 'STATUS: done' } } });
  });

  it('returns null output for a task without conversations', async () => {
    const result = await getTaskStatus(dependencies({ conversations: [] }), base);
    expect(result).toMatchObject({ data: { conversations: [], latestOutput: null } });
  });

  it('still reports status when the host cannot be reached', async () => {
    const result = await getTaskStatus(dependencies({ hostUnavailable: true }), base);
    expect(result).toMatchObject({
      data: {
        conversations: [{ conversationId: 'conv-pty' }],
        latestOutput: null,
        note: expect.stringContaining('unavailable'),
      },
    });
  });

  it('still reports status when reading the output throws', async () => {
    const fake = fakeClient({});
    fake.client.tuiAgents.output.handle = () => ({
      snapshot: async () => {
        throw new Error('disconnected');
      },
    });
    const result = await getTaskStatus(dependencies({ client: fake.client }), base);
    expect(result).toMatchObject({
      data: {
        conversations: [{ conversationId: 'conv-pty' }],
        latestOutput: null,
        note: 'Output could not be read from the task host.',
      },
    });
  });

  it('works for archived tasks', async () => {
    const fake = fakeClient({ ptyOutput: 'done' });
    const deps = dependencies({
      client: fake.client,
      tasks: [{ ...TASK, status: 'done', archivedAt: '2026-11-01T00:00:00Z' }],
    });
    const result = await getTaskStatus(deps, base);
    expect(result).toMatchObject({ data: { taskStatus: 'done', latestOutput: { text: 'done' } } });
  });

  it('rejects an unknown task', async () => {
    await expect(getTaskStatus(dependencies({ tasks: [] }), base)).resolves.toEqual(
      err('Task not found in project project-1: task-1')
    );
  });
});

describe('terminalOutputToText', () => {
  it('strips colors, cursor moves, and OSC titles', () => {
    expect(
      terminalOutputToText('\x1b]0;title\x07\x1b[?25l\x1b[1mBold\x1b[22m\x1b[3Cgap\x1b(B end')
    ).toBe('Bold   gap end');
  });

  it('turns carriage returns into line breaks and drops other control bytes', () => {
    expect(terminalOutputToText('one\r\ntwo\rthree\x07\x08   \n\n\n\nfour')).toBe(
      'one\ntwo\nthree\n\nfour'
    );
  });
});
