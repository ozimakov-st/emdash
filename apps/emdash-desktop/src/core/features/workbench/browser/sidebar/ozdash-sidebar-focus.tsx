// Fork (ozimakov-st): the sidebar Focus view switch (rule: ozdash/api/sidebar-focus.ts).
// A toggle in the Projects header, and a one-line footer under the list that says what
// is hidden ("3 projects · 7 PM tasks hidden — Show all").
import { Button, Tooltip } from '@emdash/ui/react/primitives';
import { Eye, EyeOff } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import {
  isPmManagedTaskInWindow,
  isSidebarFocusOn,
  toggleSidebarFocus,
} from '@core/features/ozdash/api/browser/sidebar-focus';
import { focusHiddenText } from '@core/features/ozdash/api/sidebar-focus';
import { getSidebarStore } from '@core/features/workbench/contributions/browser/app-stores';

export const OzdashFocusToggle = observer(function OzdashFocusToggle() {
  const focusOn = isSidebarFocusOn();
  const label = focusOn ? 'Show all projects and PM tasks' : 'Focus';
  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="xs"
            icon
            aria-label={label}
            aria-pressed={!focusOn}
            onClick={toggleSidebarFocus}
          >
            {focusOn ? <Eye /> : <EyeOff />}
          </Button>
        }
      />
      <Tooltip.Content>{label}</Tooltip.Content>
    </Tooltip.Root>
  );
});

export const OzdashFocusFooter = observer(function OzdashFocusFooter() {
  const focus = getSidebarStore().focus;
  const text = focus ? focusHiddenText(focus) : null;
  if (!text) return null;
  return (
    <button
      type="button"
      onClick={toggleSidebarFocus}
      className="mt-1 flex h-6 w-full items-center truncate rounded-md px-2 text-left text-xs text-foreground-passive transition-colors hover:text-foreground"
    >
      {text} — Show all
    </button>
  );
});

/** PM-managed rows (seen in "show all", or while open) are quieter. */
export function ozdashPmManagedRowClass(taskId: string, isActive: boolean): string | false {
  return !isActive && isPmManagedTaskInWindow(taskId) && 'opacity-60';
}
