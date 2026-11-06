// Fork (ozimakov-st): renderer state of the Tickets board. The ticket list comes
// from the main process (`window.ozdash.listTickets`) and is pushed again whenever
// the vault changes (`onTicketsChanged`).
import { computed, makeAutoObservable, runInAction } from 'mobx';
import type {
  OpenTicketSessionResult,
  OzdashTicketsBridge,
  TicketActionResult,
  TicketList,
  TicketSummary,
} from '../tickets';

function bridge(): Partial<OzdashTicketsBridge> | undefined {
  return (globalThis as { ozdash?: Partial<OzdashTicketsBridge> }).ozdash;
}

class TicketsStore {
  list: TicketList | null = null;
  loadError: string | null = null;
  /** Whether the PM project's main panel shows the board (instead of a project tab). */
  boardSelected = true;
  private started = false;

  constructor() {
    makeAutoObservable<TicketsStore, 'started'>(this, {
      started: false,
      ensureStarted: false,
      ticketsByPmSession: computed,
    });
  }

  get tickets(): TicketSummary[] {
    return this.list?.tickets ?? [];
  }

  /** Tickets keyed by their `pm_session` task id. */
  get ticketsByPmSession(): Map<string, TicketSummary> {
    const map = new Map<string, TicketSummary>();
    for (const ticket of this.tickets) if (ticket.pmSession) map.set(ticket.pmSession, ticket);
    return map;
  }

  /** Loads the list once and subscribes to changes. Safe to call many times. */
  ensureStarted(): void {
    if (this.started) return;
    const api = bridge();
    if (!api?.listTickets) return;
    this.started = true;
    api.onTicketsChanged?.((next) => this.setList(next));
    void this.reload();
  }

  async reload(): Promise<void> {
    const api = bridge();
    if (!api?.listTickets) return;
    try {
      const next = await api.listTickets();
      this.setList(next);
    } catch (error) {
      runInAction(() => {
        this.loadError = error instanceof Error ? error.message : String(error);
      });
    }
  }

  setList(next: TicketList): void {
    this.list = next;
    this.loadError = null;
  }

  setBoardSelected(selected: boolean): void {
    this.boardSelected = selected;
  }

  async restore(folder: string): Promise<TicketActionResult> {
    const api = bridge();
    if (!api?.restoreTicket) return { success: false, error: 'Not available outside OZdash' };
    try {
      return await api.restoreTicket(folder);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async openSession(folder: string, projectId: string): Promise<OpenTicketSessionResult> {
    const api = bridge();
    if (!api?.openTicketSession) return { success: false, error: 'Not available outside OZdash' };
    try {
      return await api.openTicketSession(folder, projectId);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}

export const ticketsStore = new TicketsStore();

/** The ticket whose PM session is this task, or null. Call from an `observer` component. */
export function ticketForPmSession(taskId: string): TicketSummary | null {
  ticketsStore.ensureStarted();
  return ticketsStore.ticketsByPmSession.get(taskId) ?? null;
}
