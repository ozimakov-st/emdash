// OZdash: the sidebar footer items (Search, Automations, Settings) live in one
// "More" group. Collapsed by default; the open/closed state survives restarts.
// Their keyboard shortcuts and palette commands do not depend on this group.
import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { ozdashSidebarMemento, toggleNavOpen } from '@core/features/ozdash/contributions/mementos';
import { useMemento } from '@core/primitives/mementos/react';
import { cn } from '@core/primitives/styling/browser/cn';

export function OzdashNavGroup({ children }: { children: ReactNode }) {
  const [state, setState] = useMemento(ozdashSidebarMemento);
  const open = state.navOpen;
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setState(toggleNavOpen)}
        className="flex h-6 w-full items-center gap-1.5 rounded-md px-2 text-xs text-foreground-passive transition-colors hover:text-foreground"
      >
        <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
        More
      </button>
      {open && children}
    </>
  );
}
