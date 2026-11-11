// Fork (ozimakov-st): OZ chat one-line tool rows. Every tool call is shown as a compact
// row: an icon, a short muted label, and an optional monospace detail (command, path,
// query), like Conductor. Pure: no React, no DOM.
import type { ToolNode, ToolStatus } from '@emdash/core/runtimes/acp/api/client';

export type ToolIcon =
  | 'terminal'
  | 'read'
  | 'edit'
  | 'create'
  | 'delete'
  | 'search'
  | 'mcp'
  | 'web'
  | 'agent'
  | 'plan'
  | 'tool';

export type ToolSummary = {
  icon: ToolIcon;
  /** Short muted label, e.g. "Run tests" or "Edit". */
  label: string;
  /** Monospace detail, e.g. the command or the file path. */
  detail?: string;
  /** Line counts for file edits. */
  added?: number;
  removed?: number;
  status: ToolStatus;
  /** True for background work (Agent with run_in_background, background shells). */
  background?: boolean;
};

/** Text up to the first line break, trimmed, at most `max` characters. */
export function firstLine(text: string | undefined, max = 160): string {
  const line = (text ?? '').split(/\r?\n/, 1)[0]?.trim() ?? '';
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** Last two path segments: enough to recognize a file in a narrow row. */
export function shortPath(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  if (parts.length <= 2) return path;
  return `…/${parts.slice(-2).join('/')}`;
}

/**
 * Added and removed lines between two texts. A multiset line comparison: cheap, and
 * exact for the usual edit (a block replaced by another).
 */
export function lineDiffStats(
  oldText: string | null,
  newText: string
): { added: number; removed: number } {
  const split = (text: string) => (text === '' ? [] : text.replace(/\r\n/g, '\n').split('\n'));
  const before = split(oldText ?? '');
  const after = split(newText);
  const counts = new Map<string, number>();
  for (const line of before) counts.set(line, (counts.get(line) ?? 0) + 1);
  let added = 0;
  for (const line of after) {
    const left = counts.get(line) ?? 0;
    if (left > 0) counts.set(line, left - 1);
    else added++;
  }
  let removed = 0;
  for (const left of counts.values()) removed += left;
  return { added, removed };
}

const BACKGROUND_OUTPUT =
  /running in (the )?background|background (task|shell|command) (id|started)/i;

/** True when a shell tool call started a background command (Bash run_in_background). */
export function isBackgroundShell(node: ToolNode): boolean {
  return node.kind === 'execute-tool-call' && BACKGROUND_OUTPUT.test(node.outputText ?? '');
}

function locationPath(node: ToolNode): string | undefined {
  if ('path' in node && typeof node.path === 'string' && node.path) return node.path;
  if (node.kind === 'tool-group') return undefined;
  return node.locations?.[0]?.path;
}

export function summarizeTool(node: ToolNode): ToolSummary {
  const status = node.status;
  switch (node.kind) {
    case 'execute-tool-call': {
      const command = firstLine(node.command || node.title);
      const label = firstLine(node.inputSummary) || 'Run';
      return {
        icon: 'terminal',
        label,
        detail: command && command !== label ? command : undefined,
        status,
        ...(isBackgroundShell(node) && { background: true }),
      };
    }
    case 'read-tool-call': {
      const path = locationPath(node);
      return {
        icon: 'read',
        label: 'Read',
        detail: path ? shortPath(path) : firstLine(node.title),
        status,
      };
    }
    case 'modify-file-tool-call':
      return {
        icon: 'edit',
        label: 'Edit',
        detail: shortPath(node.path),
        ...lineDiffStats(node.oldText, node.newText),
        status,
      };
    case 'create-file-tool-call':
      return {
        icon: 'create',
        label: 'Write',
        detail: shortPath(node.path),
        ...lineDiffStats(null, node.content),
        status,
      };
    case 'delete-file-tool-call':
      return { icon: 'delete', label: 'Delete', detail: shortPath(node.path), status };
    case 'search-tool-call':
      return {
        icon: 'search',
        label: node.matchCount !== undefined ? `Search · ${node.matchCount} matches` : 'Search',
        detail: firstLine(node.query || node.title),
        status,
      };
    case 'mcp-tool-call':
      return {
        icon: 'mcp',
        label: node.server ? `${node.server} · ${node.tool}` : node.tool,
        detail: firstLine(node.inputSummary) || undefined,
        status,
      };
    case 'web-fetch-tool-call':
      return {
        icon: 'web',
        label: 'Fetch',
        detail: firstLine(node.pageTitle || node.url),
        status,
      };
    case 'spawn-subagent-tool-call':
      return {
        icon: 'agent',
        label: node.background ? 'Background agent' : 'Agent',
        detail: firstLine(node.name || node.title),
        status,
        ...(node.background && { background: true }),
      };
    case 'create-plan-tool-call':
      return { icon: 'plan', label: 'Plan', detail: firstLine(node.title) || undefined, status };
    case 'unknown-tool-call': {
      const label = firstLine(node.name || node.title) || 'Tool';
      const detail = firstLine(node.inputSummary);
      return {
        icon: 'tool',
        label,
        detail: detail && detail !== label ? detail : undefined,
        status,
      };
    }
    case 'tool-group':
      return { icon: 'tool', label: firstLine(node.label) || 'Tools', status };
  }
}

/** Tool calls in a node, counting group members and nested subagent tools. */
export function countTools(nodes: readonly ToolNode[]): number {
  let count = 0;
  for (const node of nodes) {
    if (node.kind === 'tool-group') count += countTools(node.children);
    else count += 1 + countTools(node.children ?? []);
  }
  return count;
}

/** "3 tool calls, 2 messages, 1 subagent" (only the non-zero parts). */
export function stepsLabel(counts: { tools: number; messages: number; subagents: number }): string {
  const part = (n: number, one: string, many: string) =>
    n > 0 ? `${n} ${n === 1 ? one : many}` : '';
  return [
    part(counts.tools, 'tool call', 'tool calls'),
    part(counts.messages, 'message', 'messages'),
    part(counts.subagents, 'subagent', 'subagents'),
  ]
    .filter(Boolean)
    .join(', ');
}

/** "2m, 54s", "12s", "1h, 3m": the turn and timer format used under answers. */
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h, ${m}m`;
  if (m > 0) return `${m}m, ${s}s`;
  return `${s}s`;
}
