// Fork (ozimakov-st): new vault tickets from OZdash ("New ticket" in the PM project,
// "Create ticket from this task"). Pure; no file access.
import { ticketSlug } from '../api/tickets';
import {
  appendLogLine,
  chain,
  formatDate,
  formatDateTime,
  setFrontmatterValue,
  type EditResult,
} from './ticket-editor';
import { findFrontmatter } from './ticket-parser';

/** Used when the vault has no `templates/ticket.md` (same as the vault template). */
export const DEFAULT_TICKET_TEMPLATE = [
  '---',
  'id:',
  'title:',
  'status: parked',
  'priority: 3',
  'needs_oleg: no',
  'next_check:',
  'pm_session:',
  'jira:',
  'created:',
  'updated:',
  '---',
  '',
  '## Goal',
  '',
  '## Requirements',
  '',
  '## Plan',
  '',
  '## Dependencies',
  '| # | Kind | What | Ref | Owner | Status | Last checked | Next check |',
  '|---|------|------|-----|-------|--------|--------------|------------|',
  '',
  '## People',
  '',
  '## Questions for Oleg',
  '',
  '## Decisions',
  '',
  '## Log',
  '',
].join('\n');

/** The next ticket id: the highest `<id>-` folder number (or ticket id) + 1, or 1. */
export function nextTicketId(folders: readonly string[], ids: readonly string[] = []): number {
  let max = 0;
  for (const name of [...folders, ...ids]) {
    const match = /^(\d+)(?:-|$)/.exec(name);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return max + 1;
}

/** The ticket's folder name, for example `12-add-scim-sync`. */
export function ticketFolderName(id: number | string, title: string): string {
  return `${id}-${ticketSlug(title) || 'ticket'}`;
}

/** One line of title text: no line breaks, no extra spaces. */
export function cleanTitle(title: string): string {
  return title.replace(/\s+/g, ' ').trim();
}

/** A YAML double-quoted string (the parser undoes `\\` and `\"`). */
export function quoteYamlString(text: string): string {
  return `"${cleanTitle(text).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** Puts `text` right under the `## <name>` heading (adds the section after the frontmatter if missing). */
export function addSectionText(content: string, name: string, text: string): EditResult {
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const body = text.replace(/\r?\n/g, eol).replace(/\s+$/, '');
  if (!body) return { success: true, content };
  const lines = content.split(eol);
  const heading = new RegExp(`^##\\s+${name}\\s*$`, 'i');
  const index = lines.findIndex((line) => heading.test(line));
  if (index >= 0) {
    lines.splice(index + 1, 0, body);
    // Keep a blank line before the next heading.
    if (/^#{1,2}\s/.test(lines[index + 2] ?? '')) lines.splice(index + 2, 0, '');
    return { success: true, content: lines.join(eol) };
  }
  const block = findFrontmatter(lines);
  if (!block) return { success: false, error: 'the ticket has no frontmatter' };
  lines.splice(block.end + 1, 0, '', `## ${name}`, body);
  return { success: true, content: lines.join(eol) };
}

export type NewTicketInput = {
  id: number;
  title: string;
  /** Goes under `## Goal`; may be empty. */
  description: string;
  /** The PM session task id, or empty. */
  pmSession: string;
  /**
   * Set when the ticket starts with a session ("Create ticket from this task"): the
   * ticket is `active` and the Log gets `Started (<startedBy>)`. Else it is `parked`.
   */
  startedBy?: string;
  now: Date;
};

/** The `ticket.md` text of a new ticket, from the vault template (or the default one). */
export function newTicketContent(template: string | null, input: NewTicketInput): EditResult {
  const today = formatDate(input.now);
  const steps: Array<(text: string) => EditResult> = [
    (text) => setFrontmatterValue(text, 'id', String(input.id)),
    (text) => setFrontmatterValue(text, 'title', quoteYamlString(input.title)),
    (text) => setFrontmatterValue(text, 'status', input.startedBy ? 'active' : 'parked'),
    (text) => setFrontmatterValue(text, 'priority', '3'),
    (text) => setFrontmatterValue(text, 'needs_oleg', 'no'),
    (text) => setFrontmatterValue(text, 'next_check', ''),
    (text) => setFrontmatterValue(text, 'pm_session', input.pmSession),
    (text) => setFrontmatterValue(text, 'created', today),
    (text) => setFrontmatterValue(text, 'updated', today),
    (text) => addSectionText(text, 'Goal', input.description.trim()),
    (text) => appendLogLine(text, `- ${formatDateTime(input.now)}: Created in OZdash`),
  ];
  if (input.startedBy) {
    const line = `- ${formatDateTime(input.now)}: Started (${input.startedBy})`;
    steps.push((text) => appendLogLine(text, line));
  }
  return chain(template?.trim() ? template : DEFAULT_TICKET_TEMPLATE, steps);
}

/** Links a PM session to the ticket: `pm_session:`, today's `updated:`, and a Log line. */
export function linkPmSessionContent(
  content: string,
  taskId: string,
  taskName: string,
  now: Date
): EditResult {
  return chain(content, [
    (text) => setFrontmatterValue(text, 'pm_session', taskId),
    (text) => setFrontmatterValue(text, 'updated', formatDate(now)),
    (text) =>
      appendLogLine(text, `- ${formatDateTime(now)}: PM session ${taskName} linked in OZdash`),
  ]);
}
