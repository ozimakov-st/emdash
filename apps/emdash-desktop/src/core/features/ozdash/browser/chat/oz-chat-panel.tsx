// Fork (ozimakov-st): OZ chat, a calm Conductor-like view of an ACP (chat) session.
// Same data as Emdash chat (AcpChatStore); only the rendering is ours.
import '@fontsource-variable/geist/index.css';
import '@fontsource-variable/geist-mono/index.css';
import './oz-chat.css';
import type { AgentState, ToolNode, TranscriptTurn } from '@emdash/core/runtimes/acp/api/client';
import { Button } from '@emdash/ui/react/primitives';
import { ArrowDown, Bot, SquareTerminal } from 'lucide-react';
import { observer, useObserver } from 'mobx-react-lite';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { conversationRegistry } from '@core/features/conversations/api/browser/stores/conversation-registry';
import { pickAllowOption } from '@core/features/ozdash/api/chat/acp-launch-options';
import {
  firstLine,
  formatDuration,
  isBackgroundShell,
} from '@core/features/ozdash/api/chat/tool-summary';
import type { OzChatStore as AcpChatStore } from './chat-store';
import { OzComposer } from './oz-composer';
import { OzTurn, UserBubble, type TurnContext, type TurnTiming } from './oz-turn';
import { useChatSnapshot } from './use-chat-snapshot';

const STICK_THRESHOLD_PX = 48;
const NO_AGENTS: readonly AgentState[] = [];

/** Answers permission requests that still arrive (OZ chat runs without prompts). */
function useAutoApprove(store: AcpChatStore): void {
  const request = useObserver(() => store.permissionQueue[0]);
  const live = useObserver(() => store.liveActionsEnabled);
  const answered = useRef(new Set<string>());
  useEffect(() => {
    if (!request || !live || answered.current.has(request.requestId)) return;
    const optionId = pickAllowOption(request.options);
    if (!optionId) return;
    answered.current.add(request.requestId);
    store.resolvePermission(optionId);
  }, [request, live, store]);
}

/** Start/end times of turns this view saw run (history has no timestamps). */
function useTurnTimings(active: TranscriptTurn | null): ReadonlyMap<string, TurnTiming> {
  const timings = useRef(new Map<string, TurnTiming>());
  const lastActive = useRef<string | null>(null);
  const activeId = active?.id ?? null;
  if (activeId !== lastActive.current) {
    const now = Date.now();
    if (lastActive.current) {
      const previous = timings.current.get(lastActive.current);
      if (previous && previous.endedAt === undefined) previous.endedAt = now;
    }
    if (activeId && !timings.current.has(activeId)) {
      const thinking = active?.items.find((item) => item.kind === 'thinking');
      timings.current.set(activeId, {
        startedAt: thinking?.kind === 'thinking' ? Math.min(thinking.startedAt, now) : now,
      });
    }
    lastActive.current = activeId;
  }
  return timings.current;
}

function useNow(enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [enabled]);
  return now;
}

type ShellNode = Extract<ToolNode, { kind: 'execute-tool-call' }>;

function collectBackgroundShells(turns: readonly TranscriptTurn[]): ShellNode[] {
  const shells: ShellNode[] = [];
  const visit = (nodes: readonly ToolNode[]) => {
    for (const node of nodes) {
      if (node.kind === 'execute-tool-call' && isBackgroundShell(node)) shells.push(node);
      visit(node.kind === 'tool-group' ? node.children : (node.children ?? []));
    }
  };
  for (const turn of turns)
    visit(
      turn.items.filter(
        (item): item is ToolNode =>
          item.kind !== 'message' && item.kind !== 'notification' && item.kind !== 'thinking'
      )
    );
  return shells;
}

const StatusLine = observer(function StatusLine({
  store,
  turns,
  activeStartedAt,
}: {
  store: AcpChatStore;
  turns: readonly TranscriptTurn[];
  activeStartedAt: number | undefined;
}) {
  const agents = store.session?.agents.current() ?? NO_AGENTS;
  const working = store.affordances.isWorking;
  const runningAgents = agents.filter((agent) => agent.status === 'running');
  const finishedKey = agents
    .filter((agent) => agent.status !== 'running')
    .map((agent) => agent.toolCallId)
    .join('\n');
  const shells = useMemo(() => {
    const finished = new Set(finishedKey.split('\n'));
    return collectBackgroundShells(turns).filter((node) => !finished.has(node.toolCallId));
  }, [turns, finishedKey]);
  const agentToolIds = new Set(runningAgents.map((agent) => agent.toolCallId));
  const now = useNow(working || runningAgents.length > 0);
  if (!working && runningAgents.length === 0 && shells.length === 0) return null;
  return (
    <div className="oz-status" aria-live="polite">
      {runningAgents.map((agent) => (
        <div key={agent.agentId} className="oz-status-row">
          <span className="oz-row-icon" aria-hidden>
            <Bot />
          </span>
          <span className="oz-running">
            Waiting for {agent.background ? 'background agent' : 'subagent'}
          </span>
          <span className="oz-pill">{firstLine(agent.name) || 'agent'}</span>
          <span className="oz-timer">{formatDuration(now - agent.startedAt)}</span>
        </div>
      ))}
      {shells
        .filter((node) => !agentToolIds.has(node.toolCallId))
        .map((node) => (
          <div key={node.id} className="oz-status-row">
            <span className="oz-row-icon" aria-hidden>
              <SquareTerminal />
            </span>
            <span>Background shell</span>
            <span className="oz-pill">{firstLine(node.command || node.title)}</span>
          </div>
        ))}
      {working && runningAgents.length === 0 && (
        <div className="oz-status-row">
          <span className="oz-dots" aria-hidden>
            <i />
            <i />
            <i />
          </span>
          <span>Working</span>
          {activeStartedAt !== undefined && (
            <span className="oz-timer">{formatDuration(now - activeStartedAt)}</span>
          )}
        </div>
      )}
    </div>
  );
});

export const OzChatPanel = observer(function OzChatPanel({ store }: { store: AcpChatStore }) {
  const snapshot = useChatSnapshot(store.chatState);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const stickRef = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  useAutoApprove(store);

  // Mark the conversation seen while it is on screen (like Emdash chat).
  const conversation = conversationRegistry
    .get(store.taskId)
    ?.conversations.get(store.conversationId);
  const seen = conversation?.seen;
  useEffect(() => {
    if (conversation && !conversation.seen) conversation.markSeen();
  }, [conversation, seen]);

  const agents: readonly AgentState[] = store.session?.agents.current() ?? NO_AGENTS;
  const context = useMemo<TurnContext>(
    () => ({ agentsByToolCall: new Map(agents.map((agent) => [agent.toolCallId, agent])) }),
    [agents]
  );

  const timings = useTurnTimings(snapshot.active);
  const turns = useMemo(() => {
    const list = snapshot.turns.filter((turn) => turn.id !== snapshot.active?.id);
    return snapshot.active ? [...list, snapshot.active] : list;
  }, [snapshot.turns, snapshot.active]);
  const pendingVisible =
    snapshot.pendingPrompt &&
    !turns.some((turn) =>
      turn.items.some(
        (item) => item.kind === 'message' && item.promptId === snapshot.pendingPrompt?.id
      )
    );

  // Stick to the bottom while new content arrives, unless the user scrolled up.
  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    const content = contentRef.current;
    if (!scroller || !content) return;
    const follow = () => {
      if (stickRef.current) scroller.scrollTop = scroller.scrollHeight;
    };
    follow();
    const observer = new ResizeObserver(follow);
    observer.observe(content);
    return () => observer.disconnect();
  }, [store]);

  useEffect(() => {
    if (pendingVisible) {
      stickRef.current = true;
      setAtBottom(true);
    }
  }, [pendingVisible]);

  const onScroll = () => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const bottom =
      scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < STICK_THRESHOLD_PX;
    stickRef.current = bottom;
    if (bottom !== atBottom) setAtBottom(bottom);
  };

  const jumpToBottom = () => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    stickRef.current = true;
    setAtBottom(true);
    scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' });
  };

  const loadError = store.loadError;
  const showComposer =
    loadError?.kind !== 'auth_required' && (store.historyKnown || store.messageCount > 0);
  const empty = store.isEmpty && !snapshot.active && !pendingVisible;

  return (
    <div className="oz-chat">
      <div ref={scrollRef} className="oz-scroll" onScroll={onScroll}>
        <div ref={contentRef} className="oz-column">
          {empty && !loadError && <div className="oz-empty">What are we working on?</div>}
          {!showComposer && store.historyLoading && <div className="oz-empty">Loading chat…</div>}
          {turns.map((turn) => (
            <OzTurn
              key={turn.id}
              turn={turn}
              active={turn === snapshot.active}
              context={context}
              timing={timings.get(turn.id)}
            />
          ))}
          {pendingVisible && snapshot.pendingPrompt && (
            <div className="oz-user">
              <UserBubble text={snapshot.pendingPrompt.text} pending />
            </div>
          )}
        </div>
      </div>
      <div className="oz-bottom">
        <div className="oz-bottom-inner">
          {!atBottom && (
            <button type="button" className="oz-jump" onClick={jumpToBottom}>
              <ArrowDown size={12} aria-hidden /> Latest
            </button>
          )}
          <StatusLine
            store={store}
            turns={turns}
            activeStartedAt={
              snapshot.active ? timings.get(snapshot.active.id)?.startedAt : undefined
            }
          />
          {loadError && (
            <div className="oz-load-error" role="alert">
              <span>{loadError.message}</span>
              <span style={{ display: 'flex', gap: 6 }}>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={store.historyLoading}
                  onClick={() => store.retry()}
                >
                  Retry
                </Button>
                {loadError.kind === 'session_not_found' && (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={store.historyLoading}
                    onClick={() => store.retry({ mode: 'fresh' })}
                  >
                    Start fresh
                  </Button>
                )}
              </span>
            </div>
          )}
          {showComposer && <OzComposer key={store.conversationId} store={store} />}
        </div>
      </div>
    </div>
  );
});
