// Fork (ozimakov-st): renderer cache of PM task markers, read from the main
// process through `window.ozdash.listPmTasks` (see ozdash-pm-task-store.ts).
import { observable, runInAction } from 'mobx';
import { useEffect } from 'react';
import type { PmTaskInfo } from '../ozdash-pm-task';

type OzdashBridge = { listPmTasks?: () => Promise<Record<string, PmTaskInfo>> };

const infos = observable.map<string, PmTaskInfo>({}, { deep: false });
/** Task ids already seen; a new one triggers a refresh, since its marker may be new. */
const seen = new Set<string>();
let pending: Promise<void> | null = null;
let refreshAgain = false;

function refreshPmTasks(): void {
  const list = (globalThis as { ozdash?: OzdashBridge }).ozdash?.listPmTasks;
  if (!list) return;
  if (pending) {
    refreshAgain = true;
    return;
  }
  pending = list()
    .then((next) => {
      runInAction(() => infos.replace(Object.entries(next)));
    })
    .catch(() => {
      // Markers are cosmetic; keep the last known ones.
    })
    .finally(() => {
      pending = null;
      if (refreshAgain) {
        refreshAgain = false;
        refreshPmTasks();
      }
    });
}

/** The PM marker of a task, or null. Call from an `observer` component. */
export function usePmTaskInfo(taskId: string): PmTaskInfo | null {
  useEffect(() => {
    if (seen.has(taskId)) return;
    seen.add(taskId);
    refreshPmTasks();
  }, [taskId]);
  return infos.get(taskId) ?? null;
}
