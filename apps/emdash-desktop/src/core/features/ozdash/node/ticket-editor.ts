// Fork (ozimakov-st): in-place edits of a vault `ticket.md`. Only the touched
// frontmatter lines and the new Log line change; every other byte stays as it was.
import { findFrontmatter, parseFrontmatterLine } from './ticket-parser';

/** Frontmatter keys in the order the vault format lists them. */
const KEY_ORDER = [
  'id',
  'title',
  'status',
  'priority',
  'needs_oleg',
  'next_check',
  'pm_session',
  'jira',
  'created',
  'updated',
];

export type EditResult = { success: true; content: string } | { success: false; error: string };

type Line = { text: string; eol: string };

function toLines(content: string): Line[] {
  const parts = content.split('\n');
  const lines = parts.map((part, index): Line => {
    if (index === parts.length - 1) return { text: part, eol: '' };
    return part.endsWith('\r')
      ? { text: part.slice(0, -1), eol: '\r\n' }
      : { text: part, eol: '\n' };
  });
  // A file that ends with a newline has no extra empty last line.
  if (lines.length > 0 && lines[lines.length - 1]!.text === '') lines.pop();
  return lines;
}

function fromLines(lines: readonly Line[]): string {
  return lines.map((line) => line.text + line.eol).join('');
}

/** The line ending the file mostly uses, for new lines. */
function defaultEol(lines: readonly Line[]): string {
  return lines.some((line) => line.eol === '\r\n') ? '\r\n' : '\n';
}

/**
 * Sets one frontmatter value. An existing line keeps its spacing and its trailing
 * ` # comment`; a missing key is added after the key before it in the vault order.
 */
export function setFrontmatterValue(content: string, key: string, value: string): EditResult {
  const lines = toLines(content);
  const block = findFrontmatter(lines.map((line) => line.text));
  if (!block) return { success: false, error: 'the ticket has no frontmatter' };

  for (let index = 1; index < block.end; index += 1) {
    const line = lines[index]!;
    const parsed = parseFrontmatterLine(line.text);
    if (parsed?.key !== key) continue;
    const match = /^([^:]*:)(\s*)(.*?)(\s+#.*)?$/.exec(line.text)!;
    const spacing = match[2] || ' ';
    const comment = key === 'title' ? '' : (match[4] ?? '');
    const text = value === '' ? `${match[1]}${comment}` : `${match[1]}${spacing}${value}${comment}`;
    lines[index] = { ...line, text };
    return { success: true, content: fromLines(lines) };
  }

  // Missing key: insert after the closest earlier key that exists, else before `---`.
  const order = KEY_ORDER.indexOf(key);
  let insertAt = block.end;
  if (order > 0) {
    for (let index = block.end - 1; index >= 1; index -= 1) {
      const parsed = parseFrontmatterLine(lines[index]!.text);
      const position = parsed ? KEY_ORDER.indexOf(parsed.key) : -1;
      if (position >= 0 && position < order) {
        insertAt = index + 1;
        break;
      }
    }
  }
  const eol = lines[block.start]!.eol || defaultEol(lines);
  lines.splice(insertAt, 0, { text: value === '' ? `${key}:` : `${key}: ${value}`, eol });
  return { success: true, content: fromLines(lines) };
}

/** Appends `line` at the end of the `## Log` section (adds the section when missing). */
export function appendLogLine(content: string, line: string): EditResult {
  const lines = toLines(content);
  const eol = defaultEol(lines);
  const logIndex = lines.findIndex((entry) => /^##\s+Log\s*$/i.test(entry.text));
  if (logIndex < 0) {
    const last = lines[lines.length - 1];
    if (last && last.eol === '') last.eol = eol;
    const needsGap = lines.length > 0 && lines[lines.length - 1]!.text.trim() !== '';
    if (needsGap) lines.push({ text: '', eol });
    lines.push({ text: '## Log', eol }, { text: line, eol });
    return { success: true, content: fromLines(lines) };
  }

  let sectionEnd = lines.length;
  for (let index = logIndex + 1; index < lines.length; index += 1) {
    if (/^#{1,2}\s/.test(lines[index]!.text)) {
      sectionEnd = index;
      break;
    }
  }
  // After the last non-blank line of the section, so blank lines before the next
  // heading (or the end of the file) stay where they are.
  let lastContent = logIndex;
  for (let index = logIndex + 1; index < sectionEnd; index += 1) {
    if (lines[index]!.text.trim() !== '') lastContent = index;
  }
  const previous = lines[lastContent]!;
  if (previous.eol === '') {
    previous.eol = eol;
    lines.splice(lastContent + 1, 0, { text: line, eol: '' });
  } else {
    lines.splice(lastContent + 1, 0, { text: line, eol });
  }
  return { success: true, content: fromLines(lines) };
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** `YYYY-MM-DD` in local time. */
export function formatDate(now: Date): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** `YYYY-MM-DD HH:MM` in local time. */
export function formatDateTime(now: Date): string {
  return `${formatDate(now)} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function chain(content: string, edits: Array<(content: string) => EditResult>): EditResult {
  let current = content;
  for (const edit of edits) {
    const result = edit(current);
    if (!result.success) return result;
    current = result.content;
  }
  return { success: true, content: current };
}

/** Restore from the archive: `status: active`, today's `updated:`, and a Log line. */
export function restoreTicketContent(content: string, now: Date): EditResult {
  return chain(content, [
    (text) => setFrontmatterValue(text, 'status', 'active'),
    (text) => setFrontmatterValue(text, 'updated', formatDate(now)),
    (text) => appendLogLine(text, `- ${formatDateTime(now)}: Restored from archive in OZdash`),
  ]);
}

/** Records the ticket's PM session: `pm_session:`, today's `updated:`, and a Log line. */
export function setPmSessionContent(content: string, taskId: string, now: Date): EditResult {
  return chain(content, [
    (text) => setFrontmatterValue(text, 'pm_session', taskId),
    (text) => setFrontmatterValue(text, 'updated', formatDate(now)),
    (text) =>
      appendLogLine(text, `- ${formatDateTime(now)}: PM session ${taskId} started in OZdash`),
  ]);
}
