// Fork (ozimakov-st): what happens after Oleg created a task from an OZ ticket in the
// New Task dialog: mark the task with the ticket, record it in the ticket file (then
// vault sync), and tell the ticket's PM session when that session is running.
import type { Logger } from '@emdash/shared/logger';
import type { TaskTicket } from '@core/features/mcp/api/ozdash-task-ticket';
import {
  firstPromptLine,
  pmChildMessage,
  type LinkTicketTaskInput,
  type LinkTicketTaskResult,
} from '../api/ticket-issues';
import type { TicketsService } from './tickets-service';

export type SendResult = { success: true } | { success: false; error: string };

export type LinkTicketTaskDependencies = {
  tickets: Pick<TicketsService, 'findTicket' | 'linkChildTask'>;
  /** Saves the task's ticket marker (the store MCP create_task uses). */
  setMarker(taskId: string, ticket: TaskTicket): Promise<void>;
  /** The project's display name, or null when unknown. */
  projectName(projectId: string): Promise<string | null>;
  /** The project of a task that exists (not deleted), or null. */
  taskProject(taskId: string): Promise<string | null>;
  /** MCP send_task_message: fails when the task's conversation is not running. */
  sendMessage(input: { projectId: string; taskId: string; message: string }): Promise<SendResult>;
  logger: Logger;
};

export type PmNotifyOutcome = { kind: 'sent' } | { kind: 'skipped'; reason: string };

/** Sends `message` to the ticket's PM session, only when it exists and its agent runs. */
export async function notifyPmSession(
  dependencies: Pick<LinkTicketTaskDependencies, 'taskProject' | 'sendMessage'>,
  input: { pmSession: string | null; childTaskId: string; message: string }
): Promise<PmNotifyOutcome> {
  const { pmSession } = input;
  if (!pmSession) return { kind: 'skipped', reason: 'the ticket has no pm_session' };
  if (pmSession === input.childTaskId) {
    return { kind: 'skipped', reason: 'the new task is the PM session' };
  }
  const projectId = await dependencies.taskProject(pmSession);
  if (!projectId) return { kind: 'skipped', reason: `PM session ${pmSession} does not exist` };
  const sent = await dependencies.sendMessage({
    projectId,
    taskId: pmSession,
    message: input.message,
  });
  if (!sent.success) return { kind: 'skipped', reason: `PM session not running: ${sent.error}` };
  return { kind: 'sent' };
}

export async function linkTicketTask(
  dependencies: LinkTicketTaskDependencies,
  input: LinkTicketTaskInput
): Promise<LinkTicketTaskResult> {
  const { logger } = dependencies;
  const warnings: string[] = [];
  const ticket = await dependencies.tickets.findTicket(input.ticketId).catch((error: unknown) => {
    logger.warn('ozdash tickets: could not read the vault', { error: String(error) });
    return null;
  });

  try {
    await dependencies.setMarker(input.taskId, {
      id: input.ticketId,
      ...(ticket?.title && { title: ticket.title.slice(0, 200) }),
      ...(ticket?.pmSession && { pmSessionId: ticket.pmSession.slice(0, 64) }),
    });
  } catch (error) {
    warnings.push(`The task was not marked with the ticket: ${String(error)}`);
  }
  if (!ticket) {
    return { success: false, error: `Ticket #${input.ticketId} was not found in the vault` };
  }

  const projectName = (await dependencies.projectName(input.projectId)) ?? input.projectId;
  const updated = await dependencies.tickets.linkChildTask(ticket.folder, {
    taskId: input.taskId,
    taskName: input.taskName,
    projectName,
    promptLine: firstPromptLine(input.prompt),
  });
  if (!updated.success) warnings.push(`Ticket #${ticket.id} was not updated: ${updated.error}`);
  else if (updated.warning) warnings.push(updated.warning);

  const notified = await notifyPmSession(dependencies, {
    pmSession: ticket.pmSession,
    childTaskId: input.taskId,
    message: pmChildMessage({
      taskName: input.taskName,
      projectName,
      taskId: input.taskId,
      ticketId: ticket.id,
      prompt: input.prompt,
    }),
  }).catch((error: unknown): PmNotifyOutcome => ({ kind: 'skipped', reason: String(error) }));
  if (notified.kind === 'skipped') {
    logger.info('ozdash tickets: PM session not notified', {
      ticketId: ticket.id,
      reason: notified.reason,
    });
  }
  if (warnings.length > 0) {
    logger.warn('ozdash tickets: linking a task to a ticket had problems', { warnings });
  }
  return { success: true, pmNotified: notified.kind === 'sent', warnings };
}
