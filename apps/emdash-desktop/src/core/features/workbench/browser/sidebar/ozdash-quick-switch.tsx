// Fork (ozimakov-st): Cmd+1…9, Cmd+0 open the first 10 task rows of the project tree
// (rule: ozdash/api/quick-switch.ts; commands: ozdash/contributions/commands.ts).
// While Cmd is held (after a short delay), those rows show their number.
import { Kbd } from '@emdash/ui/react/primitives';
import { observable, runInAction } from 'mobx';
import { useEffect } from 'react';
import {
  quickSwitchDigitFor,
  quickSwitchTarget,
  QUICK_SWITCH_SLOTS,
} from '@core/features/ozdash/api/quick-switch';
import { taskViewDef } from '@core/features/tasks/contributions/views';
import { getSidebarStore } from '@core/features/workbench/contributions/browser/app-stores';
import { detectPlatformContext } from '@core/primitives/keybindings/api';
import { getNavigation } from '@core/primitives/navigation/browser/navigation-selectors';
import { enabled, hidden } from '@core/primitives/view-scopes/api';

/** Wait this long before showing the numbers, so normal Cmd shortcuts do not flash them. */
const HINT_DELAY_MS = 150;

const hintVisible = observable.box(false);

function slot(index: number) {
  return () => ({
    availability: () =>
      quickSwitchTarget(getSidebarStore().visibleTaskEntries, index) ? enabled : hidden,
    execute: () => {
      const target = quickSwitchTarget(getSidebarStore().visibleTaskEntries, index);
      if (target) getNavigation().navigate(taskViewDef(target));
    },
  });
}

/** Window-scope handlers for `ozdash.quickSwitch1…10` (see window-scope.tsx). */
export function ozdashQuickSwitchImpl() {
  return {
    'ozdash.quickSwitch1': slot(0),
    'ozdash.quickSwitch2': slot(1),
    'ozdash.quickSwitch3': slot(2),
    'ozdash.quickSwitch4': slot(3),
    'ozdash.quickSwitch5': slot(4),
    'ozdash.quickSwitch6': slot(5),
    'ozdash.quickSwitch7': slot(6),
    'ozdash.quickSwitch8': slot(7),
    'ozdash.quickSwitch9': slot(8),
    'ozdash.quickSwitch10': slot(QUICK_SWITCH_SLOTS - 1),
  } as const;
}

/**
 * Shows the row numbers while Cmd (Ctrl off macOS) is held alone. Any other key,
 * releasing Cmd, or leaving the window hides them. Visual only: the shortcuts
 * themselves go through the keybinding dispatcher.
 */
export function useOzdashQuickSwitchHint(): void {
  useEffect(() => {
    const modKey = detectPlatformContext().os === 'mac' ? 'Meta' : 'Control';
    let timer: ReturnType<typeof setTimeout> | undefined;
    const set = (visible: boolean) => runInAction(() => hintVisible.set(visible));
    const hide = () => {
      clearTimeout(timer);
      timer = undefined;
      if (hintVisible.get()) set(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== modKey) return hide();
      if (event.repeat) return;
      hide();
      if (event.shiftKey || event.altKey) return;
      timer = setTimeout(() => set(true), HINT_DELAY_MS);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === modKey) hide();
    };
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', hide);
    return () => {
      hide();
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('blur', hide);
    };
  }, []);
}

/** The row's number while Cmd is held, or null. Call from an `observer` component. */
export function ozdashQuickSwitchDigit(projectId: string, taskId: string): string | null {
  if (!hintVisible.get()) return null;
  return quickSwitchDigitFor(
    getSidebarStore().visibleTaskEntries,
    (entry) => entry.projectId === projectId && entry.taskId === taskId
  );
}

/** The number chip that replaces a row's trailing items while Cmd is held. */
export function OzdashQuickSwitchBadge({ digit }: { digit: string }) {
  return (
    <Kbd aria-label={`Cmd+${digit}`} className="min-w-5 justify-center">
      {digit}
    </Kbd>
  );
}
