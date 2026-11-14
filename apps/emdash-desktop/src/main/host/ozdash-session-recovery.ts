// OZdash: session recovery after a restart (rules: core/features/ozdash/api/session-recovery.ts).
// Runs once, in the background, a little after boot. Off with OZDASH_SESSION_RECOVERY=off.
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { err, ok } from '@emdash/shared';
import { createConcurrencyLimiter } from '@emdash/shared/concurrency';
import type { Logger } from '@emdash/shared/logger';
import { and, eq, isNull } from 'drizzle-orm';
import {
  conversationRegistryTable as conversations,
  liveConversations,
} from '@core/features/conversations/api/node/registry';
import { withProjectAttachment } from '@core/features/mcp/node/server/attach-project';
import type { McpToolDependencies } from '@core/features/mcp/node/server/dependencies';
import {
  isNeverStarted,
  recordRecoveryResult,
  startTaskConversation,
} from '@core/features/mcp/node/server/session-health';
import { sendTaskMessage } from '@core/features/mcp/node/server/task-conversation';
import { isSafeTicketId } from '@core/features/ozdash/api/pm-relay';
import {
  continueMessage,
  NEVER_STARTED_MAX_AGE_MS,
  pmRecoveryNote,
  PTY_READY_DELAY_MS,
  RECOVERY_CONCURRENCY,
  RECOVERY_DELAY_MS,
  splitRecovery,
  ticketsToNotify,
  type RecoveryCandidate,
  type RecoveryOutcome,
  type RecoveryResult,
} from '@core/features/ozdash/api/session-recovery';
import type { TicketSummary } from '@core/features/ozdash/api/tickets';
import { tasks } from '@core/services/app-db/node/schema';
import { ticketOfTask } from './ozdash-pm-relay';

/** SQLite's CURRENT_TIMESTAMP has no zone marker; it is UTC. */
function toMillis(timestamp: string): number {
  const iso = /[zZ]|[+-]\d\d:?\d\d$/u.test(timestamp)
    ? timestamp
    : `${timestamp.replace(' ', 'T')}Z`;
  const millis = Date.parse(iso);
  return Number.isNaN(millis) ? 0 : millis;
}

/** Interrupted sessions (by id) and recent never-started ones, in open tasks. */
export async function collectRecoveryCandidates(
  mcp: McpToolDependencies,
  tickets: readonly TicketSummary[],
  interruptedIds: readonly string[],
  now: number
): Promise<RecoveryCandidate[]> {
  const interrupted = new Set(interruptedIds);
  const rows = await mcp.db
    .select({
      conversationId: conversations.id,
      projectId: tasks.projectId,
      taskId: tasks.id,
      taskName: tasks.name,
      title: conversations.title,
      provider: conversations.provider,
      type: conversations.type,
      location: conversations.location,
      providerSessionId: conversations.providerSessionId,
      config: conversations.config,
      createdAt: conversations.createdAt,
    })
    .from(conversations)
    .innerJoin(tasks, eq(tasks.id, conversations.taskId))
    .where(and(liveConversations(), isNull(tasks.archivedAt), isNull(tasks.deletedAt)));

  const candidates: RecoveryCandidate[] = [];
  for (const row of rows) {
    if (row.location !== 'local') continue;
    const kind = interrupted.has(row.conversationId)
      ? 'interrupted'
      : isNeverStarted(row) && now - toMillis(row.createdAt) <= NEVER_STARTED_MAX_AGE_MS
        ? 'never-started'
        : null;
    if (!kind) continue;
    const { ticketId, pmTaskId } = await ticketOfTask(mcp, tickets, row.taskId);
    candidates.push({
      kind,
      projectId: row.projectId,
      taskId: row.taskId,
      taskName: row.taskName,
      conversationId: row.conversationId,
      title: row.title ?? '',
      provider: row.provider ?? '',
      type: row.type === 'acp' ? 'acp' : 'pty',
      ticketId: ticketId ?? null,
      isPm: pmTaskId !== undefined && pmTaskId === row.taskId,
    });
  }
  return candidates;
}

export type RecoveryPlanDeps = {
  now(): number;
  /** Resumes the session and sends it `message`. */
  resume(candidate: RecoveryCandidate, message: string): Promise<RecoveryOutcome>;
  /** Called once per result, as soon as it is known. */
  record(result: RecoveryResult): Promise<void>;
  /** A recovery note for a ticket whose PM was not interrupted. */
  notifyTicket(ticketId: string, note: string): Promise<void>;
  concurrency?: number;
};

/**
 * Children first (at most `concurrency` at a time), then never-started ones (not started),
 * then the PMs with their ticket's note, then a ticket event for tickets whose PM was idle.
 */
export async function runRecoveryPlan(
  candidates: readonly RecoveryCandidate[],
  deps: RecoveryPlanDeps
): Promise<RecoveryResult[]> {
  const restartedAt = `${new Date(deps.now()).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
  const { children, pms, neverStarted } = splitRecovery(candidates);
  const limiter = createConcurrencyLimiter(deps.concurrency ?? RECOVERY_CONCURRENCY);
  const signal = new AbortController().signal;
  const results: RecoveryResult[] = [];
  const settle = async (candidate: RecoveryCandidate, outcome: RecoveryOutcome) => {
    const result = { ...candidate, at: new Date(deps.now()).toISOString(), outcome };
    results.push(result);
    await deps.record(result);
  };
  const resume = async (candidate: RecoveryCandidate, message: string) => {
    let outcome: RecoveryOutcome;
    try {
      outcome = await deps.resume(candidate, message);
    } catch (error) {
      outcome = { status: 'failed', error: String(error) };
    }
    await settle(candidate, outcome);
  };

  const base = continueMessage(restartedAt);
  await Promise.all(children.map((c) => limiter.run(signal, () => resume(c, base))));
  for (const candidate of neverStarted) await settle(candidate, { status: 'not-started' });
  await Promise.all(
    pms.map((pm) =>
      limiter.run(signal, () => {
        const note = pm.ticketId ? pmRecoveryNote(pm.ticketId, restartedAt, results) : null;
        return resume(pm, note ? `${base}\n\n${note}` : base);
      })
    )
  );
  const pmTickets = new Set(pms.map((pm) => pm.ticketId));
  for (const ticketId of ticketsToNotify(results)) {
    if (pmTickets.has(ticketId)) continue;
    const note = pmRecoveryNote(ticketId, restartedAt, results);
    if (note) await deps.notifyTicket(ticketId, note);
  }
  return results;
}

/** Resume one session in its project and send it the message (holds one project lease). */
async function resumeAndSend(
  mcp: McpToolDependencies,
  candidate: RecoveryCandidate,
  message: string,
  ptyReadyDelayMs: number
): Promise<RecoveryOutcome> {
  const target = {
    projectId: candidate.projectId,
    taskId: candidate.taskId,
    conversationId: candidate.conversationId,
  };
  const done = await withProjectAttachment(mcp.projects, candidate.projectId, async () => {
    const started = await startTaskConversation(mcp, target);
    if (!started.success) return started;
    if (candidate.type === 'pty' && ptyReadyDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, ptyReadyDelayMs));
    }
    const sent = await sendTaskMessage(mcp, { ...target, message });
    return sent.success
      ? ok(undefined)
      : err(`resumed, but the continue message failed: ${sent.error}`);
  });
  return done.success ? { status: 'continued' } : { status: 'failed', error: done.error };
}

async function appendLine(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(value)}\n`, 'utf8');
}

export type OzdashSessionRecoveryOptions = {
  mcp: McpToolDependencies;
  tickets: () => readonly TicketSummary[];
  interruptedIds: readonly string[];
  logger: Pick<Logger, 'info' | 'warn'>;
  /** `<userData>/logs/ozdash-recovery.jsonl` */
  journalPath: string;
  /** `<userData>/ticket-events` */
  eventsDir: string;
  delayMs?: number;
  ptyReadyDelayMs?: number;
};

/** The whole recovery, wired to the app (main/bootstrap/boot/phases/services.ts). */
export async function runOzdashSessionRecovery(
  options: OzdashSessionRecoveryOptions
): Promise<RecoveryResult[]> {
  const { mcp, logger, journalPath } = options;
  if (process.env.OZDASH_SESSION_RECOVERY === 'off') {
    logger.info('ozdash recovery: off (OZDASH_SESSION_RECOVERY)');
    return [];
  }
  await new Promise((resolve) => setTimeout(resolve, options.delayMs ?? RECOVERY_DELAY_MS));
  const candidates = await collectRecoveryCandidates(
    mcp,
    options.tickets(),
    options.interruptedIds,
    Date.now()
  );
  if (candidates.length === 0) return [];
  logger.warn('ozdash recovery: resuming sessions after a restart', {
    interrupted: candidates.filter((c) => c.kind === 'interrupted').length,
    neverStarted: candidates.filter((c) => c.kind === 'never-started').length,
  });
  const results = await runRecoveryPlan(candidates, {
    now: Date.now,
    resume: (candidate, message) =>
      resumeAndSend(mcp, candidate, message, options.ptyReadyDelayMs ?? PTY_READY_DELAY_MS),
    record: async (result) => {
      recordRecoveryResult(result);
      if (result.outcome.status === 'failed') {
        logger.warn('ozdash recovery: could not resume a session', {
          taskId: result.taskId,
          conversationId: result.conversationId,
          error: result.outcome.error,
        });
      }
      await appendLine(journalPath, result).catch((error: unknown) =>
        logger.warn('ozdash recovery: could not write the journal', { error: String(error) })
      );
    },
    notifyTicket: async (ticketId, note) => {
      if (!isSafeTicketId(ticketId)) return;
      await appendLine(join(options.eventsDir, `${ticketId}.jsonl`), {
        ts: new Date().toISOString(),
        ticket: ticketId,
        status: 'message',
        message: note,
        taskName: 'OZdash recovery',
        taskId: null,
      });
    },
  });
  const count = (status: RecoveryOutcome['status']) =>
    results.filter((r) => r.outcome.status === status).length;
  logger.warn('ozdash recovery: done', {
    continued: count('continued'),
    notStarted: count('not-started'),
    failed: count('failed'),
  });
  return results;
}
