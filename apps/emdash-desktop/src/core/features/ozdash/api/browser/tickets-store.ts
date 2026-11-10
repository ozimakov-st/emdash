// Fork (ozimakov-st): renderer state of the Tickets board. The ticket list comes
// from the main process (`window.ozdash.listTickets`) and is pushed again whenever
// the vault changes (`onTicketsChanged`).
import { computed, makeAutoObservable, observable, runInAction } from 'mobx';
import {
  bumpPriority,
  effectivePriority,
  pmTaskHasNoTicket,
  type CreateTicketInput,
  type CreateTicketResult,
  type EditTicketInput,
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

/** ▲/▼ clicks on one ticket within this time become one write (and one vault sync). */
export const PRIORITY_DEBOUNCE_MS = 1_000;

/** Values the board shows before the main process has written them. */
type LocalEdit = { priority?: number; rank?: number };

export type TicketsNotice = { tone: 'error' | 'warning'; text: string };

export class TicketsStore {
  list: TicketList | null = null;
  loadError: string | null = null;
  /** Whether the PM project's main panel shows the board (instead of a project tab). */
  boardSelected = true;
  /** The last problem of a background write (priority, order); the board shows it. */
  notice: TicketsNotice | null = null;
  /** Optimistic priority / rank by ticket folder, until the write is done. */
  private readonly localEdits = observable.map<string, LocalEdit>();
  private readonly priorityTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private started = false;

  constructor() {
    makeAutoObservable<TicketsStore, 'started' | 'priorityTimers'>(this, {
      started: false,
      priorityTimers: false,
      ensureStarted: false,
      tickets: computed,
      ticketsByPmSession: computed,
    });
  }

  /** The tickets with local (not yet written) priority and rank changes applied. */
  get tickets(): TicketSummary[] {
    const tickets = this.list?.tickets ?? [];
    if (this.localEdits.size === 0) return tickets;
    return tickets.map((ticket) => {
      const edit = this.localEdits.get(ticket.folder);
      return edit ? { ...ticket, ...edit } : ticket;
    });
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

  setNotice(notice: TicketsNotice | null): void {
    this.notice = notice;
  }

  private setLocalEdit(folder: string, edit: LocalEdit): void {
    this.localEdits.set(folder, { ...this.localEdits.get(folder), ...edit });
  }

  private clearLocalEdit(folder: string, key: keyof LocalEdit): void {
    const edit = this.localEdits.get(folder);
    if (!edit) return;
    const { [key]: _removed, ...rest } = edit;
    if (Object.keys(rest).length === 0) this.localEdits.delete(folder);
    else this.localEdits.set(folder, rest);
  }

  /**
   * ▲ (`up`) or ▼ (`down`) on a ticket's priority. The board shows the new value at
   * once; the write happens when the clicks stop for PRIORITY_DEBOUNCE_MS. False at
   * the ends (P1 up, P4 down).
   */
  bumpPriority(folder: string, direction: 'up' | 'down'): boolean {
    const ticket = this.tickets.find((entry) => entry.folder === folder);
    if (!ticket) return false;
    const next = bumpPriority(ticket.priority, direction);
    if (next === null) return false;
    this.setLocalEdit(folder, { priority: next });
    const timer = this.priorityTimers.get(folder);
    if (timer) clearTimeout(timer);
    this.priorityTimers.set(
      folder,
      setTimeout(() => void this.flushPriority(folder), PRIORITY_DEBOUNCE_MS)
    );
    return true;
  }

  /** Writes the shown priority of a ticket (no write when it is back to the file value). */
  async flushPriority(folder: string): Promise<void> {
    this.priorityTimers.delete(folder);
    const wanted = this.localEdits.get(folder)?.priority;
    if (wanted === undefined) return;
    const saved = this.list?.tickets.find((entry) => entry.folder === folder);
    if (!saved || effectivePriority(saved.priority) === wanted) {
      this.clearLocalEdit(folder, 'priority');
      return;
    }
    const result = await this.call(
      (api) => api.setTicketPriority?.(folder, wanted),
      `set the priority of #${saved.id}`
    );
    // A newer click is waiting for its own write: keep its value.
    if (this.priorityTimers.has(folder)) return;
    if (result) await this.reload();
    runInAction(() => this.clearLocalEdit(folder, 'priority'));
  }

  /** Manual order of one priority group (folders in the new order). */
  async reorder(folders: string[]): Promise<void> {
    folders.forEach((folder, index) => this.setLocalEdit(folder, { rank: (index + 1) * 10 }));
    const result = await this.call((api) => api.reorderTickets?.(folders), 'save the order');
    if (result) await this.reload();
    runInAction(() => folders.forEach((folder) => this.clearLocalEdit(folder, 'rank')));
  }

  /** Runs a bridge call; problems become the store notice. False when it failed. */
  private async call(
    action: (api: Partial<OzdashTicketsBridge>) => Promise<TicketActionResult> | undefined,
    what: string
  ): Promise<boolean> {
    const api = bridge();
    let result: TicketActionResult | undefined;
    try {
      result = api ? await action(api) : undefined;
    } catch (error) {
      result = { success: false, error: error instanceof Error ? error.message : String(error) };
    }
    if (!result) result = { success: false, error: 'Not available outside OZdash' };
    if (!result.success) {
      this.setNotice({ tone: 'error', text: `Could not ${what}: ${result.error}` });
      return false;
    }
    if (result.warning) this.setNotice({ tone: 'warning', text: result.warning });
    return true;
  }

  async park(folder: string): Promise<TicketActionResult> {
    const api = bridge();
    if (!api?.parkTicket) return { success: false, error: 'Not available outside OZdash' };
    try {
      return await api.parkTicket(folder);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
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

  async archive(folder: string): Promise<TicketActionResult> {
    const api = bridge();
    if (!api?.archiveTicket) return { success: false, error: 'Not available outside OZdash' };
    try {
      return await api.archiveTicket(folder);
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

  async editTicket(input: EditTicketInput): Promise<TicketActionResult> {
    const api = bridge();
    if (!api?.editTicket) return { success: false, error: 'Not available outside OZdash' };
    try {
      return await api.editTicket(input);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
      void this.reload();
    }
  }

  /** The ticket as the file has it (no ▲/▼ values that are not written yet), or null. */
  savedTicket(folder: string): TicketSummary | null {
    return this.list?.tickets.find((ticket) => ticket.folder === folder) ?? null;
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
