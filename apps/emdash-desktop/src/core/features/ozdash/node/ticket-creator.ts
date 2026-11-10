// Fork (ozimakov-st): new vault tickets from OZdash ("New ticket" in the PM project,
// "Create ticket from this task") and "Edit ticket". Pure; no file access.
import {
  DEFAULT_PRIORITY,
  effectivePriority,
  ticketSlug,
  type EditableTicketFields,
  type TicketSummary,
} from '../api/tickets';
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
  /** 1-4; missing = 3. */
  priority?: number;
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
    (text) => setFrontmatterValue(text, 'priority', String(input.priority ?? DEFAULT_PRIORITY)),
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

/** Goal text as the parser reads it: `\n` line breaks, no blank lines or spaces around it. */
export function normalizeGoal(text: string): string {
  return text.replace(/\r\n?/g, '\n').trim();
}

/**
 * Replaces the text of the `## <name>` section with `text` (empty clears it). Blank
 * lines around the old text and every other line stay. Adds the section when missing.
 */
export function replaceSectionText(content: string, name: string, text: string): EditResult {
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const body = normalizeGoal(text).replace(/\n/g, eol);
  const lines = content.split(eol);
  const heading = new RegExp(`^##\\s+${name}\\s*$`, 'i');
  const index = lines.findIndex((line) => heading.test(line));
  if (index < 0) return addSectionText(content, name, body);
  let end = lines.length;
  for (let at = index + 1; at < lines.length; at += 1) {
    if (/^#{1,2}\s/.test(lines[at]!)) {
      end = at;
      break;
    }
  }
  let first = -1;
  let last = -1;
  for (let at = index + 1; at < end; at += 1) {
    if (lines[at]!.trim() === '') continue;
    if (first < 0) first = at;
    last = at;
  }
  if (first < 0) return addSectionText(content, name, body); // Empty section.
  lines.splice(first, last - first + 1, ...(body ? body.split(eol) : []));
  return { success: true, content: lines.join(eol) };
}

export type EditedField = 'title' | 'goal' | 'priority';

/** The fields whose new value differs from the ticket (title cleaned, Goal normalized). */
export function editedFields(
  ticket: Pick<TicketSummary, 'title' | 'goal' | 'priority'>,
  values: EditableTicketFields
): EditedField[] {
  const fields: EditedField[] = [];
  if (cleanTitle(values.title) !== ticket.title) fields.push('title');
  if (normalizeGoal(values.goal) !== (ticket.goal ?? '')) fields.push('goal');
  if (values.priority !== effectivePriority(ticket.priority)) fields.push('priority');
  return fields;
}

/**
 * "Edit ticket": rewrites only the changed fields in place (`title:`, the `## Goal` text,
 * `priority:`; a `rank:` is cleared when the priority changes, as with ▲/▼), today's
 * `updated:`, and the Log line `Edited in OZdash (<fields>)`. No change = same content.
 */
export function editTicketContent(
  content: string,
  ticket: Pick<TicketSummary, 'title' | 'goal' | 'priority' | 'rank'>,
  values: EditableTicketFields,
  now: Date
): EditResult {
  const fields = editedFields(ticket, values);
  if (fields.length === 0) return { success: true, content };
  const steps: Array<(text: string) => EditResult> = [];
  if (fields.includes('title'))
    steps.push((text) => setFrontmatterValue(text, 'title', quoteYamlString(values.title)));
  if (fields.includes('priority')) {
    steps.push((text) => setFrontmatterValue(text, 'priority', String(values.priority)));
    if (ticket.rank !== null) steps.push((text) => setFrontmatterValue(text, 'rank', ''));
  }
  if (fields.includes('goal')) steps.push((text) => replaceSectionText(text, 'Goal', values.goal));
  steps.push(
    (text) => setFrontmatterValue(text, 'updated', formatDate(now)),
    (text) =>
      appendLogLine(text, `- ${formatDateTime(now)}: Edited in OZdash (${fields.join(', ')})`)
  );
  return chain(content, steps);
}
