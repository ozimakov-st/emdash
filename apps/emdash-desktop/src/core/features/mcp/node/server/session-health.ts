// Fork (ozimakov-st): the state of every agent session in open tasks, for the MCP tool
// get_session_health, and the results of the last session recovery after a restart
// (main/host/ozdash-session-recovery.ts).
import { err, ok, type Result } from '@emdash/shared';
import { and, eq, isNull, type SQL } from 'drizzle-orm';
import {
  conversationRegistryTable as conversations,
  liveConversations,
} from '@core/features/conversations/api/node/registry';
import type { RecoveryResult } from '@core/features/ozdash/api/session-recovery';
import type { AgentStatus } from '@core/primitives/agents/api';
import type { ConversationConfig } from '@core/primitives/conversations/api';
import { projects, tasks } from '@core/services/app-db/node/schema';
import { withProjectAttachment } from './attach-project';
import type { McpToolDependencies } from './dependencies';

export type SessionState = AgentStatus | 'never-started';

export type SessionHealthRow = {
  projectId: string;
  projectName: string;
  taskId: string;
  taskName: string;
  conversationId: string;
  title: string;
  provider: string | null;
  type: 'acp' | 'pty';
  state: SessionState;
  lastActivityAt: string;
  /** What the last restart recovery did with this session, if anything. */
  recovery?: { at: string; status: RecoveryResult['outcome']['status']; error?: string };
};

const lastRecovery = new Map<string, RecoveryResult>();

export function recordRecoveryResult(result: RecoveryResult): void {
  lastRecovery.set(result.conversationId, result);
}

/** Test seam. */
export function clearRecoveryResults(): void {
  lastRecovery.clear();
}

/** A chat session that never started: no provider session yet, first prompt still saved. */
export function isNeverStarted(row: {
  type: string | null;
  providerSessionId: string | null;
  config: ConversationConfig | null;
}): boolean {
  return (
    row.type === 'acp' &&
    row.providerSessionId === null &&
    row.config?.type === 'acp' &&
    (row.config.initialQueue?.length ?? 0) > 0
  );
}

/** Needs attention first. */
const STATE_ORDER: Record<SessionState, number> = {
  error: 0,
  'never-started': 1,
  'awaiting-input': 2,
  working: 3,
  idle: 4,
  completed: 5,
};

export async function getSessionHealth(
  dependencies: McpToolDependencies,
  input: { projectId?: string; taskId?: string }
): Promise<
  Result<{ summary: Partial<Record<SessionState, number>>; sessions: SessionHealthRow[] }, string>
> {
  const filters: SQL[] = [liveConversations(), isNull(tasks.archivedAt), isNull(tasks.deletedAt)];
  if (input.projectId) filters.push(eq(tasks.projectId, input.projectId));
  if (input.taskId) filters.push(eq(tasks.id, input.taskId));
  const rows = await dependencies.db
    .select({
      projectId: tasks.projectId,
      projectName: projects.name,
      taskId: tasks.id,
      taskName: tasks.name,
      conversationId: conversations.id,
      title: conversations.title,
      provider: conversations.provider,
      type: conversations.type,
      agentStatus: conversations.agentStatus,
      providerSessionId: conversations.providerSessionId,
      config: conversations.config,
      lastSessionActivityAt: conversations.lastSessionActivityAt,
      updatedAt: conversations.updatedAt,
    })
    .from(conversations)
    .innerJoin(tasks, eq(tasks.id, conversations.taskId))
    .leftJoin(projects, eq(projects.id, tasks.projectId))
    .where(and(...filters));

  const sessions = rows.map((row): SessionHealthRow => {
    const recovered = lastRecovery.get(row.conversationId);
    return {
      projectId: row.projectId,
      projectName: row.projectName ?? row.projectId,
      taskId: row.taskId,
      taskName: row.taskName,
      conversationId: row.conversationId,
      title: row.title ?? '',
      provider: row.provider,
      type: row.type === 'acp' ? 'acp' : 'pty',
      state: isNeverStarted(row) ? 'never-started' : ((row.agentStatus ?? 'idle') as AgentStatus),
      lastActivityAt: row.lastSessionActivityAt ?? row.updatedAt,
      ...(recovered && {
        recovery: {
          at: recovered.at,
          status: recovered.outcome.status,
          ...(recovered.outcome.status === 'failed' && { error: recovered.outcome.error }),
        },
      }),
    };
  });
  sessions.sort(
    (a, b) =>
      STATE_ORDER[a.state] - STATE_ORDER[b.state] ||
      b.lastActivityAt.localeCompare(a.lastActivityAt)
  );
  const summary: Partial<Record<SessionState, number>> = {};
  for (const session of sessions) summary[session.state] = (summary[session.state] ?? 0) + 1;
  return ok({ summary, sessions });
}

/**
 * Starts (or resumes) one conversation of an open task: the same start the app does when
 * the task is opened. A never-started chat session sends its saved first prompt; a session
 * that ran before resumes its history. Used by start_conversation and the restart recovery.
 */
export async function startTaskConversation(
  dependencies: McpToolDependencies,
  input: { projectId: string; taskId: string; conversationId: string }
): Promise<Result<{ conversationId: string; started: true }, string>> {
  const [row] = await dependencies.db
    .select({ type: conversations.type, archivedAt: tasks.archivedAt })
    .from(conversations)
    .innerJoin(tasks, eq(tasks.id, conversations.taskId))
    .where(
      and(
        eq(conversations.id, input.conversationId),
        eq(tasks.id, input.taskId),
        eq(tasks.projectId, input.projectId),
        isNull(tasks.deletedAt),
        liveConversations()
      )
    )
    .limit(1);
  if (!row) {
    return err(`Conversation ${input.conversationId} not found in task ${input.taskId}`);
  }
  if (row.archivedAt) return err(`Task ${input.taskId} is archived; restore it first`);
  const type = row.type === 'acp' ? 'acp' : 'pty';
  return withProjectAttachment(dependencies.projects, input.projectId, async () => {
    const started = await dependencies.startInitialConversation({ ...input, type });
    return started.started
      ? ok({ conversationId: input.conversationId, started: true as const })
      : err(`The session did not start: ${started.message ?? 'unknown reason'}`);
  });
}
