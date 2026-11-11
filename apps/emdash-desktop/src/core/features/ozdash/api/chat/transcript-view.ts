// Fork (ozimakov-st): OZ chat turn layout. Shapes a transcript turn the way Conductor
// shows it: the user's message, the steps in between (tool calls, interim messages,
// thinking, subagents) collapsed into one row once the turn is done, the final answer
// in full, then file-change chips. Background activity (task notifications) becomes
// compact system rows. Pure: no React.
import type {
  ToolNode,
  TranscriptItem,
  TranscriptMessage,
  TranscriptThinking,
  TranscriptTurn,
} from '@emdash/core/runtimes/acp/api/client';
import { countTools, lineDiffStats } from './tool-summary';

export type SystemRow = { id: string; title: string; text: string };

export type FileChange = { path: string; added: number; removed: number; deleted?: boolean };

export type StepItem =
  | { kind: 'message'; item: TranscriptMessage }
  | { kind: 'thinking'; item: TranscriptThinking }
  | { kind: 'tool'; item: ToolNode }
  | { kind: 'system'; item: SystemRow };

export type TurnView = {
  id: string;
  initiator: TranscriptTurn['initiator'];
  user: TranscriptMessage | null;
  /** Everything between the user's message and the answer, in order. */
  steps: StepItem[];
  /** The final assistant message, shown in full. Null while there is none yet. */
  answer: TranscriptMessage | null;
  counts: { tools: number; messages: number; subagents: number };
  fileChanges: FileChange[];
  outcome: TranscriptTurn['outcome'];
};

const TASK_NOTIFICATION = /^\s*<task-notification>([\s\S]*)<\/task-notification>\s*$/;

/**
 * A raw `<task-notification>` envelope the provider could not parse: show it as a
 * system row (summary + status), never as a user message.
 */
export function parseTaskNotificationText(text: string): SystemRow | null {
  const body = TASK_NOTIFICATION.exec(text)?.[1];
  if (body === undefined) return null;
  const field = (name: string) =>
    new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(body)?.[1]?.trim() ?? '';
  const summary = field('summary') || field('event') || 'Background task update';
  const status = field('status');
  const lines = [status && `Status: ${status}`, field('result') || field('note')].filter(Boolean);
  return { id: '', title: summary, text: lines.join('\n') };
}

function subagentCount(nodes: readonly ToolNode[]): number {
  let count = 0;
  for (const node of nodes) {
    if (node.kind === 'spawn-subagent-tool-call') count++;
    count += subagentCount(node.kind === 'tool-group' ? node.children : (node.children ?? []));
  }
  return count;
}

function collectFileChanges(nodes: readonly ToolNode[], into: Map<string, FileChange>): void {
  for (const node of nodes) {
    if (node.kind === 'tool-group') {
      collectFileChanges(node.children, into);
      continue;
    }
    let change: FileChange | null = null;
    if (node.kind === 'modify-file-tool-call') {
      change = { path: node.path, ...lineDiffStats(node.oldText, node.newText) };
    } else if (node.kind === 'create-file-tool-call') {
      change = { path: node.path, ...lineDiffStats(null, node.content) };
    } else if (node.kind === 'delete-file-tool-call') {
      change = { path: node.path, added: 0, removed: 0, deleted: true };
    }
    if (change && node.status !== 'error') {
      const previous = into.get(change.path);
      into.set(
        change.path,
        previous
          ? {
              path: change.path,
              added: previous.added + change.added,
              removed: previous.removed + change.removed,
              ...((previous.deleted || change.deleted) && { deleted: true }),
            }
          : change
      );
    }
    if (node.children) collectFileChanges(node.children, into);
  }
}

function isToolNode(item: TranscriptItem): item is ToolNode {
  return item.kind !== 'message' && item.kind !== 'notification' && item.kind !== 'thinking';
}

export function buildTurnView(turn: TranscriptTurn, options: { active: boolean }): TurnView {
  const items = [...turn.items].sort((a, b) => a.seq - b.seq);
  let user: TranscriptMessage | null = null;
  const steps: StepItem[] = [];
  const tools: ToolNode[] = [];
  for (const item of items) {
    if (item.kind === 'message' && item.role === 'user') {
      const system = parseTaskNotificationText(item.text);
      if (system) steps.push({ kind: 'system', item: { ...system, id: item.id } });
      else if (!user && turn.initiator === 'user') user = item;
      else steps.push({ kind: 'message', item });
      continue;
    }
    if (item.kind === 'notification') {
      steps.push({ kind: 'system', item: { id: item.id, title: item.title, text: item.text } });
    } else if (item.kind === 'thinking') {
      steps.push({ kind: 'thinking', item });
    } else if (item.kind === 'message') {
      steps.push({ kind: 'message', item });
    } else if (isToolNode(item)) {
      steps.push({ kind: 'tool', item });
      tools.push(item);
    }
  }

  // The answer is the last assistant message, once nothing but thinking follows it. While
  // the turn runs, a message that is still the last step is the streaming answer.
  let answer: TranscriptMessage | null = null;
  for (let index = steps.length - 1; index >= 0; index--) {
    const step = steps[index]!;
    if (step.kind === 'message' && step.item.role === 'assistant') {
      answer = step.item;
      steps.splice(index, 1);
      break;
    }
    if (step.kind !== 'thinking') break;
  }

  const changes = new Map<string, FileChange>();
  collectFileChanges(tools, changes);
  const messages = steps.filter((step) => step.kind === 'message').length;
  return {
    id: turn.id,
    initiator: turn.initiator,
    user,
    steps,
    answer,
    counts: { tools: countTools(tools), messages, subagents: subagentCount(tools) },
    fileChanges: [...changes.values()],
    outcome: options.active ? undefined : turn.outcome,
  };
}

/** How a finished turn shows its steps. */
export type StepsPresentation =
  /** No steps. */
  | { kind: 'none' }
  /** One step (or only thinking/system rows): shown as is. */
  | { kind: 'inline' }
  /** Many steps: one collapsed "3 tool calls, 2 messages" row. */
  | { kind: 'collapsed'; label: string };

export function stepsPresentation(
  view: TurnView,
  active: boolean,
  label: string
): StepsPresentation {
  if (view.steps.length === 0) return { kind: 'none' };
  if (active) return { kind: 'inline' };
  const substantive = view.steps.filter((step) => step.kind === 'tool' || step.kind === 'message');
  return substantive.length <= 1 ? { kind: 'inline' } : { kind: 'collapsed', label };
}

/** Shown file chips plus a "+N more" chip with the rest's totals. */
export function fileChipsLayout(
  changes: readonly FileChange[],
  max = 3
): { shown: FileChange[]; more: { count: number; added: number; removed: number } | null } {
  if (changes.length <= max + 1) return { shown: [...changes], more: null };
  const rest = changes.slice(max);
  return {
    shown: changes.slice(0, max),
    more: {
      count: rest.length,
      added: rest.reduce((sum, change) => sum + change.added, 0),
      removed: rest.reduce((sum, change) => sum + change.removed, 0),
    },
  };
}

/** The plain text a "copy" button copies for a turn: the answer. */
export function turnCopyText(view: TurnView): string {
  return view.answer?.text ?? '';
}
