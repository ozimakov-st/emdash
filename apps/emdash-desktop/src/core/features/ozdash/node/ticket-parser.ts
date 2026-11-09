// Fork (ozimakov-st): parses a vault `ticket.md` (flat YAML frontmatter + markdown
// sections) into what the Tickets board needs. Pure; no file access.
import { normalizeTicketStatus, type TicketSummary } from '../api/tickets';

export type ParseTicketResult =
  | { success: true; ticket: TicketSummary }
  | { success: false; error: string };

/** Dependency statuses that mean "nothing to wait for any more". */
const CLOSED_DEPENDENCY_STATUSES = new Set([
  'done',
  'closed',
  'merged',
  'resolved',
  'dropped',
  'cancelled',
  'canceled',
]);

function stripQuotes(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    // Undo YAML escapes (`\"`, `\\` in double quotes; `''` in single).
    if (first === '"' && value.endsWith('"')) return value.slice(1, -1).replace(/\\(["\\])/g, '$1');
    if (first === "'" && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'");
  }
  return value;
}

/** Splits a line into its newline-free text (handles `\r\n`). */
function splitLines(content: string): string[] {
  return content.split('\n').map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line));
}

/**
 * The frontmatter block: line indexes of the opening and closing `---`, or null.
 * Shared with the editor so both agree on where the block is.
 */
export function findFrontmatter(lines: readonly string[]): { start: number; end: number } | null {
  const first = (lines[0] ?? '').replace(/^﻿/, '');
  if (first.trim() !== '---') return null;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index]!.trim() === '---') return { start: 0, end: index };
  }
  return null;
}

/** `key: value` of a frontmatter line, or null for blank lines and comments. */
export function parseFrontmatterLine(line: string): { key: string; raw: string } | null {
  const match = /^([A-Za-z_][\w-]*)\s*:(.*)$/.exec(line);
  if (!match) return null;
  return { key: match[1]!, raw: match[2]! };
}

/** The value of a frontmatter line: trimmed, unquoted, without a ` # comment` (except titles). */
function frontmatterValue(key: string, raw: string): string {
  let value = raw.trim();
  if (key !== 'title') value = value.replace(/(^|\s)#.*$/, '').trim();
  return stripQuotes(value).trim();
}

function parseFrontmatter(lines: readonly string[], end: number): Map<string, string> {
  const values = new Map<string, string>();
  for (let index = 1; index < end; index += 1) {
    const parsed = parseFrontmatterLine(lines[index]!);
    if (parsed) values.set(parsed.key, frontmatterValue(parsed.key, parsed.raw));
  }
  return values;
}

/** Body sections by `## ` heading (lowercased), each with its lines. */
function parseSections(lines: readonly string[]): Map<string, string[]> {
  const sections = new Map<string, string[]>();
  let current: string[] | null = null;
  for (const line of lines) {
    const heading = /^##\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      current = [];
      sections.set(heading[1]!.toLowerCase(), current);
    } else if (/^#\s/.test(line)) {
      current = null;
    } else if (current) {
      current.push(line);
    }
  }
  return sections;
}

/** A section's text without leading/trailing blank lines, or null when empty. */
function sectionText(lines: readonly string[]): string | null {
  const text = lines.join('\n').trim();
  return text || null;
}

const UNCHECKED = /^\s*[-*+]\s+\[ \]\s+(.*\S)\s*$/;

function firstUncheckedPlanLine(lines: readonly string[]): string | null {
  for (const line of lines) {
    const match = UNCHECKED.exec(line);
    if (match) return match[1]!.replace(/^\d+[.)]\s+/, '');
  }
  return null;
}

function openQuestions(lines: readonly string[]): { count: number; first: string | null } {
  const open = lines.map((line) => UNCHECKED.exec(line)?.[1]).filter((text) => text);
  return { count: open.length, first: open[0] ?? null };
}

function tableCells(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|')) return null;
  const inner = trimmed.endsWith('|') ? trimmed.slice(1, -1) : trimmed.slice(1);
  return inner.split('|').map((cell) => cell.trim());
}

function openDependencies(lines: readonly string[]): Array<{ what: string; owner: string }> {
  let header: string[] | null = null;
  const rows: Array<{ what: string; owner: string }> = [];
  for (const line of lines) {
    const cells = tableCells(line);
    if (!cells) continue;
    if (!header) {
      header = cells.map((cell) => cell.toLowerCase());
      continue;
    }
    if (cells.every((cell) => /^:?-{2,}:?$/.test(cell) || cell === '')) continue;
    const at = (name: string) => {
      const index = header!.indexOf(name);
      return index >= 0 ? (cells[index] ?? '') : '';
    };
    const what = at('what');
    const owner = at('owner');
    const status = at('status').toLowerCase();
    if (!what && !owner) continue;
    if (CLOSED_DEPENDENCY_STATUSES.has(status)) continue;
    rows.push({ what, owner });
  }
  return rows;
}

/** Parses one ticket file. `folder` is its folder name, for example `123-add-scim`. */
export function parseTicket(content: string, folder: string): ParseTicketResult {
  const lines = splitLines(content);
  const block = findFrontmatter(lines);
  if (!block) return { success: false, error: 'no frontmatter (the file must start with ---)' };
  const fields = parseFrontmatter(lines, block.end);

  const id = fields.get('id') || /^(\d+)(?:-|$)/.exec(folder)?.[1] || '';
  if (!id) return { success: false, error: 'no id' };
  if (!/^[\w.-]{1,32}$/.test(id)) return { success: false, error: `invalid id "${id}"` };

  // A legacy `draft` reads as `parked`.
  const status = normalizeTicketStatus(fields.get('status') ?? '');
  if (!status) {
    return { success: false, error: `unknown status "${fields.get('status') ?? ''}"` };
  }

  const priorityText = fields.get('priority') ?? '';
  const priority = /^\d+$/.test(priorityText) ? Number(priorityText) : null;
  const rankText = fields.get('rank') ?? '';
  const rank = /^-?\d+$/.test(rankText) ? Number(rankText) : null;
  const sections = parseSections(lines.slice(block.end + 1));

  return {
    success: true,
    ticket: {
      id,
      title: fields.get('title') || folder.replace(/^\d+-?/, '').replace(/-/g, ' ') || `#${id}`,
      status,
      priority,
      rank,
      needsOleg: /^(yes|true)$/i.test(fields.get('needs_oleg') ?? ''),
      nextCheck: fields.get('next_check') || null,
      pmSession: fields.get('pm_session') || null,
      updated: fields.get('updated') || null,
      folder,
      goal: sectionText(sections.get('goal') ?? []),
      nextStep: firstUncheckedPlanLine(sections.get('plan') ?? []),
      waitingOn: openDependencies(sections.get('dependencies') ?? []),
      openQuestions: openQuestions(sections.get('questions for oleg') ?? []),
      searchText: content.toLowerCase(),
    },
  };
}
