// OZdash: relay status changes of a ticket's sessions to its PM session (rule:
// core/features/ozdash/api/pm-relay.ts). A task belongs to a ticket by its ticket marker
// (MCP create_task) or by an `emdash: <task id>` ref in the ticket file. The PM session
// is the marker's `pmSessionId`, else the ticket file's `pm_session`. The message goes
// through the same path as MCP send_task_message, only to a PM session that exists and
// is not archived. Modes (OZDASH_PM_RELAY): `file` (default) appends the event to
// `<userData>/ticket-events/<ticket id>.jsonl` for `emdash-oz wait`; `type` types the line
// into the PM session; `off`.
import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
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
  createPmEventLog,
  createPmRelay,
  isSafeTicketId,
  PM_RELAY_TICK_MS,
  pmRelayMode,
  relayMessage,
  ticketEvent,
  type DueTransition,
  type RelayTarget,
  type TicketEvent,
} from '@core/features/ozdash/api/pm-relay';
import { ticketByFileRef } from '@core/features/ozdash/api/ticket-sessions';
import type { TicketSummary } from '@core/features/ozdash/api/tickets';
import { projects, tasks } from '@core/services/app-db/node/schema';
import type { AgentStatusService } from '@main/core/agent-status/agent-status-service';

const firstRow = <T>(rows: T[]): T | undefined => rows[0];

/** The task's ticket id and PM session id (marker first, else the ticket file). */
export async function ticketOfTask(
  mcp: McpToolDependencies,
  tickets: readonly TicketSummary[],
  taskId: string
): Promise<{ ticketId?: string; pmTaskId?: string }> {
  const marker = await taskTicketStoreOf(mcp).get(taskId);
  const ticket = marker
    ? (tickets.find((candidate) => candidate.id === marker.id) ?? null)
    : ticketByFileRef(taskId, tickets);
  return {
    ticketId: marker?.id ?? ticket?.id,
    pmTaskId: marker?.pmSessionId || ticket?.pmSession || undefined,
  };
}

/** The task's name and project name, and the conversation's title and provider. */
async function describeTransition(mcp: McpToolDependencies, transition: DueTransition) {
  const task = firstRow(
    await mcp.db
      .select({ name: tasks.name, projectName: projects.name })
      .from(tasks)
      .leftJoin(projects, eq(projects.id, tasks.projectId))
      .where(eq(tasks.id, transition.taskId))
      .limit(1)
  );
  const conversation = firstRow(
    await mcp.db
      .select({ title: conversations.title, provider: conversations.provider })
      .from(conversations)
      .where(eq(conversations.id, transition.conversationId))
      .limit(1)
  );
  return {
    taskName: task?.name ?? transition.taskId,
    projectName: task?.projectName ?? transition.projectId,
    conversationTitle: conversation?.title ?? '',
    provider: conversation?.provider ?? '',
  };
}

/** File mode: the event for a due transition, or null (no ticket, or the PM itself). */
export async function resolveTicketEvent(
  mcp: McpToolDependencies,
  tickets: readonly TicketSummary[],
  transition: DueTransition,
  now: number
): Promise<TicketEvent | null> {
  const { ticketId, pmTaskId } = await ticketOfTask(mcp, tickets, transition.taskId);
  if (!ticketId || pmTaskId === transition.taskId) return null;
  return ticketEvent({ now, ticketId, transition, ...(await describeTransition(mcp, transition)) });
}

/** Appends one event line to `<dir>/<ticket id>.jsonl` (creates the folder). */
export async function appendTicketEvent(dir: string, event: TicketEvent): Promise<void> {
  if (!isSafeTicketId(event.ticket)) throw new Error(`unsafe ticket id: ${event.ticket}`);
  await mkdir(dir, { recursive: true });
  await appendFile(join(dir, `${event.ticket}.jsonl`), `${JSON.stringify(event)}\n`, 'utf8');
}

/** Where a due transition goes: the ticket's live PM session and the message, or null. */
export async function resolveRelayTarget(
  mcp: McpToolDependencies,
  tickets: readonly TicketSummary[],
  transition: DueTransition
): Promise<RelayTarget | null> {
  const { db } = mcp;
  const { ticketId, pmTaskId } = await ticketOfTask(mcp, tickets, transition.taskId);
  if (!ticketId || !pmTaskId || pmTaskId === transition.taskId) return null;

  const pm = firstRow(
    await db
      .select({ projectId: tasks.projectId, archivedAt: tasks.archivedAt })
      .from(tasks)
      .where(and(eq(tasks.id, pmTaskId), isNull(tasks.deletedAt)))
      .limit(1)
  );
  if (!pm || pm.archivedAt) return null;

  const described = await describeTransition(mcp, transition);
  return {
    pm: { projectId: pm.projectId, taskId: pmTaskId },
    message: relayMessage({
      ticketId,
      taskName: described.taskName,
      projectName: described.projectName,
      conversation: described.conversationTitle || described.provider || 'agent',
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
  logger: Pick<Logger, 'info' | 'warn'>,
  /** File mode: the ticket events folder (`<userData>/ticket-events`). */
  eventsDir: string
): () => void {
  const mode = pmRelayMode(process.env);
  if (mode === 'off') {
    logger.info('ozdash pm relay: off (OZDASH_PM_RELAY)');
    return () => {};
  }
  const now = () => Date.now();
  const relay =
    mode === 'file'
      ? createPmEventLog({
          now,
          resolve: (transition) => resolveTicketEvent(mcp, tickets(), transition, now()),
          append: (event) => appendTicketEvent(eventsDir, event),
          logger,
        })
      : createPmRelay({
          now,
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
