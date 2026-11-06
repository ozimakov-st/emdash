// Fork (ozimakov-st): Oleg's vault tickets as an issue source ("OZ Tickets") for new
// tasks. Pure helpers shared by the main process (issue provider, ticket update, PM
// message) and the renderer (prompt block, Tickets board).
import type { LinkedIssue } from '@core/primitives/linked-issues/api';
import type { TaskConfig } from '@core/primitives/tasks/api';
import { isArchived, type TicketSummary } from './tickets';

export const OZ_TICKETS_PROVIDER = 'oz-tickets' satisfies LinkedIssue['provider'];
export const OZ_TICKETS_NAME = 'OZ Tickets';

/** Joins the Goal and the next step in an issue's description. */
const NEXT_STEP_SEPARATOR = '\n\nNext step: ';

/** `file://` URL of an absolute POSIX path (each segment encoded, so `#` and `?` are safe). */
export function fileUrl(path: string): string {
  return `file://${path.split('/').map(encodeURIComponent).join('/')}`;
}

/** The absolute path of a `file://` URL, or null for other URLs. */
export function pathFromFileUrl(url: string): string | null {
  if (!url.startsWith('file://')) return null;
  try {
    return decodeURIComponent(new URL(url).pathname);
  } catch {
    return null;
  }
}

/** `<vault>/tickets/<folder>/ticket.md` */
export function ticketFilePath(vaultPath: string, folder: string): string {
  return `${vaultPath.replace(/\/+$/, '')}/tickets/${folder}/ticket.md`;
}

/** Goal + next step, as the issue description. */
export function ticketIssueDescription(
  ticket: Pick<TicketSummary, 'goal' | 'nextStep'>
): string | undefined {
  const goal = ticket.goal?.trim() ?? '';
  const next = ticket.nextStep?.trim() ?? '';
  if (!next) return goal || undefined;
  return `${goal}${NEXT_STEP_SEPARATOR}${next}`;
}

/** A ticket as an issue: identifier `#<id>`, URL = `file://` path of its ticket.md. */
export function ticketToLinkedIssue(
  ticket: TicketSummary,
  vaultPath: string,
  fetchedAt = new Date().toISOString()
): LinkedIssue {
  const description = ticketIssueDescription(ticket);
  return {
    provider: OZ_TICKETS_PROVIDER,
    identifier: `#${ticket.id}`,
    displayIdentifier: `#${ticket.id}`,
    title: ticket.title,
    url: fileUrl(ticketFilePath(vaultPath, ticket.folder)),
    ...(description && { description }),
    status: ticket.status,
    ...(ticket.updated && { updatedAt: ticket.updated }),
    fetchedAt,
  };
}

/** `#12` or `12` -> `12`. */
export function ticketIdFromIdentifier(identifier: string): string {
  return identifier.trim().replace(/^#/, '');
}

/** Open tickets first, then priority (1 = highest; none last), then id. */
export function compareTicketsForIssues(a: TicketSummary, b: TicketSummary): number {
  const archived = Number(isArchived(a)) - Number(isArchived(b));
  if (archived !== 0) return archived;
  const pa = a.priority ?? Number.MAX_SAFE_INTEGER;
  const pb = b.priority ?? Number.MAX_SAFE_INTEGER;
  if (pa !== pb) return pa - pb;
  return Number(a.id) - Number(b.id) || a.id.localeCompare(b.id);
}

/** What the prompt block needs about a ticket. */
export type TicketPromptRef = {
  id: string;
  title: string;
  /** Absolute path of ticket.md, or null when unknown. */
  path: string | null;
  goal: string | null;
};

/** The ticket behind an OZ Tickets issue, or null for other providers. */
export function ticketRefFromLinkedIssue(
  issue: LinkedIssue | null | undefined
): TicketPromptRef | null {
  if (!issue || issue.provider !== OZ_TICKETS_PROVIDER) return null;
  const id = ticketIdFromIdentifier(issue.identifier);
  if (!id) return null;
  const goal = issue.description?.split(NEXT_STEP_SEPARATOR)[0]?.trim() || null;
  return { id, title: issue.title, path: pathFromFileUrl(issue.url), goal };
}

/** The block appended to the first prompt of a task created from a ticket. */
export function buildTicketPromptBlock(ticket: TicketPromptRef): string {
  return [
    '---',
    `Ticket context (OZdash): you are a child session of ticket #${ticket.id} "${ticket.title}", which Oleg's PM session runs.`,
    ...(ticket.path
      ? [`Ticket file (read it for background, do not edit it): ${ticket.path}`]
      : []),
    '',
    'Goal of the ticket:',
    ticket.goal?.trim() || '(not written yet; see the ticket file)',
    '',
    'Rules:',
    "- Follow this repo's own rules first: its CLAUDE.md / AGENTS.md, .claude settings, skills, and its AI framework. If they conflict with this prompt, stop and ask.",
    '- Work only in this workspace. Do not edit files in other repos or in the ticket vault.',
    '- Never merge, never push to the main or release branches, never release.',
    '- If you need a decision, ask it plainly and stop. Do not guess.',
    '',
    'How to report: end every turn where you stop with these lines, so the PM session can read your status:',
    'STATUS: working | needs-input | blocked | done',
    'QUESTION: <only when needs-input or blocked: one clear question>',
    'PR: <PR URL, when there is one>',
    'SUMMARY: <one or two lines: what changed since your last report>',
  ].join('\n');
}

type InitialConversation = NonNullable<TaskConfig['initialConversation']>;

/**
 * Appends the ticket block to a new task's first prompt. Terminal agents get it at
 * the end of the prompt; chat (ACP) agents get it as hidden context, like issue
 * context. Unchanged when the agent cannot take an initial prompt.
 */
export function appendTicketPromptBlock(
  conversation: InitialConversation,
  block: string,
  options: { initialPromptSupported: boolean }
): InitialConversation {
  if (conversation.type === 'acp') {
    const [first, ...rest] = conversation.initialQueue ?? [];
    if (!first) return { ...conversation, initialQueue: [{ text: block }] };
    const hiddenContext = [first.hiddenContext?.trim(), block].filter(Boolean).join('\n\n');
    return { ...conversation, initialQueue: [{ ...first, hiddenContext }, ...rest] };
  }
  if (!options.initialPromptSupported) return conversation;
  const initialPrompt = [conversation.initialPrompt?.trim(), block].filter(Boolean).join('\n\n');
  return { ...conversation, initialPrompt };
}

/** The prompt as plain text: mentions (`@[label](target)`) become their label. */
export function cleanUserPrompt(prompt: string): string {
  return prompt.replace(/@\[([^\]]*)\]\((?:<[^>]*>|[^)\s]*)\)/g, '$1').trim();
}

export function truncateText(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/** The first non-empty line of the user's prompt, at most `max` characters. */
export function firstPromptLine(prompt: string, max = 80): string {
  const line = cleanUserPrompt(prompt)
    .split(/\r?\n/)
    .map((text) => text.trim())
    .find(Boolean);
  return line ? truncateText(line, max) : '';
}

/** The message a ticket's PM session gets when Oleg links a new task to the ticket. */
export function pmChildMessage(input: {
  taskName: string;
  projectName: string;
  taskId: string;
  ticketId: string;
  prompt: string;
}): string {
  const prompt = truncateText(cleanUserPrompt(input.prompt).replace(/\s+/g, ' '), 300);
  return (
    `New child session ${input.taskName} (project ${input.projectName}, task id ${input.taskId}) ` +
    `was linked to ticket #${input.ticketId} by Oleg. First prompt: "${prompt}". ` +
    'Please record it in the ticket and track it.'
  );
}

/** Sent by the renderer after it created a task from a ticket. */
export type LinkTicketTaskInput = {
  ticketId: string;
  taskId: string;
  taskName: string;
  projectId: string;
  /** What the user typed (without the ticket block). */
  prompt: string;
};

export type LinkTicketTaskResult =
  | { success: true; pmNotified: boolean; warnings: string[] }
  | { success: false; error: string };

/** The New Task dialog props for the board's "New session…" (OZ Tickets pre-selected). */
export function newTicketSessionModalProps(
  ticket: TicketSummary,
  vaultPath: string,
  projectId: string
): { projectId: string; strategy: 'from-issue'; initialIssue: LinkedIssue } {
  return {
    projectId,
    strategy: 'from-issue',
    initialIssue: ticketToLinkedIssue(ticket, vaultPath),
  };
}
