// Fork (ozimakov-st): text clamped to 3 lines, with "Show more" / "Show less" when it
// does not fit. Line breaks in the text are kept.
import { useLayoutEffect, useRef, useState } from 'react';
import { cn } from '@core/primitives/styling/browser/cn';

export function ExpandableText({ text, className }: { text: string; className?: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);

  // While clamped: is part of the text hidden? (The size can change, e.g. a popup opening.)
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || expanded) return;
    const check = () => setOverflows(element.scrollHeight > element.clientHeight + 1);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(element);
    return () => observer.disconnect();
  }, [text, expanded]);

  return (
    <div className="flex flex-col items-start gap-1">
      <p
        ref={ref}
        className={cn(
          'w-full break-words whitespace-pre-wrap',
          expanded ? 'max-h-80 overflow-y-auto' : 'line-clamp-3',
          className
        )}
      >
        {text}
      </p>
      {(overflows || expanded) && (
        <button
          type="button"
          className="text-[11px] text-foreground-info hover:underline"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}
