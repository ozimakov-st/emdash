// Fork (ozimakov-st): OZ chat reads the same transcript the Emdash chat renders.
//
// `AcpChatStore` keeps the transcript in a chat-ui `ChatState` (a Solid store: history,
// the live turn, the optimistic prompt). This hook watches it with a Solid effect and
// gives React a plain, immutable snapshot, at most once per animation frame.
import type { ChatState } from '@emdash/chat-ui';
import type { TranscriptTurn } from '@emdash/core/runtimes/acp/api/client';
import { useEffect, useState } from 'react';
import { createEffect, createRoot } from 'solid-js';
import { unwrap } from 'solid-js/store';

export type ChatSnapshot = {
  /** Committed history plus outgoing turns, in order. Immutable objects. */
  turns: readonly TranscriptTurn[];
  /** The live turn (a fresh copy per snapshot), or null. */
  active: TranscriptTurn | null;
  /** The user's just-sent prompt, until the agent echoes it. */
  pendingPrompt: { id: string; text: string } | null;
};

const EMPTY: ChatSnapshot = { turns: [], active: null, pendingPrompt: null };

/** Reads every property of a Solid store value, so the effect tracks all of it. */
function trackDeep(value: unknown, depth = 0): void {
  if (depth > 12 || value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) trackDeep(item, depth + 1);
    return;
  }
  for (const key of Object.keys(value))
    trackDeep((value as Record<string, unknown>)[key], depth + 1);
}

function read(state: ChatState): ChatSnapshot {
  const transcript = state.transcript.state;
  const active = transcript.activeTurnSnapshot;
  const pending = state.session.state.pendingPrompt;
  return {
    turns: transcript.displayTurns,
    active: active ? (structuredClone(unwrap(active)) as TranscriptTurn) : null,
    pendingPrompt: pending ? { id: pending.id, text: pending.text } : null,
  };
}

export function useChatSnapshot(state: ChatState | null): ChatSnapshot {
  const [snapshot, setSnapshot] = useState<ChatSnapshot>(() => (state ? read(state) : EMPTY));

  useEffect(() => {
    if (!state) {
      setSnapshot(EMPTY);
      return;
    }
    let frame = 0;
    const flush = () => {
      frame = 0;
      setSnapshot(read(state));
    };
    const dispose = createRoot((disposeRoot) => {
      createEffect(() => {
        const transcript = state.transcript.state;
        void transcript.displayTurns;
        void transcript.turnStatus;
        void state.session.state.pendingPrompt;
        trackDeep(transcript.activeTurnSnapshot);
        if (!frame) frame = requestAnimationFrame(flush);
      });
      return disposeRoot;
    });
    setSnapshot(read(state));
    return () => {
      dispose();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [state]);

  return snapshot;
}
