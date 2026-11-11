// Fork (ozimakov-st): OZ chat markdown with smooth streaming. While the agent writes,
// text is revealed line by line (line-chunker), and each new block fades in (CSS).
import { Markdown } from '@emdash/ui/react/components';
import { memo, useEffect, useRef, useState } from 'react';
import {
  REVEAL_TICK_MS,
  initialReveal,
  nextReveal,
  revealPending,
  type RevealState,
} from '@core/features/ozdash/api/chat/line-chunker';
import { openExternal } from '@core/primitives/desktop-host/browser/host-client';

function openLink(href: string): boolean {
  if (/^https?:\/\//i.test(href)) {
    void openExternal(href);
    return true;
  }
  return false;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  );
}

/** The part of `text` to show now; paced while `streaming`. */
function useRevealedText(text: string, streaming: boolean): string {
  const reduced = prefersReducedMotion();
  const stateRef = useRef<RevealState | null>(null);
  stateRef.current ??= initialReveal(text, streaming && !reduced, Date.now());
  const [, force] = useState(0);
  const textRef = useRef(text);
  textRef.current = text;

  const pacing = streaming && !reduced;
  const pending = revealPending(text, stateRef.current);
  useEffect(() => {
    if (!pacing && stateRef.current) {
      const next = nextReveal(textRef.current, stateRef.current, Date.now(), { streaming: false });
      if (next !== stateRef.current) {
        stateRef.current = next;
        force((n) => n + 1);
      }
      return;
    }
    if (!pending) return;
    const timer = setInterval(() => {
      const current = stateRef.current;
      if (!current) return;
      const next = nextReveal(textRef.current, current, Date.now(), { streaming: true });
      if (next !== current) {
        stateRef.current = next;
        force((n) => n + 1);
      }
    }, REVEAL_TICK_MS);
    return () => clearInterval(timer);
  }, [pacing, pending, text]);

  return text.slice(0, Math.min(stateRef.current.shown, text.length));
}

export const OzMarkdown = memo(function OzMarkdown({
  text,
  streaming = false,
}: {
  text: string;
  streaming?: boolean;
}) {
  const shown = useRevealedText(text, streaming);
  return (
    <Markdown
      content={shown}
      variant="full"
      allowHtml={false}
      className={streaming ? 'oz-md is-streaming' : 'oz-md'}
      onOpenLink={openLink}
    />
  );
});
