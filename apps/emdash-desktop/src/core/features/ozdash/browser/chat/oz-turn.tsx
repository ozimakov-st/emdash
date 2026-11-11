// Fork (ozimakov-st): OZ chat turn: user bubble, steps (collapsed once done), answer,
// and the footer (time, copy, changed files).
import type {
  AgentState,
  ToolNode,
  TranscriptThinking,
  TranscriptTurn,
} from '@emdash/core/runtimes/acp/api/client';
import {
  AlertCircle,
  Bot,
  Brain,
  Check,
  ChevronRight,
  Copy,
  FileMinus,
  FilePen,
  FilePlus,
  FileText,
  Globe,
  Info,
  ListChecks,
  Plug,
  Search,
  SquareTerminal,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { memo, useMemo, useState, type ReactNode } from 'react';
import { diffLines, foldContext } from '@core/features/ozdash/api/chat/inline-diff';
import {
  firstLine,
  formatDuration,
  shortPath,
  stepsLabel,
  summarizeTool,
  type ToolIcon,
} from '@core/features/ozdash/api/chat/tool-summary';
import {
  buildTurnView,
  fileChipsLayout,
  stepsPresentation,
  turnCopyText,
  type StepItem,
  type SystemRow,
} from '@core/features/ozdash/api/chat/transcript-view';
import { OzMarkdown } from './oz-markdown';

const TOOL_ICONS: Record<ToolIcon, LucideIcon> = {
  terminal: SquareTerminal,
  read: FileText,
  edit: FilePen,
  create: FilePlus,
  delete: FileMinus,
  search: Search,
  mcp: Plug,
  web: Globe,
  agent: Bot,
  plan: ListChecks,
  tool: Wrench,
};

/** Live data the rows need besides the transcript. */
export type TurnContext = {
  /** Background agents by tool call id (result summary, status). */
  agentsByToolCall: ReadonlyMap<string, AgentState>;
};

function RowIcon({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span className="oz-row-icon" aria-hidden>
      <Icon />
    </span>
  );
}

function Expandable({
  header,
  children,
  initiallyOpen = false,
  label,
}: {
  header: ReactNode;
  children: () => ReactNode;
  initiallyOpen?: boolean;
  label: string;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <div>
      <button
        type="button"
        className="oz-row"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((value) => !value)}
      >
        <ChevronRight className="oz-row-chevron" aria-hidden />
        {header}
      </button>
      {open && <div className="oz-detail">{children()}</div>}
    </div>
  );
}

// ── Tool rows ─────────────────────────────────────────────────────────────────

function DiffView({ oldText, newText }: { oldText: string | null; newText: string }) {
  const rows = useMemo(() => foldContext(diffLines(oldText, newText)), [oldText, newText]);
  return (
    <div className="oz-diff">
      {rows.map((row, index) =>
        row.kind === 'fold' ? (
          <div key={index} className="oz-diff-line is-fold">
            … {row.count} unchanged lines
          </div>
        ) : (
          <div
            key={index}
            className={`oz-diff-line${row.kind === 'add' ? ' is-add' : row.kind === 'del' ? ' is-del' : ''}`}
          >
            {row.kind === 'add' ? '+ ' : row.kind === 'del' ? '- ' : '  '}
            {row.text}
          </div>
        )
      )}
    </div>
  );
}

function ToolDetails({ node, context }: { node: ToolNode; context: TurnContext }) {
  switch (node.kind) {
    case 'execute-tool-call':
      return (
        <>
          {node.command && <pre className="oz-pre">$ {node.command}</pre>}
          {node.outputText ? (
            <pre className="oz-pre">{node.outputText}</pre>
          ) : node.status === 'running' ? null : (
            <div className="oz-system-text">No output</div>
          )}
        </>
      );
    case 'modify-file-tool-call':
      return <DiffView oldText={node.oldText} newText={node.newText} />;
    case 'create-file-tool-call':
      return <DiffView oldText={null} newText={node.content} />;
    case 'spawn-subagent-tool-call': {
      const agent = context.agentsByToolCall.get(node.toolCallId);
      return (
        <div className="oz-detail-steps">
          {node.inputSummary && <pre className="oz-pre is-thinking">{node.inputSummary}</pre>}
          {(node.children ?? []).map((child) => (
            <ToolRow key={child.id} node={child} context={context} />
          ))}
          {agent?.summary && <OzMarkdown text={agent.summary} />}
          {agent?.outputFile && <div className="oz-system-text">Output: {agent.outputFile}</div>}
        </div>
      );
    }
    case 'tool-group':
      return (
        <div className="oz-detail-steps">
          {node.children.map((child) => (
            <ToolRow key={child.id} node={child} context={context} />
          ))}
        </div>
      );
    default: {
      const locations = node.locations ?? [];
      return (
        <>
          {node.title && <div className="oz-system-text">{node.title}</div>}
          {node.inputSummary && <pre className="oz-pre">{node.inputSummary}</pre>}
          {locations.map((location) => (
            <div key={`${location.path}:${location.line ?? ''}`} className="oz-system-text">
              {location.path}
              {location.line ? `:${location.line}` : ''}
            </div>
          ))}
          {(node.children ?? []).map((child) => (
            <ToolRow key={child.id} node={child} context={context} />
          ))}
        </>
      );
    }
  }
}

export const ToolRow = memo(function ToolRow({
  node,
  context,
}: {
  node: ToolNode;
  context: TurnContext;
}) {
  const summary = summarizeTool(node);
  const agent =
    node.kind === 'spawn-subagent-tool-call' ? context.agentsByToolCall.get(node.toolCallId) : null;
  const running = agent?.status === 'running' || (agent ? false : summary.status === 'running');
  const failed = agent?.status === 'failed' || summary.status === 'error';
  const header = (
    <>
      <RowIcon icon={TOOL_ICONS[summary.icon]} />
      <span className={`oz-row-label${running ? ' oz-running' : ''}`}>{summary.label}</span>
      {summary.detail && <span className="oz-pill">{summary.detail}</span>}
      {summary.added ? <span className="oz-stat-add">+{summary.added}</span> : null}
      {summary.removed ? <span className="oz-stat-del">-{summary.removed}</span> : null}
      {summary.background && running && <span className="oz-tag">background</span>}
      {failed && (
        <span className="oz-tag is-error">
          <AlertCircle size={11} style={{ display: 'inline', verticalAlign: '-1px' }} /> failed
        </span>
      )}
    </>
  );
  return (
    <Expandable header={header} label={`${summary.label} ${summary.detail ?? ''}`}>
      {() => <ToolDetails node={node} context={context} />}
    </Expandable>
  );
});

// ── Thinking, system, steps ───────────────────────────────────────────────────

function ThinkingRow({ item }: { item: TranscriptThinking }) {
  const running = item.status === 'thinking';
  const preview = firstLine(item.text.trim().split('\n').pop(), 120);
  const header = (
    <>
      <RowIcon icon={Brain} />
      <span className={`oz-row-label${running ? ' oz-running' : ''}`}>
        {running
          ? 'Thinking'
          : item.durationMs
            ? `Thought for ${formatDuration(item.durationMs)}`
            : 'Thinking'}
      </span>
      {preview && <span className="oz-pill">{preview}</span>}
    </>
  );
  return (
    <Expandable header={header} label="Thinking">
      {() => <pre className="oz-pre is-thinking">{item.text}</pre>}
    </Expandable>
  );
}

function SystemRowView({ item }: { item: SystemRow }) {
  return (
    <div className="oz-system">
      <RowIcon icon={Info} />
      <div>
        <div>{item.title}</div>
        {item.text && <div className="oz-system-text">{item.text}</div>}
      </div>
    </div>
  );
}

function Step({
  step,
  context,
  streaming,
}: {
  step: StepItem;
  context: TurnContext;
  streaming: boolean;
}) {
  switch (step.kind) {
    case 'message':
      return <OzMarkdown text={step.item.text} streaming={streaming} />;
    case 'thinking':
      return <ThinkingRow item={step.item} />;
    case 'tool':
      return <ToolRow node={step.item} context={context} />;
    case 'system':
      return <SystemRowView item={step.item} />;
  }
}

function StepsList({
  steps,
  context,
  active,
}: {
  steps: readonly StepItem[];
  context: TurnContext;
  active: boolean;
}) {
  return (
    <div className="oz-steps-list">
      {steps.map((step, index) => (
        <Step
          key={step.item.id || index}
          step={step}
          context={context}
          streaming={active && index === steps.length - 1}
        />
      ))}
    </div>
  );
}

// ── Footer ────────────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  if (!text) return null;
  return (
    <button
      type="button"
      className="oz-icon-button"
      aria-label="Copy answer"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
    >
      {copied ? <Check /> : <Copy />}
    </button>
  );
}

function formatClock(at: number): string {
  const date = new Date(at);
  const sameDay = new Date().toDateString() === date.toDateString();
  return date.toLocaleString(undefined, {
    ...(sameDay ? {} : { weekday: 'short' }),
    hour: 'numeric',
    minute: '2-digit',
  });
}

export type TurnTiming = { startedAt?: number; endedAt?: number };

function outcomeText(outcome: TranscriptTurn['outcome']): { text: string; error: boolean } | null {
  if (!outcome) return null;
  if (outcome.kind === 'cancelled') return { text: 'Stopped', error: false };
  if (outcome.kind === 'interrupted') return { text: 'Interrupted', error: false };
  if (outcome.kind === 'error')
    return {
      text: `Error${outcome.reason ? `: ${outcome.reason.replace(/_/g, ' ')}` : ''}`,
      error: true,
    };
  return null;
}

// ── Turn ──────────────────────────────────────────────────────────────────────

export const OzTurn = memo(function OzTurn({
  turn,
  active,
  context,
  timing,
}: {
  turn: TranscriptTurn;
  active: boolean;
  context: TurnContext;
  timing: TurnTiming | undefined;
}) {
  const view = useMemo(() => buildTurnView(turn, { active }), [turn, active]);
  const presentation = stepsPresentation(view, active, stepsLabel(view.counts));
  const chips = fileChipsLayout(view.fileChanges);
  const outcome = outcomeText(view.outcome);
  const answerStreaming = active && view.answer !== null;
  const duration =
    timing?.startedAt !== undefined && timing.endedAt !== undefined
      ? formatDuration(timing.endedAt - timing.startedAt)
      : null;

  return (
    <div className="oz-turn" data-turn-id={turn.id}>
      {view.user && (
        <div className="oz-user">
          <UserBubble text={view.user.text} />
        </div>
      )}
      {presentation.kind === 'inline' && (
        <StepsList steps={view.steps} context={context} active={active && !view.answer} />
      )}
      {presentation.kind === 'collapsed' && (
        <Expandable
          label={presentation.label}
          header={<span className="oz-row-label">{presentation.label}</span>}
        >
          {() => <StepsList steps={view.steps} context={context} active={false} />}
        </Expandable>
      )}
      {view.answer && <OzMarkdown text={view.answer.text} streaming={answerStreaming} />}
      {outcome && (
        <div className={`oz-outcome${outcome.error ? ' is-error' : ''}`}>{outcome.text}</div>
      )}
      {!active && (view.answer || view.fileChanges.length > 0) && (
        <div className="oz-meta">
          {(duration || timing?.endedAt) && (
            <span>
              {[duration, timing?.endedAt ? formatClock(timing.endedAt) : null]
                .filter(Boolean)
                .join(' · ')}
            </span>
          )}
          <CopyButton text={turnCopyText(view)} />
          {chips.shown.map((change) => (
            <span key={change.path} className="oz-file-chip" title={change.path}>
              {shortPath(change.path)}
              {change.deleted ? (
                <span className="oz-stat-del">deleted</span>
              ) : (
                <>
                  {change.added > 0 && <span className="oz-stat-add">+{change.added}</span>}
                  {change.removed > 0 && <span className="oz-stat-del">-{change.removed}</span>}
                </>
              )}
            </span>
          ))}
          {chips.more && (
            <span className="oz-file-chip">
              +{chips.more.count} more
              <span className="oz-stat-add">+{chips.more.added}</span>
              <span className="oz-stat-del">-{chips.more.removed}</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
});

export function UserBubble({ text, pending = false }: { text: string; pending?: boolean }) {
  const long = text.length > 900 || text.split('\n').length > 14;
  const [expanded, setExpanded] = useState(false);
  const collapsed = long && !expanded;
  return (
    <div
      className={`oz-user-bubble${collapsed ? ' is-long' : ''}${pending ? ' is-pending' : ''}`}
      onClick={collapsed ? () => setExpanded(true) : undefined}
      title={collapsed ? 'Show all' : undefined}
    >
      {text}
    </div>
  );
}
