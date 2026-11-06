// Fork (ozimakov-st): the Tickets board's main-process side. Reads tickets from the
// vault, watches it, restores archived tickets, and opens (or starts) a ticket's PM
// session. Every write is followed by a vault sync (see vault-sync.ts).
import { watch, type FSWatcher } from 'node:fs';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Logger } from '@emdash/shared/logger';
import {
  isArchived,
  ticketSessionName,
  type OpenTicketSessionResult,
  type TicketActionResult,
  type TicketList,
  type TicketSummary,
} from '../api/tickets';
import { restoreTicketContent, setPmSessionContent, type EditResult } from './ticket-editor';
import { parseTicket } from './ticket-parser';
import { pullVault, resolveVaultRepo, runGit, syncVault, type GitRunner } from './vault-sync';

const DEFAULT_VAULT = 'Projects/work/vault';
const WATCH_DEBOUNCE_MS = 400;
const POLL_MS = 5_000;

/** `OZDASH_VAULT_PATH` (with `~` expanded), else `~/Projects/work/vault`. */
export function resolveVaultPath(override: string | undefined, homeDir: string): string {
  const raw = override?.trim();
  if (!raw) return join(homeDir, DEFAULT_VAULT);
  if (raw === '~') return homeDir;
  if (raw.startsWith('~/')) return join(homeDir, raw.slice(2));
  return raw;
}

/** Reads every `tickets/*\/ticket.md`; files that do not parse become warnings. */
export async function readTickets(vaultPath: string): Promise<TicketList> {
  const ticketsDir = join(vaultPath, 'tickets');
  const result: TicketList = { vaultPath, tickets: [], warnings: [], error: null };
  try {
    await stat(vaultPath);
  } catch {
    return { ...result, error: `No vault at ${vaultPath}` };
  }
  let folders: string[];
  try {
    const entries = await readdir(ticketsDir, { withFileTypes: true });
    folders = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return result; // No tickets folder yet: an empty board.
  }
  for (const folder of folders.sort()) {
    let content: string;
    try {
      content = await readFile(join(ticketsDir, folder, 'ticket.md'), 'utf8');
    } catch {
      continue; // A folder without ticket.md (for example one being created).
    }
    const parsed = parseTicket(content, folder);
    if (parsed.success) result.tickets.push(parsed.ticket);
    else result.warnings.push(`tickets/${folder}/ticket.md: ${parsed.error}`);
  }
  return result;
}

export type CreatePmSession = (input: {
  projectId: string;
  name: string;
  prompt: string;
}) => Promise<
  { success: true; taskId: string; warning?: string } | { success: false; error: string }
>;

export type TicketsServiceOptions = {
  vaultPath: string;
  logger: Logger;
  /** Creates a task in the PM project (the MCP create_task path). */
  createPmSession: CreatePmSession;
  /** True when the task exists (not deleted) in the project. */
  pmSessionExists(taskId: string, projectId: string): Promise<boolean>;
  run?: GitRunner;
  now?: () => Date;
};

export interface TicketsService {
  readonly vaultPath: string;
  list(): Promise<TicketList>;
  restore(folder: string): Promise<TicketActionResult>;
  openSession(folder: string, projectId: string): Promise<OpenTicketSessionResult>;
  /** Calls `onChange` with the new list whenever the tickets change. Returns a stop function. */
  watch(onChange: (list: TicketList) => void): () => void;
}

function isPlainFolderName(folder: string): boolean {
  return /^[^/\\]+$/.test(folder) && folder !== '.' && folder !== '..';
}

export function createTicketsService(options: TicketsServiceOptions): TicketsService {
  const { vaultPath, logger } = options;
  const run = options.run ?? runGit;
  const now = options.now ?? (() => new Date());
  const ticketFile = (folder: string) => join(vaultPath, 'tickets', folder, 'ticket.md');
  /** Vault writes and syncs run one at a time. */
  let queue: Promise<unknown> = Promise.resolve();
  const serialize = <T>(task: () => Promise<T>): Promise<T> => {
    const next = queue.then(task, task);
    queue = next.catch(() => undefined);
    return next;
  };
  const opening = new Map<string, Promise<OpenTicketSessionResult>>();

  async function readTicket(
    folder: string
  ): Promise<
    { success: true; ticket: TicketSummary; content: string } | { success: false; error: string }
  > {
    if (!isPlainFolderName(folder))
      return { success: false, error: `Invalid ticket folder "${folder}"` };
    let content: string;
    try {
      content = await readFile(ticketFile(folder), 'utf8');
    } catch {
      return { success: false, error: `Ticket file not found: tickets/${folder}/ticket.md` };
    }
    const parsed = parseTicket(content, folder);
    if (!parsed.success)
      return { success: false, error: `tickets/${folder}/ticket.md: ${parsed.error}` };
    return { success: true, ticket: parsed.ticket, content };
  }

  /**
   * Pull, re-read, edit, write, then sync. Returns the ticket as it was before the edit,
   * and a warning when the file was written but the sync failed.
   */
  async function editAndSync(
    folder: string,
    edit: (
      content: string,
      ticket: TicketSummary
    ) => EditResult | { success: false; error: string },
    message: (ticket: TicketSummary) => string
  ): Promise<{ success: true; warning?: string } | { success: false; error: string }> {
    const repo = await resolveVaultRepo(vaultPath, run);
    if (repo.success) {
      const pulled = await pullVault(repo.repo, run);
      if (!pulled.success)
        logger.warn('ozdash tickets: pull before edit failed', { error: pulled.error });
    }
    const current = await readTicket(folder);
    if (!current.success) return current;
    const edited = edit(current.content, current.ticket);
    if (!edited.success) return edited;
    try {
      await writeFile(ticketFile(folder), edited.content, 'utf8');
    } catch (error) {
      return { success: false, error: `Could not write the ticket: ${String(error)}` };
    }
    if (!repo.success) return { success: true, warning: `Saved, but not synced. ${repo.error}` };
    const synced = await syncVault(repo.repo, message(current.ticket), run);
    if (!synced.success) {
      logger.warn('ozdash tickets: vault sync failed', { error: synced.error });
      return { success: true, warning: `Saved, but the vault sync failed: ${synced.error}` };
    }
    return { success: true };
  }

  async function openSession(folder: string, projectId: string): Promise<OpenTicketSessionResult> {
    const found = await readTicket(folder);
    if (!found.success) return found;
    const { ticket } = found;
    if (ticket.pmSession && (await options.pmSessionExists(ticket.pmSession, projectId))) {
      return { success: true, projectId, taskId: ticket.pmSession, created: false };
    }
    const created = await options.createPmSession({
      projectId,
      name: ticketSessionName(ticket),
      prompt: `/oz-pm ${ticket.id}`,
    });
    if (!created.success) return created;
    const { taskId } = created;
    const saved = await serialize(() =>
      editAndSync(
        folder,
        (content) => setPmSessionContent(content, taskId, now()),
        (before) => `tickets: PM session for #${before.id} (OZdash)`
      )
    );
    const warnings = [
      created.warning,
      saved.success ? saved.warning : `The PM session was not saved in the ticket: ${saved.error}`,
    ].filter((text): text is string => !!text);
    return {
      success: true,
      projectId,
      taskId,
      created: true,
      ...(warnings.length > 0 && { warning: warnings.join(' ') }),
    };
  }

  return {
    vaultPath,

    list: () => readTickets(vaultPath),

    restore(folder) {
      return serialize(() =>
        editAndSync(
          folder,
          (content, ticket) =>
            isArchived(ticket)
              ? restoreTicketContent(content, now())
              : { success: false, error: `Ticket #${ticket.id} is not archived` },
          (ticket) => `tickets: restore #${ticket.id} from archive (OZdash)`
        )
      );
    },

    openSession(folder, projectId) {
      // A second click while the first one still creates the session waits for it.
      const key = `${projectId}\n${folder}`;
      const running = opening.get(key);
      if (running) return running;
      const started = openSession(folder, projectId).finally(() => opening.delete(key));
      opening.set(key, started);
      return started;
    },

    watch(onChange) {
      let last = '';
      let timer: ReturnType<typeof setTimeout> | null = null;
      let stopped = false;
      const refresh = () => {
        void readTickets(vaultPath)
          .then((list) => {
            const key = JSON.stringify(list);
            if (stopped || key === last) return;
            last = key;
            onChange(list);
          })
          .catch((error) => logger.warn('ozdash tickets: read failed', { error: String(error) }));
      };
      const schedule = () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(refresh, WATCH_DEBOUNCE_MS);
      };

      // The vault folder may not exist yet, or fs.watch may fail: poll then.
      let watcher: FSWatcher | null = null;
      let poll: ReturnType<typeof setInterval> | null = null;
      try {
        watcher = watch(vaultPath, { recursive: true }, (_event, file) => {
          const name = file ? String(file) : '';
          if (!name || name.startsWith('tickets') || name === '.') schedule();
        });
        watcher.on('error', (error) => {
          logger.warn('ozdash tickets: watch failed, polling instead', { error: String(error) });
          watcher?.close();
          watcher = null;
          poll ??= setInterval(refresh, POLL_MS);
        });
      } catch {
        poll = setInterval(refresh, POLL_MS);
      }
      refresh();
      return () => {
        stopped = true;
        if (timer) clearTimeout(timer);
        if (poll) clearInterval(poll);
        watcher?.close();
      };
    },
  };
}
