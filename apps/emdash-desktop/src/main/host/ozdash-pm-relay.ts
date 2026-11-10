// OZdash: relay status changes of a ticket's sessions to its PM session (rule:
// core/features/ozdash/api/pm-relay.ts). A task belongs to a ticket by its ticket marker
// (MCP create_task) or by an `emdash: <task id>` ref in the ticket file. The PM session
// is the marker's `pmSessionId`, else the ticket file's `pm_session`. The message goes
// through the same path as MCP send_task_message, only to a PM session that exists and
// is not archived. Turn off with OZDASH_PM_RELAY=off.
import type { Logger } from '@emdash/shared/logger';
import { and, eq, isNull } from 'drizzle-orm';
import {
  conversationRegistryTable as conversations,
  liveConversations,
} from '@core/features/conversations/api/node/registry';
import type { McpToolDependencies } from '@core/features/mcp/node/server/dependencies';
import { taskTicketStoreOf } from '@core/features/mcp/node/server/ozdash-task-ticket-store';
import { sendTaskMessage } from '@core/features/mcp/node/server/task-conversation';
import {
  createPmRelay,
  PM_RELAY_TICK_MS,
  pmRelayEnabled,
  relayMessage,
  type DueTransition,
  type RelayTarget,
} from '@core/features/ozdash/api/pm-relay';
import { ticketByFileRef } from '@core/features/ozdash/api/ticket-sessions';
import type { TicketSummary } from '@core/features/ozdash/api/tickets';
import { projects, tasks } from '@core/services/app-db/node/schema';
import type { AgentStatusService } from '@main/core/agent-status/agent-status-service';

const firstRow = <T>(rows: T[]): T | undefined => rows[0];

/** Where a due transition goes: the ticket's live PM session and the message, or null. */
export async function resolveRelayTarget(
  mcp: McpToolDependencies,
  tickets: readonly TicketSummary[],
  transition: DueTransition
): Promise<RelayTarget | null> {
  const { db } = mcp;
  const marker = await taskTicketStoreOf(mcp).get(transition.taskId);
  const ticket = marker
    ? (tickets.find((candidate) => candidate.id === marker.id) ?? null)
    : ticketByFileRef(transition.taskId, tickets);
  const ticketId = marker?.id ?? ticket?.id;
  const pmTaskId = marker?.pmSessionId || ticket?.pmSession;
  if (!ticketId || !pmTaskId || pmTaskId === transition.taskId) return null;

  const pm = firstRow(
    await db
      .select({ projectId: tasks.projectId, archivedAt: tasks.archivedAt })
      .from(tasks)
      .where(and(eq(tasks.id, pmTaskId), isNull(tasks.deletedAt)))
      .limit(1)
  );
  if (!pm || pm.archivedAt) return null;

  const task = firstRow(
    await db
      .select({ name: tasks.name, projectName: projects.name })
      .from(tasks)
      .leftJoin(projects, eq(projects.id, tasks.projectId))
      .where(eq(tasks.id, transition.taskId))
      .limit(1)
  );
  const conversation = firstRow(
    await db
      .select({ title: conversations.title, provider: conversations.provider })
      .from(conversations)
      .where(eq(conversations.id, transition.conversationId))
      .limit(1)
  );
  return {
    pm: { projectId: pm.projectId, taskId: pmTaskId },
    message: relayMessage({
      ticketId,
      taskName: task?.name ?? transition.taskId,
      projectName: task?.projectName ?? transition.projectId,
      conversation: conversation?.title || conversation?.provider || 'agent',
      status: transition.status,
      taskId: transition.taskId,
      conversationId: transition.conversationId,
    }),
  };
}

/** True while one of the PM task's conversations is working. */
async function pmBusy(mcp: McpToolDependencies, pm: RelayTarget['pm']): Promise<boolean> {
  const rows = await mcp.db
    .select({ agentStatus: conversations.agentStatus })
    .from(conversations)
    .where(and(eq(conversations.taskId, pm.taskId), liveConversations()));
  return rows.some((row) => row.agentStatus === 'working');
}

/** Wires the relay to the app (main/bootstrap/boot/phases/services.ts). */
export function installOzdashPmRelay(
  mcp: McpToolDependencies,
  agentStatus: Pick<AgentStatusService, 'on'>,
  tickets: () => readonly TicketSummary[],
  logger: Pick<Logger, 'info' | 'warn'>
): () => void {
  if (!pmRelayEnabled(process.env)) {
    logger.info('ozdash pm relay: off (OZDASH_PM_RELAY)');
    return () => {};
  }
  const relay = createPmRelay({
    now: () => Date.now(),
    resolve: (transition) => resolveRelayTarget(mcp, tickets(), transition),
    pmBusy: (pm) => pmBusy(mcp, pm),
    send: async (pm, message) => {
      const sent = await sendTaskMessage(mcp, { ...pm, message });
      return sent.success ? { success: true } : { success: false, error: sent.error };
    },
    logger,
  });
  const unsubscribe = agentStatus.on('agent:event', (event) => relay.onAgentEvent(event));
  let ticking = false;
  const timer = setInterval(() => {
    if (ticking) return;
    ticking = true;
    void relay
      .tick()
      .catch((error: unknown) => logger.warn('ozdash pm relay: failed', { error: String(error) }))
      .finally(() => {
        ticking = false;
      });
  }, PM_RELAY_TICK_MS);
  timer.unref?.();
  return () => {
    clearInterval(timer);
    unsubscribe();
  };
}
