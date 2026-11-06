// Fork (ozimakov-st): renderer state of the Tickets board. The ticket list comes
// from the main process (`window.ozdash.listTickets`) and is pushed again whenever
// the vault changes (`onTicketsChanged`).
import { computed, makeAutoObservable, runInAction } from 'mobx';
import {
  pmTaskHasNoTicket,
  type CreateTicketInput,
  type CreateTicketResult,
  type LinkPmSessionInput,
  type OpenTicketSessionResult,
  type OzdashTicketsBridge,
  type TicketActionResult,
  type TicketList,
  type TicketSummary,
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

  async createTicket(input: CreateTicketInput): Promise<CreateTicketResult> {
    const api = bridge();
    if (!api?.createTicket) return { success: false, error: 'Not available outside OZdash' };
    try {
      return await api.createTicket(input);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
      void this.reload();
    }
  }

  async linkPmSession(input: LinkPmSessionInput): Promise<TicketActionResult> {
    const api = bridge();
    if (!api?.linkPmSession) return { success: false, error: 'Not available outside OZdash' };
    try {
      return await api.linkPmSession(input);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
      void this.reload();
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

/** True when this PM project task is no ticket's PM session. Call from an `observer`. */
export function pmTaskNeedsTicket(taskId: string): boolean {
  ticketsStore.ensureStarted();
  return pmTaskHasNoTicket(taskId, ticketsStore.list);
}

/** The ticket whose PM session is this task, or null. Call from an `observer` component. */
export function ticketForPmSession(taskId: string): TicketSummary | null {
  ticketsStore.ensureStarted();
  return ticketsStore.ticketsByPmSession.get(taskId) ?? null;
}
