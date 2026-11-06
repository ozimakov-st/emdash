// Fork (ozimakov-st): renderer cache of task ticket markers, read from the main
// process through `window.ozdash.listTaskTickets` (see ozdash-task-ticket-store.ts).
import { observable, runInAction } from 'mobx';
import { useEffect } from 'react';
import type { TaskTicketInfo } from '../ozdash-task-ticket';

type OzdashBridge = { listTaskTickets?: () => Promise<Record<string, TaskTicketInfo>> };

const infos = observable.map<string, TaskTicketInfo>({}, { deep: false });
/** Task ids already seen; a new one triggers a refresh, since its marker may be new. */
const seen = new Set<string>();
let pending: Promise<void> | null = null;
let refreshAgain = false;

function refreshTaskTickets(): void {
  const list = (globalThis as { ozdash?: OzdashBridge }).ozdash?.listTaskTickets;
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
        refreshTaskTickets();
      }
    });
}

/** The ticket marker of a task, or null. Call from an `observer` component. */
export function useTaskTicketInfo(taskId: string): TaskTicketInfo | null {
  useEffect(() => {
    if (seen.has(taskId)) return;
    seen.add(taskId);
    refreshTaskTickets();
  }, [taskId]);
  return infos.get(taskId) ?? null;
}
