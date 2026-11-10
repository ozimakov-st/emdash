// Fork (ozimakov-st): MCP create_conversation. Adds a second (third, …) agent session to an
// existing task, in the task's worktree, for example a reviewer next to the executor. It
// uses the same operation as "new conversation" in the task UI, and the same provider,
// model, effort and auto-approve handling as create_task. Terminal agents only.
import { randomUUID } from 'node:crypto';
import type { AgentProviderId } from '@emdash/plugins/agents/types';
import { err, ok, type Result } from '@emdash/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { getPlugin } from '@core/features/agents/api/node/plugin-registry';
import {
  conversationRegistryTable as conversations,
  liveConversations,
} from '@core/features/conversations/api/node/registry';
import { MAX_CONVERSATION_TITLE_LENGTH } from '@core/primitives/conversations/api';
import { tasks } from '@core/services/app-db/node/schema';
import { withProjectAttachment } from './attach-project';
import {
  resolveEffort,
  resolveModel,
  resolveProvider,
  resolvePtyAutoApprove,
} from './create-task-from-prompt';
import type { McpToolDependencies } from './dependencies';

export type McpCreateConversationInput = {
  projectId: string;
  taskId: string;
  prompt: string;
  provider?: string;
  model?: string;
  effort?: string;
  /** Defaults to true (no permission prompts), like create_task. */
  autoApprove?: boolean;
  title?: string;
};

export type McpCreateConversationResult = {
  conversationId: string;
  title: string;
  provider: AgentProviderId;
  model: string | null;
  /** Null when none was asked for, or when the provider has no effort flag. */
  effort: string | null;
  /** False when the provider has no auto-approve mode. */
  autoApprove: boolean;
};

/** `Claude (2)`: the UI's default title form, numbered after the task's conversations. */
export function defaultConversationTitle(
  provider: string,
  existing: ReadonlyArray<{ provider: string | null }>
): string {
  const count = existing.filter((row) => row.provider === provider).length;
  return `${provider.charAt(0).toUpperCase()}${provider.slice(1)} (${count + 1})`;
}

export async function createConversationInTask(
  dependencies: McpToolDependencies,
  input: McpCreateConversationInput
): Promise<Result<McpCreateConversationResult, string>> {
  const prompt = input.prompt.trim();
  if (!prompt) return err('prompt must not be empty');
  const create = dependencies.createConversation;
  if (!create) return err('This Emdash build cannot create conversations over MCP');
  const title = input.title?.trim();
  if (title && title.length > MAX_CONVERSATION_TITLE_LENGTH) {
    return err(`title must be at most ${MAX_CONVERSATION_TITLE_LENGTH} characters`);
  }

  const [task] = await dependencies.db
    .select({ id: tasks.id, archivedAt: tasks.archivedAt, workspaceId: tasks.workspaceId })
    .from(tasks)
    .where(
      and(eq(tasks.id, input.taskId), eq(tasks.projectId, input.projectId), isNull(tasks.deletedAt))
    )
    .limit(1);
  if (!task) return err(`Task not found in project ${input.projectId}: ${input.taskId}`);
  if (task.archivedAt) {
    return err(`Task ${input.taskId} is archived; restore it in Emdash before adding a session`);
  }
  if (!task.workspaceId) return err(`Task ${input.taskId} has no workspace yet`);

  const provider = await resolveProvider(dependencies.appSettings, input.provider);
  if (!provider.success) return provider;
  const model = resolveModel(provider.data, input.model);
  if (!model.success) return model;
  const effort = resolveEffort(provider.data, input.effort);
  if (!effort.success) return effort;
  const promptKind = getPlugin(provider.data).capabilities.prompt.kind;
  if (promptKind !== 'argv' && promptKind !== 'stdin-pipe') {
    return err(
      `Provider "${provider.data}" cannot receive a prompt when it starts in terminal mode. ` +
        'Choose another provider.'
    );
  }

  // Same rule as create_task: a session started while the app does not hold the project
  // open is stopped again when this call releases its own attachment.
  if (!dependencies.projects.requireAttached(input.projectId).success) {
    return err(
      'The project is not open in Emdash, so a new session would stop again right away. ' +
        'Open the project in Emdash, then try again.'
    );
  }

  return withProjectAttachment(dependencies.projects, input.projectId, async () => {
    // Registers the task session when the task was not opened since the app started
    // (a no-op for a live task). The new conversation is launched inside it.
    const provisioned = await dependencies.tasks.provisionWorkspace(input.taskId);
    if (!provisioned.success) {
      const { error } = provisioned;
      return err(
        `The task's worktree is not available: ${'message' in error && error.message ? error.message : error.type}`
      );
    }
    const existing = await dependencies.db
      .select({ provider: conversations.provider })
      .from(conversations)
      .where(and(eq(conversations.taskId, input.taskId), liveConversations()));
    const autoApprove = resolvePtyAutoApprove(provider.data, input.autoApprove);
    let conversation;
    try {
      conversation = await create({
        id: randomUUID(),
        projectId: input.projectId,
        taskId: input.taskId,
        provider: provider.data,
        title: title || defaultConversationTitle(provider.data, existing),
        type: 'pty',
        autoApprove,
        ...(model.data && { model: model.data }),
        ...(effort.data && { effort: effort.data }),
        initialPrompt: prompt,
      });
    } catch (error) {
      dependencies.logger.warn('McpHttpServer: create_conversation failed', {
        taskId: input.taskId,
        error: String(error),
      });
      return err(`The conversation could not be started: ${String(error)}`);
    }
    return ok({
      conversationId: conversation.id,
      title: conversation.title,
      provider: provider.data,
      model: model.data ?? null,
      effort: effort.data ?? null,
      autoApprove,
    });
  });
}
