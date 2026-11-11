// Fork (ozimakov-st): the agent palette presets, followed from the MCP tools to the final
// agent command line. create_task and create_conversation resolve provider, model and
// effort; the stored pty config is built by the same builder createTask and
// createConversation use; the conversation goes through the TUI provider (start input) and
// the runtime's command context into the plugin's command builder.
import { LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import {
  tuiPromptCommandContext,
  type TuiAgentStartInput,
} from '@emdash/core/runtimes/tui-agents/api';
import { ok } from '@emdash/shared';
import { cell } from '@emdash/wire/state';
import { describe, expect, it, vi } from 'vitest';
import { getPlugin } from '@core/features/agents/api/node/plugin-registry';
import { mapConversationRowToConversation } from '@core/features/conversations/api/node/utils';
import { emptyProviderSettings } from '@core/features/conversations/api/provider-settings';
import { TuiConversationProvider } from '@core/features/conversations/node/tui-conversation-provider';
import { createConversationInTask } from '@core/features/mcp/node/server/create-conversation';
import { createTaskFromPrompt } from '@core/features/mcp/node/server/create-task-from-prompt';
import type { McpToolDependencies } from '@core/features/mcp/node/server/dependencies';
import type { ProjectProvider } from '@core/features/projects/api/node/project-provider';
import {
  buildPtyConversationConfig,
  type ConversationConfigPty,
  type CreateConversationParams,
} from '@core/primitives/conversations/api';
import type { CreateTaskParams } from '@core/primitives/tasks/api';

vi.mock('@core/features/projects/api/node/settings/effective-settings', () => ({
  resolveProjectEffectiveSettings: async () => ({
    baseRemote: { value: 'origin' },
    defaultBranch: { value: { branch: 'main', remote: null } },
  }),
}));

const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as never;

function fakeDb(rows: unknown[]) {
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: () => Promise.resolve(rows),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(rows).then(resolve),
  };
  return { select: () => chain };
}

function project(): ProjectProvider {
  const main = { type: 'local', ref: 'refs/heads/main', oid: 'a' };
  return {
    projectId: 'project-1',
    host: LOCAL_HOST_REF,
    repository: { path: '/repo' },
    settings: {},
    repoFacts: {},
    git: {
      repository: {
        model: {
          state: () => ({
            snapshot: async () => ({ data: { branches: [main], tags: [], remoteHeads: [] } }),
          }),
        },
      },
    },
  } as unknown as ProjectProvider;
}

function dependencies(overrides: Partial<McpToolDependencies>): McpToolDependencies {
  const attached = project();
  return {
    appVersion: '0.0.0',
    logger,
    db: fakeDb([{ id: 'task-1', archivedAt: null, workspaceId: 'workspace-1' }]),
    projects: {
      track: () => cell({ kind: 'attached' }),
      requireAttached: () => ok(attached),
    },
    tasks: {
      createTask: async () => ok({}),
      provisionWorkspace: async () => ok({ path: '/worktrees/task-1' }),
    },
    appSettings: {
      get: async (key: string) =>
        key === 'project'
          ? { branchPrefix: '', appendRandomBranchSuffix: false }
          : // Terminal command lines: the global session mode is the terminal here.
            key === 'interface'
            ? { sessionMode: 'terminal' }
            : {},
    },
    readProviderSettings: async () => emptyProviderSettings,
    telemetry: { capture: () => {} },
    startInitialConversation: async () => ({ started: true }),
    ...overrides,
  } as unknown as McpToolDependencies;
}

/** The stored pty config → Conversation → TUI start input → final command line. */
async function commandLine(
  conversationId: string,
  provider: string,
  config: ConversationConfigPty
) {
  const conversation = mapConversationRowToConversation({
    id: conversationId,
    projectId: 'project-1',
    taskId: 'task-1',
    title: 'Review',
    provider,
    config,
    providerSessionId: null,
    lastSessionActivityAt: null,
    isInitialConversation: false,
    agentStatus: null,
    agentStatusSeen: 1,
    type: 'pty',
  } as never);
  if (!conversation) throw new Error('conversation did not map');

  const startSession = vi.fn(async (_input: TuiAgentStartInput) => ok({ outcome: 'started' }));
  const tui = new TuiConversationProvider(
    {
      host: LOCAL_HOST_REF,
      tuiAgents: { startSession, resume: vi.fn() } as never,
      projectId: 'project-1',
      taskId: 'task-1',
      taskPath: '/worktrees/task-1',
      launchContextSource: {
        resolve: async () =>
          ok({
            workspace: {
              workspaceId: 'workspace-1',
              projectId: 'project-1',
              host: LOCAL_HOST_REF,
              path: '/worktrees/task-1',
            },
            tmux: false,
            env: {},
          }),
      },
    },
    {
      db: { select: vi.fn() } as never,
      getProviderConfig: async () => undefined,
      getTaskSettings: async () => ({ autoTrustWorktrees: false }),
      getTerminalColorEnv: async () => ({}),
      resolveSessionGitCredentials: async () => undefined,
    }
  );
  await tui.ensureSession({ conversation, mode: 'start', initialPrompt: config.initialPrompt });
  const [input] = startSession.mock.calls[0];
  const build = getPlugin(provider).behavior?.prompt?.buildCommand;
  if (!build) throw new Error(`${provider} has no prompt command`);
  return build({ ...tuiPromptCommandContext(input, false), cli: provider }).args;
}

/** MCP create_conversation with a preset's provider, model and effort. */
async function viaCreateConversation(preset: { provider: string; model: string; effort?: string }) {
  let params: CreateConversationParams | undefined;
  const deps = dependencies({
    createConversation: async (value: CreateConversationParams) => {
      params = value;
      return { id: value.id, title: value.title } as never;
    },
  });
  const result = await createConversationInTask(deps, {
    projectId: 'project-1',
    taskId: 'task-1',
    prompt: 'Review it',
    ...preset,
  });
  expect(result.success).toBe(true);
  if (!params) throw new Error('createConversation was not called');
  // The same builder createConversation stores the config with.
  const config = buildPtyConversationConfig(params);
  return commandLine(params.id ?? 'conv-1', params.provider, config);
}

/** MCP create_task with a preset's provider, model and effort (the initial conversation). */
async function viaCreateTask(preset: { provider: string; model: string; effort?: string }) {
  const createTask = vi.fn(async (_params: CreateTaskParams) => ok({}));
  const tasks = { createTask, provisionWorkspace: async () => ok({ path: '/worktrees/task-1' }) };
  const result = await createTaskFromPrompt(dependencies({ tasks: tasks as never }), {
    projectId: 'project-1',
    prompt: 'Review it',
    branchName: 'feature/review',
    ...preset,
  });
  expect(result.success).toBe(true);
  const ic = createTask.mock.calls[0][0].taskConfig.initialConversation;
  if (!ic || ic.type === 'acp') throw new Error('no terminal initial conversation');
  // The same builder createTask stores the config with.
  const config = buildPtyConversationConfig({
    autoApprove: ic.autoApprove,
    initialPrompt: ic.initialPrompt?.trim(),
    model: ic.model,
    effort: ic.effort,
  });
  return commandLine(ic.id, ic.provider, config);
}

// The palette rows in <vault>/context/agents.md.
const cases = [
  {
    name: 'pm / architect (claude opus, effort high)',
    preset: { provider: 'claude', model: 'opus', effort: 'high' },
    args: (id: string) => [
      '--session-id',
      id,
      '--dangerously-skip-permissions',
      '--model',
      'opus',
      '--effort',
      'high',
      'Review it',
    ],
  },
  {
    name: 'review-gpt (codex gpt-6.1-sol, effort high)',
    preset: { provider: 'codex', model: 'gpt-6.1-sol', effort: 'high' },
    args: () => [
      '-c',
      'approval_policy=never',
      '-c',
      'sandbox_mode=danger-full-access',
      '--dangerously-bypass-hook-trust',
      '-m',
      'gpt-6.1-sol',
      '-c',
      'model_reasoning_effort=high',
      'Review it',
    ],
  },
  {
    name: 'review-grok (cursor cursor-grok-4.6-high)',
    preset: { provider: 'cursor', model: 'cursor-grok-4.6-high' },
    args: () => ['-f', '--approve-mcps', '--model', 'cursor-grok-4.6-high', 'Review it'],
  },
];

describe('agent preset command lines through the MCP tools', () => {
  it.each(cases)('create_conversation: $name', async ({ preset, args }) => {
    const line = await viaCreateConversation(preset);
    expect(line).toEqual(args(line[1]));
  });

  it.each(cases)('create_task: $name', async ({ preset, args }) => {
    const line = await viaCreateTask(preset);
    expect(line).toEqual(args(line[1]));
  });

  it('cursor ignores an effort (no flag) but keeps the model', async () => {
    const line = await viaCreateConversation({
      provider: 'cursor',
      model: 'cursor-grok-4.6-high',
      effort: 'high',
    });
    expect(line).toEqual(['-f', '--approve-mcps', '--model', 'cursor-grok-4.6-high', 'Review it']);
  });
});
