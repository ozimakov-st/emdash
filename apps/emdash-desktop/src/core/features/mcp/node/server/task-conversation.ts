import { randomUUID } from 'node:crypto';
import type { TranscriptTurn } from '@emdash/core/runtimes/acp/api';
import type { HostRuntimesClient } from '@emdash/core/services/runtime-broker/api';
import { err, ok, type Result } from '@emdash/shared';
import { and, eq, isNull } from 'drizzle-orm';
import {
  conversationRegistryTable as conversations,
  liveConversations,
} from '@core/features/conversations/api/node/registry';
import type { AgentStatus } from '@core/primitives/agents/api';
import { buildPromptInjectionPayload } from '@core/primitives/prompt-injection/api/prompt-injection';
import { tasks } from '@core/services/app-db/node/schema';
import type { McpToolDependencies } from './dependencies';
import { resolveWorkspaceRuntime } from './workspace-runtime';

export const DEFAULT_STATUS_MAX_CHARS = 4000;
export const MAX_STATUS_MAX_CHARS = 20_000;

/**
 * Pause between pasting a message into a terminal agent and pressing Enter.
 * The app's own "send" also writes the two separately; the pause makes sure
 * the TUI has finished the paste before the Enter arrives, so it submits the
 * message instead of adding a line break to it.
 */
const SUBMIT_DELAY_MS = 100;

/** How many recent ACP turns to scan for the latest assistant message. */
const ACP_HISTORY_TURNS = 20;

type TaskRecord = Readonly<{
  id: string;
  status: string;
  archivedAt: string | null;
  workspaceId: string | null;
}>;

type ConversationRecord = Readonly<{
  id: string;
  /** Fork (ozimakov-st): the conversation title and the model passed to its CLI. */
  title: string;
  model: string | null;
  provider: string | null;
  type: 'pty' | 'acp';
  agentStatus: AgentStatus;
  /** When the session last did something, or when the record last changed. */
  activityAt: string;
}>;

async function findTask(
  dependencies: McpToolDependencies,
  input: { projectId: string; taskId: string }
): Promise<Result<TaskRecord, string>> {
  const [row] = await dependencies.db
    .select({
      id: tasks.id,
      status: tasks.status,
      archivedAt: tasks.archivedAt,
      workspaceId: tasks.workspaceId,
    })
    .from(tasks)
    .where(
      and(eq(tasks.id, input.taskId), eq(tasks.projectId, input.projectId), isNull(tasks.deletedAt))
    )
    .limit(1);
  if (!row) return err(`Task not found in project ${input.projectId}: ${input.taskId}`);
  return ok(row);
}

/** SQLite's CURRENT_TIMESTAMP has no zone marker; it is UTC. */
function toMillis(timestamp: string): number {
  const iso = /[zZ]|[+-]\d\d:?\d\d$/u.test(timestamp)
    ? timestamp
    : `${timestamp.replace(' ', 'T')}Z`;
  const millis = Date.parse(iso);
  return Number.isNaN(millis) ? 0 : millis;
}

/** The task's conversations, most recently active first. */
async function listTaskConversations(
  dependencies: McpToolDependencies,
  input: { projectId: string; taskId: string }
): Promise<ConversationRecord[]> {
  const rows = await dependencies.db
    .select({
      id: conversations.id,
      title: conversations.title,
      config: conversations.config,
      provider: conversations.provider,
      type: conversations.type,
      agentStatus: conversations.agentStatus,
      lastSessionActivityAt: conversations.lastSessionActivityAt,
      updatedAt: conversations.updatedAt,
    })
    .from(conversations)
    .where(
      and(
        eq(conversations.projectId, input.projectId),
        eq(conversations.taskId, input.taskId),
        liveConversations()
      )
    );
  return rows
    .map((row) => ({
      id: row.id,
      title: row.title ?? '',
      model: (row.config?.type === 'pty' && row.config.model) || null,
      provider: row.provider,
      type: row.type === 'acp' ? ('acp' as const) : ('pty' as const),
      // No status recorded yet reads as idle, as it does in the task list.
      agentStatus: (row.agentStatus ?? 'idle') as AgentStatus,
      activityAt: row.lastSessionActivityAt ?? row.updatedAt,
    }))
    .sort((a, b) => toMillis(b.activityAt) - toMillis(a.activityAt));
}

async function resolveTaskClient(
  dependencies: McpToolDependencies,
  task: TaskRecord
): Promise<Result<HostRuntimesClient, string>> {
  if (!task.workspaceId) return err(`Task ${task.id} has no workspace yet`);
  const runtime = await resolveWorkspaceRuntime(dependencies, task.workspaceId);
  if (!runtime.success) return runtime;
  return ok(runtime.data.client);
}

function notRunning(conversationId: string): string {
  return (
    `Conversation ${conversationId} is not running. Open the task in Emdash to resume its ` +
    'agent, then try again.'
  );
}

export type SendTaskMessageInput = {
  projectId: string;
  taskId: string;
  message: string;
  conversationId?: string;
};

/**
 * Sends a message to a task's agent as if the user typed it: pasted and
 * submitted with Enter for a terminal (PTY) agent, or sent as a user prompt for
 * a chat UI (ACP) agent. Only a session that is already running receives it;
 * this never starts or resumes an agent.
 */
export async function sendTaskMessage(
  dependencies: McpToolDependencies,
  input: SendTaskMessageInput,
  options: { submitDelayMs?: number } = {}
): Promise<Result<{ conversationId: string; delivered: true }, string>> {
  if (!input.message.trim()) return err('message must not be empty');

  const task = await findTask(dependencies, input);
  if (!task.success) return task;
  if (task.data.archivedAt) {
    return err(`Task ${input.taskId} is archived; restore it in Emdash before messaging its agent`);
  }

  const taskConversations = await listTaskConversations(dependencies, input);
  const conversation = input.conversationId
    ? taskConversations.find((candidate) => candidate.id === input.conversationId)
    : taskConversations[0];
  if (!conversation) {
    return err(
      input.conversationId
        ? `Conversation ${input.conversationId} not found in task ${input.taskId}`
        : `Task ${input.taskId} has no agent conversation`
    );
  }

  const client = await resolveTaskClient(dependencies, task.data);
  if (!client.success) return client;

  const sent =
    conversation.type === 'acp'
      ? await sendAcpMessage(client.data, conversation, input.message)
      : await sendPtyMessage(
          client.data,
          conversation,
          input.message,
          options.submitDelayMs ?? SUBMIT_DELAY_MS
        );
  if (!sent.success) return sent;
  return ok({ conversationId: conversation.id, delivered: true });
}

async function sendPtyMessage(
  client: HostRuntimesClient,
  conversation: ConversationRecord,
  message: string,
  submitDelayMs: number
): Promise<Result<void, string>> {
  const sessions = await client.tuiAgents.sessions.state(undefined, 'list').snapshot();
  if (sessions.data[conversation.id]?.status !== 'running') {
    return err(notRunning(conversation.id));
  }

  // Bracketed paste keeps a multi-line message as one input, like the context
  // bar's "add and send", and Enter then submits it.
  const payload = buildPromptInjectionPayload({
    providerId: conversation.provider ?? undefined,
    text: message,
    forceBracketedPaste: true,
  });
  const pasted = await client.tuiAgents.sendInput({
    conversationId: conversation.id,
    data: payload,
  });
  if (!pasted.success) return err(`Could not type into conversation: ${pasted.error.type}`);
  if (submitDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, submitDelayMs));
  const submitted = await client.tuiAgents.sendInput({
    conversationId: conversation.id,
    data: '\r',
  });
  if (!submitted.success) {
    return err(`The message was typed but not submitted: ${submitted.error.type}`);
  }
  return ok(undefined);
}

async function sendAcpMessage(
  client: HostRuntimesClient,
  conversation: ConversationRecord,
  message: string
): Promise<Result<void, string>> {
  const sessions = await client.acp.sessions.state(undefined, 'list').snapshot();
  const summary = sessions.data[conversation.id];
  if (!summary || summary.suspended || summary.lifecycle === 'closed') {
    return err(notRunning(conversation.id));
  }

  // Default placement: delivered now when idle, queued behind a running turn.
  const sent = await client.acp.sendPrompt({
    conversationId: conversation.id,
    promptId: randomUUID(),
    prompt: { text: message },
  });
  if (!sent.success) {
    const detail = 'message' in sent.error ? sent.error.message : undefined;
    return err(`The agent did not accept the message: ${detail ?? sent.error.type}`);
  }
  return ok(undefined);
}

export type TaskStatusInput = {
  projectId: string;
  taskId: string;
  maxChars?: number;
  /** Fork (ozimakov-st): read latestOutput from this conversation (default: most recent). */
  conversationId?: string;
};

export type TaskStatus = {
  taskId: string;
  taskStatus: string;
  conversations: Array<{
    conversationId: string;
    title: string;
    provider: string | null;
    model: string | null;
    type: 'pty' | 'acp';
    agentStatus: AgentStatus;
    updatedAt: string;
  }>;
  latestOutput: {
    conversationId: string;
    text: string;
    /** For terminal agents with hooks: the agent's last reply, as its hook reported it. */
    lastAssistantMessage?: string;
  } | null;
  /** Why latestOutput is null although the task has conversations. */
  note?: string;
};

/**
 * Reads a task's status, the app's agent status of each conversation, and the
 * recent output of the most recently active one. Read-only: it never attaches
 * the project or wakes an agent.
 */
export async function getTaskStatus(
  dependencies: McpToolDependencies,
  input: TaskStatusInput
): Promise<Result<TaskStatus, string>> {
  const maxChars = Math.min(input.maxChars ?? DEFAULT_STATUS_MAX_CHARS, MAX_STATUS_MAX_CHARS);
  const task = await findTask(dependencies, input);
  if (!task.success) return task;

  const taskConversations = await listTaskConversations(dependencies, input);
  const status: TaskStatus = {
    taskId: task.data.id,
    taskStatus: task.data.status,
    conversations: taskConversations.map((conversation) => ({
      conversationId: conversation.id,
      title: conversation.title,
      provider: conversation.provider,
      model: conversation.model,
      type: conversation.type,
      agentStatus: conversation.agentStatus,
      updatedAt: conversation.activityAt,
    })),
    latestOutput: null,
  };
  const latest = input.conversationId
    ? taskConversations.find((conversation) => conversation.id === input.conversationId)
    : taskConversations[0];
  if (!latest && input.conversationId) {
    return err(`Conversation ${input.conversationId} not found in task ${input.taskId}`);
  }
  if (!latest) return ok(status);

  const client = await resolveTaskClient(dependencies, task.data);
  if (!client.success) {
    return ok({ ...status, note: `Output could not be read: ${client.error}` });
  }
  let output: ConversationOutput | null;
  try {
    output =
      latest.type === 'acp'
        ? await readAcpOutput(client.data, latest.id)
        : await readPtyOutput(client.data, latest.id);
  } catch (error) {
    // The statuses above are still worth returning when the host read fails.
    dependencies.logger.warn('McpHttpServer: get_task_status could not read output', {
      conversationId: latest.id,
      error: String(error),
    });
    return ok({ ...status, note: 'Output could not be read from the task host.' });
  }
  if (!output) {
    return ok({
      ...status,
      note: input.conversationId
        ? 'This conversation has no output to show yet.'
        : 'The latest conversation has no output to show yet.',
    });
  }
  return ok({
    ...status,
    latestOutput: {
      conversationId: latest.id,
      text: tail(output.text, maxChars),
      ...(output.lastAssistantMessage
        ? { lastAssistantMessage: tail(output.lastAssistantMessage, maxChars) }
        : {}),
    },
  });
}

type ConversationOutput = { text: string; lastAssistantMessage?: string };

async function readPtyOutput(
  client: HostRuntimesClient,
  conversationId: string
): Promise<ConversationOutput | null> {
  const [log, agentStates] = await Promise.all([
    client.tuiAgents.output.handle({ conversationId }).snapshot(),
    client.tuiAgents.agentStates.state(undefined, 'list').snapshot(),
  ]);
  const text = terminalOutputToText(log.data.text);
  const lastAssistantMessage = agentStates.data[conversationId]?.lastAssistantMessage;
  if (!text && !lastAssistantMessage) return null;
  return { text, ...(lastAssistantMessage ? { lastAssistantMessage } : {}) };
}

async function readAcpOutput(
  client: HostRuntimesClient,
  conversationId: string
): Promise<ConversationOutput | null> {
  const session = await client.acp.session.state({ conversationId }, 'state').snapshot();
  const activeTurn = session.data.transcript?.activeTurn;
  const active = activeTurn ? lastAssistantText([activeTurn]) : null;
  if (active) return { text: active };

  const history = await client.acp.loadHistory({ conversationId, limit: ACP_HISTORY_TURNS });
  if (!history.success || history.data.kind !== 'available') return null;
  const text = lastAssistantText(history.data.turns);
  return text ? { text } : null;
}

/** The newest assistant message across turns given oldest first. */
function lastAssistantText(turns: readonly Pick<TranscriptTurn, 'items'>[]): string | null {
  for (let turn = turns.length - 1; turn >= 0; turn--) {
    const items = turns[turn].items;
    for (let index = items.length - 1; index >= 0; index--) {
      const item = items[index];
      if (item.kind === 'message' && item.role === 'assistant' && item.text) return item.text;
    }
  }
  return null;
}

function tail(text: string, maxChars: number): string {
  return text.length > maxChars ? text.slice(text.length - maxChars) : text;
}

/**
 * Turns raw terminal output into plain text: drops escape sequences (colors,
 * cursor moves, window titles), turns carriage returns into line breaks, and
 * trims trailing spaces. Screen redraws are not replayed, so a TUI that repaints
 * a line shows each version of it.
 */
export function terminalOutputToText(raw: string): string {
  const text = raw
    // OSC (titles, hyperlinks), ended by BEL or ST.
    .replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/gu, '')
    // DCS, SOS, PM, and APC strings, ended by ST.
    .replace(/\x1b[PX^_][\s\S]*?\x1b\\/gu, '')
    // Cursor forward stands in for spaces in some TUIs.
    .replace(/\x1b\[(\d*)C/gu, (_match, count: string) =>
      ' '.repeat(Math.min(Number(count) || 1, 200))
    )
    // Every other CSI sequence.
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/gu, '')
    // Remaining short escapes, such as charset selection.
    .replace(/\x1b[ -/]*[0-~]/gu, '')
    .replace(/\r+\n/gu, '\n')
    .replace(/\r/gu, '\n')
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/gu, '');
  return text
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/gu, '\n\n');
}
