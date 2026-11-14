// OZdash: what happens to agent sessions after the app restarts (runner:
// main/host/ozdash-session-recovery.ts). At start the app suspends every session and starts
// none, so an agent that was working, or one that never started, would stay silent.
//
// - Interrupted (working or waiting when the app stopped): resume it and tell it to continue.
// - Never started (no provider session, its first prompt is still saved): do not start it; it
//   may be out of date or replaced. The ticket's PM decides: MCP start_conversation, or archive.
// - Each ticket's PM gets one recovery note: in its continue message when the PM itself was
//   interrupted, otherwise as a ticket event that `emdash-oz wait` prints.
// Every result is one line in `<userData>/logs/ozdash-recovery.jsonl`.

/** Wait after boot so runtimes and the tickets snapshot are ready. */
export const RECOVERY_DELAY_MS = 15_000;
/** At most this many sessions start at the same time. */
export const RECOVERY_CONCURRENCY = 3;
/** Never-started sessions older than this are no longer reported. */
export const NEVER_STARTED_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
/** A terminal agent needs a moment after its start before it reads typed input. */
export const PTY_READY_DELAY_MS = 10_000;
export const RECOVERY_JOURNAL_FILE = 'ozdash-recovery.jsonl';

export type RecoveryKind = 'interrupted' | 'never-started';

export type RecoveryCandidate = Readonly<{
  kind: RecoveryKind;
  projectId: string;
  taskId: string;
  taskName: string;
  conversationId: string;
  title: string;
  provider: string;
  type: 'acp' | 'pty';
  ticketId: string | null;
  /** True when the task is its ticket's PM session. */
  isPm: boolean;
}>;

export type RecoveryOutcome =
  | { status: 'continued' }
  | { status: 'not-started' }
  | { status: 'failed'; error: string };

export type RecoveryResult = RecoveryCandidate & { at: string; outcome: RecoveryOutcome };

/** Children first, then PMs (their note lists the children's results). */
export function splitRecovery(candidates: readonly RecoveryCandidate[]) {
  return {
    children: candidates.filter((c) => c.kind === 'interrupted' && !c.isPm),
    pms: candidates.filter((c) => c.kind === 'interrupted' && c.isPm),
    neverStarted: candidates.filter((c) => c.kind === 'never-started'),
  };
}

export function continueMessage(restartedAt: string): string {
  return (
    `[OZdash] The app restarted at ${restartedAt} while you were working, so your last turn ` +
    'was cut off. Commands and background agents you started then are gone. Check where you ' +
    'stopped (files, git status, the last messages) and continue the task. If you were ' +
    'waiting for background agents or watchers, start them again.'
  );
}

function label(result: RecoveryResult): string {
  const who = result.title || result.provider || 'agent';
  return `${result.taskName} / ${who}`;
}

/**
 * The PM's recovery note for one ticket, from the results of the ticket's other sessions;
 * null when there is nothing to report.
 */
export function pmRecoveryNote(
  ticketId: string,
  restartedAt: string,
  results: readonly RecoveryResult[]
): string | null {
  const children = results.filter((r) => r.ticketId === ticketId && !r.isPm);
  if (children.length === 0) return null;
  const continued = children.filter((r) => r.outcome.status === 'continued');
  const notStarted = children.filter((r) => r.outcome.status === 'not-started');
  const failed = children.filter((r) => r.outcome.status === 'failed');
  const lines = [`[OZdash] Recovery for ticket #${ticketId} after the restart at ${restartedAt}:`];
  if (continued.length > 0) {
    lines.push(`- Continued (told to go on): ${continued.map(label).join('; ')}`);
  }
  if (notStarted.length > 0) {
    lines.push(
      '- Never started (first prompt saved). Decide for each: start it with the MCP tool ' +
        'start_conversation, or archive it if it is out of date:'
    );
    for (const r of notStarted) {
      lines.push(
        `  - ${label(r)} (projectId ${r.projectId}, taskId ${r.taskId}, ` +
          `conversationId ${r.conversationId})`
      );
    }
  }
  if (failed.length > 0) {
    lines.push('- Could not resume:');
    for (const r of failed) {
      lines.push(`  - ${label(r)}: ${r.outcome.status === 'failed' ? r.outcome.error : ''}`);
    }
  }
  lines.push('Details: MCP get_session_health.');
  return lines.join('\n');
}

/** Ticket ids that have something to report, in first-seen order. */
export function ticketsToNotify(results: readonly RecoveryResult[]): string[] {
  const ids: string[] = [];
  for (const r of results) {
    if (r.ticketId && !r.isPm && !ids.includes(r.ticketId)) ids.push(r.ticketId);
  }
  return ids;
}
