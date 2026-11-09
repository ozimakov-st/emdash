// Fork (ozimakov-st): the Tickets board's main-process side. Reads tickets from the
// vault, watches it, restores and archives tickets, and opens (or starts) a ticket's PM
// session. Every write is followed by a vault sync (see vault-sync.ts).
//
// Lifecycle: new tickets are parked (no session). A ticket becomes active as soon as it
// gets a session (PM session from the board, a linked PM session, a child task), unless
// it is already active, waiting or blocked. Restore -> parked; Archive (parked) -> dropped.
import { watch, type FSWatcher } from 'node:fs';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Logger } from '@emdash/shared/logger';
import { ICON_FILE, ICON_MAX_BYTES, validatePixelSvg } from '../api/ticket-icon';
import {
  canPark,
  effectivePriority,
  isArchived,
  isStartedStatus,
  MAX_PRIORITY,
  MIN_PRIORITY,
  ticketSessionName,
  type CreateTicketInput,
  type CreateTicketResult,
  type LinkPmSessionInput,
  type OpenTicketSessionResult,
  type TicketActionResult,
  type TicketList,
  type TicketSummary,
} from '../api/tickets';
import {
  cleanTitle,
  linkPmSessionContent,
  newTicketContent,
  nextTicketId,
  ticketFolderName,
} from './ticket-creator';
import {
  addChildTaskContent,
  archiveParkedTicketContent,
  chain,
  parkTicketContent,
  restoreTicketContent,
  setPmSessionContent,
  setPriorityContent,
  setRankContent,
  startTicketContent,
  type ChildTaskLink,
  type EditResult,
} from './ticket-editor';
import { parseTicket } from './ticket-parser';
import { pullVault, resolveVaultRepo, runGit, syncVault, type GitRunner } from './vault-sync';

const DEFAULT_VAULT = 'Projects/work/vault';
/** The `Started (<reason>)` Log line when the board opens or starts a PM session. */
const BOARD_START_REASON = 'PM session opened from the OZdash board';
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

/** A ticket folder's `icon.svg` when it passes the strict check, else null. */
async function readIcon(folderPath: string): Promise<string | null> {
  try {
    const path = join(folderPath, ICON_FILE);
    if ((await stat(path)).size > ICON_MAX_BYTES) return null;
    const checked = validatePixelSvg(await readFile(path, 'utf8'));
    return checked.success ? checked.svg : null;
  } catch {
    return null;
  }
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
    if (parsed.success) {
      const icon = await readIcon(join(ticketsDir, folder));
      if (icon) parsed.ticket.icon = icon;
      result.tickets.push(parsed.ticket);
    } else result.warnings.push(`tickets/${folder}/ticket.md: ${parsed.error}`);
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
  /**
   * True when the task is live in the project: it exists, is not deleted and is not
   * archived. A `pm_session` that is not live counts as missing (Start creates a new one).
   */
  pmSessionExists(taskId: string, projectId: string): Promise<boolean>;
  run?: GitRunner;
  now?: () => Date;
};

export interface TicketsService {
  readonly vaultPath: string;
  list(): Promise<TicketList>;
  /** Archived ticket -> parked. */
  restore(folder: string): Promise<TicketActionResult>;
  /** Parked ticket -> dropped. */
  archive(folder: string): Promise<TicketActionResult>;
  /** Opens the PM session (creates it when missing) and starts a parked ticket. */
  openSession(folder: string, projectId: string): Promise<OpenTicketSessionResult>;
  /** The ticket with this id, or null. */
  findTicket(ticketId: string): Promise<TicketSummary | null>;
  /**
   * Adds a `child` Dependencies row and a Log line for a task created from the ticket,
   * and starts the ticket when it is not active, waiting or blocked.
   */
  linkChildTask(folder: string, link: ChildTaskLink): Promise<TicketActionResult>;
  /**
   * The ticket got a session elsewhere (MCP create_task with `ticket`): sets it active
   * with the Log line `Started (<reason>)`, unless it is already active, waiting or blocked.
   */
  startTicket(ticketId: string, reason: string): Promise<TicketActionResult>;
  /**
   * Writes a new parked ticket (no PM session), or, with `existingTask`, an active ticket
   * with that task as its PM session. Then syncs the vault once.
   */
  createTicket(input: CreateTicketInput): Promise<CreateTicketResult>;
  /**
   * Makes a PM project task the ticket's PM session (`pm_session` + Log line) and starts
   * the ticket, then syncs.
   */
  linkPmSession(input: LinkPmSessionInput): Promise<TicketActionResult>;
  /** Sets `priority:` (1-4) with a Log line, then syncs. */
  setPriority(folder: string, priority: number): Promise<TicketActionResult>;
  /**
   * Manual order of one priority group: `rank:` 10, 20, 30… in this order. One write
   * per ticket that changes, then one sync. Refuses tickets of different priorities.
   */
  reorder(folders: readonly string[]): Promise<TicketActionResult>;
  /** A ticket that is not parked or archived -> parked, with a Log line, then syncs. */
  park(folder: string): Promise<TicketActionResult>;
  /** Commits and pushes the vault now (after other writes), for example new icons. */
  sync(message: string): Promise<TicketActionResult>;
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
    if (edited.content === current.content) return { success: true }; // Nothing to write.
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

  /** Commits and pushes `vault/`. Returns a warning when it could not. */
  async function syncNow(message: string): Promise<string | undefined> {
    const repo = await resolveVaultRepo(vaultPath, run);
    if (!repo.success) return `Saved, but not synced. ${repo.error}`;
    const synced = await syncVault(repo.repo, message, run);
    if (synced.success) return undefined;
    logger.warn('ozdash tickets: vault sync failed', { error: synced.error });
    return `Saved, but the vault sync failed: ${synced.error}`;
  }

  /** Pulls, picks the next id, and writes the new ticket file (not synced yet). */
  async function writeNewTicket(
    title: string,
    description: string,
    pmSession: string,
    startedBy: string | undefined
  ): Promise<{ success: true; id: string; folder: string } | { success: false; error: string }> {
    const repo = await resolveVaultRepo(vaultPath, run);
    if (repo.success) {
      const pulled = await pullVault(repo.repo, run);
      if (!pulled.success)
        logger.warn('ozdash tickets: pull before create failed', { error: pulled.error });
    }
    const ticketsDir = join(vaultPath, 'tickets');
    try {
      await stat(vaultPath);
      await mkdir(ticketsDir, { recursive: true });
      const folders = (await readdir(ticketsDir, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
      const ids = (await readTickets(vaultPath)).tickets.map((ticket) => ticket.id);
      const id = nextTicketId(folders, ids);
      const folder = ticketFolderName(id, title);
      const template = await readFile(join(vaultPath, 'templates', 'ticket.md'), 'utf8').catch(
        () => null
      );
      const content = newTicketContent(template, {
        id,
        title,
        description,
        pmSession,
        ...(startedBy && { startedBy }),
        now: now(),
      });
      if (!content.success)
        return { success: false, error: `Bad ticket template: ${content.error}` };
      await mkdir(join(ticketsDir, folder));
      await writeFile(ticketFile(folder), content.content, { encoding: 'utf8', flag: 'wx' });
      return { success: true, id: String(id), folder };
    } catch (error) {
      return { success: false, error: `Could not write the ticket: ${String(error)}` };
    }
  }

  async function findTicket(ticketId: string): Promise<TicketSummary | null> {
    const list = await readTickets(vaultPath);
    return list.tickets.find((ticket) => ticket.id === ticketId) ?? null;
  }

  async function createTicket(input: CreateTicketInput): Promise<CreateTicketResult> {
    const title = cleanTitle(input.title);
    if (!title) return { success: false, error: 'The title is empty' };
    const { projectId, existingTask } = input;
    if (existingTask && !(await options.pmSessionExists(existingTask.id, projectId)))
      return { success: false, error: 'The task is not in the PM project' };
    // A new ticket is parked and gets no PM session; "Create ticket from this task"
    // links the existing task, so that ticket starts active.
    const written = await serialize(() =>
      writeNewTicket(
        title,
        input.description,
        existingTask?.id ?? '',
        existingTask && `PM session ${existingTask.name} linked in OZdash`
      )
    );
    if (!written.success) return written;
    const { id, folder } = written;
    const warning = await serialize(() => syncNow(`tickets: new #${id} (OZdash)`));
    return {
      success: true,
      ticketId: id,
      folder,
      projectId,
      taskId: existingTask?.id ?? null,
      ...(warning && { warning }),
    };
  }

  async function linkPmSession(input: LinkPmSessionInput): Promise<TicketActionResult> {
    const { folder, projectId, taskId, taskName } = input;
    if (!(await options.pmSessionExists(taskId, projectId)))
      return { success: false, error: 'The task is not in the PM project' };
    const found = await readTicket(folder);
    if (!found.success) return found;
    const current = found.ticket.pmSession;
    if (current === taskId) return { success: true };
    if (current && (await options.pmSessionExists(current, projectId)))
      return {
        success: false,
        error: `Ticket #${found.ticket.id} already has a PM session (${current})`,
      };
    return serialize(() =>
      editAndSync(
        folder,
        (content, ticket) =>
          chain(content, [
            (text) => linkPmSessionContent(text, taskId, taskName, now()),
            (text) =>
              startTicketContent(
                text,
                ticket.status,
                `PM session ${taskName} linked in OZdash`,
                now()
              ),
          ]),
        (ticket) => `tickets: link PM session ${taskName} to #${ticket.id} (OZdash)`
      )
    );
  }

  async function openSession(folder: string, projectId: string): Promise<OpenTicketSessionResult> {
    const found = await readTicket(folder);
    if (!found.success) return found;
    const { ticket } = found;
    if (ticket.pmSession && (await options.pmSessionExists(ticket.pmSession, projectId))) {
      const opened = {
        success: true as const,
        projectId,
        taskId: ticket.pmSession,
        created: false,
      };
      if (isStartedStatus(ticket.status)) return opened;
      // A parked ticket (for example parked by its PM session) is started again.
      const started = await serialize(() =>
        editAndSync(
          folder,
          (content, current) =>
            startTicketContent(content, current.status, BOARD_START_REASON, now()),
          (before) => `tickets: start #${before.id} (OZdash)`
        )
      );
      const warning = started.success
        ? started.warning
        : `The ticket was not set to active: ${started.error}`;
      return { ...opened, ...(warning && { warning }) };
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
        (content, current) =>
          chain(content, [
            (text) => setPmSessionContent(text, taskId, now()),
            (text) => startTicketContent(text, current.status, BOARD_START_REASON, now()),
          ]),
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

  async function reorder(folders: readonly string[]): Promise<TicketActionResult> {
    if (folders.length === 0) return { success: true };
    if (new Set(folders).size !== folders.length)
      return { success: false, error: 'A ticket is listed twice' };
    const repo = await resolveVaultRepo(vaultPath, run);
    if (repo.success) {
      const pulled = await pullVault(repo.repo, run);
      if (!pulled.success)
        logger.warn('ozdash tickets: pull before reorder failed', { error: pulled.error });
    }
    // Read all first: nothing is written when one ticket is missing or in another group.
    const found: Array<{ folder: string; ticket: TicketSummary; content: string }> = [];
    for (const folder of folders) {
      const current = await readTicket(folder);
      if (!current.success) return current;
      found.push({ folder, ticket: current.ticket, content: current.content });
    }
    const priority = effectivePriority(found[0]!.ticket.priority);
    if (found.some(({ ticket }) => effectivePriority(ticket.priority) !== priority))
      return { success: false, error: 'Tickets of different priorities cannot be reordered' };
    let written = 0;
    for (const [index, { folder, ticket, content }] of found.entries()) {
      const rank = (index + 1) * 10;
      if (ticket.rank === rank) continue;
      const edited = setRankContent(content, rank);
      if (!edited.success) return { success: false, error: `#${ticket.id}: ${edited.error}` };
      try {
        await writeFile(ticketFile(folder), edited.content, 'utf8');
      } catch (error) {
        return { success: false, error: `Could not write #${ticket.id}: ${String(error)}` };
      }
      written += 1;
    }
    if (written === 0) return { success: true };
    if (!repo.success) return { success: true, warning: `Saved, but not synced. ${repo.error}` };
    const synced = await syncVault(repo.repo, `tickets: reorder P${priority} (OZdash)`, run);
    if (!synced.success) {
      logger.warn('ozdash tickets: vault sync failed', { error: synced.error });
      return { success: true, warning: `Saved, but the vault sync failed: ${synced.error}` };
    }
    return { success: true };
  }

  return {
    vaultPath,

    list: () => readTickets(vaultPath),

    setPriority(folder, priority) {
      if (!Number.isInteger(priority) || priority < MIN_PRIORITY || priority > MAX_PRIORITY)
        return Promise.resolve({
          success: false,
          error: `Priority must be ${MIN_PRIORITY}-${MAX_PRIORITY}`,
        });
      return serialize(() =>
        editAndSync(
          folder,
          (content, ticket) =>
            ticket.priority === priority
              ? { success: true, content }
              : setPriorityContent(content, priority, ticket.rank !== null, now()),
          (ticket) => `tickets: #${ticket.id} priority P${priority} (OZdash)`
        )
      );
    },

    reorder(folders) {
      return serialize(() => reorder(folders));
    },

    async sync(message) {
      const warning = await serialize(() => syncNow(message));
      return warning ? { success: false, error: warning } : { success: true };
    },

    park(folder) {
      return serialize(() =>
        editAndSync(
          folder,
          (content, ticket) =>
            canPark(ticket)
              ? parkTicketContent(content, now())
              : { success: false, error: `Ticket #${ticket.id} is already ${ticket.status}` },
          (ticket) => `tickets: park #${ticket.id} (OZdash)`
        )
      );
    },

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

    archive(folder) {
      return serialize(() =>
        editAndSync(
          folder,
          (content, ticket) =>
            ticket.status === 'parked'
              ? archiveParkedTicketContent(content, now())
              : { success: false, error: `Ticket #${ticket.id} is not parked` },
          (ticket) => `tickets: archive #${ticket.id} from parked (OZdash)`
        )
      );
    },

    findTicket,

    linkChildTask(folder, link) {
      return serialize(() =>
        editAndSync(
          folder,
          (content, ticket) =>
            chain(content, [
              (text) => addChildTaskContent(text, link, now()),
              (text) =>
                startTicketContent(
                  text,
                  ticket.status,
                  `child task ${link.taskName} created in OZdash`,
                  now()
                ),
            ]),
          (ticket) => `tickets: link OZdash task ${link.taskName} to #${ticket.id}`
        )
      );
    },

    async startTicket(ticketId, reason) {
      const ticket = await findTicket(ticketId);
      if (!ticket)
        return { success: false, error: `Ticket #${ticketId} was not found in the vault` };
      if (isStartedStatus(ticket.status)) return { success: true };
      return serialize(() =>
        editAndSync(
          ticket.folder,
          (content, current) => startTicketContent(content, current.status, reason, now()),
          (before) => `tickets: start #${before.id} (OZdash)`
        )
      );
    },

    createTicket,

    linkPmSession,

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
