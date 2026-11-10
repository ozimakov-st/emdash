// Fork (ozimakov-st): IPC for the Tickets board (see core/features/ozdash). The
// renderer invokes list/restore/archive/open-session; the main process pushes the list
// to every window when the vault changes.
import { homedir } from 'node:os';
import type { Logger } from '@emdash/shared/logger';
import { and, eq, isNull } from 'drizzle-orm';
import { BrowserWindow, ipcMain } from 'electron';
import { createTaskFromPrompt } from '@core/features/mcp/node/server/create-task-from-prompt';
import type {
  McpTicketTaskCreated,
  McpToolDependencies,
} from '@core/features/mcp/node/server/dependencies';
import { taskTicketStoreOf } from '@core/features/mcp/node/server/ozdash-task-ticket-store';
import { sendTaskMessage } from '@core/features/mcp/node/server/task-conversation';
import { createOzTicketsIssueProvider } from '@core/features/ozdash/api/node/oz-tickets-issue-provider';
import type { LinkTicketTaskInput } from '@core/features/ozdash/api/ticket-issues';
import {
  OZDASH_TICKETS_CHANNELS,
  type CreateTicketInput,
  type EditTicketInput,
  type LinkPmSessionInput,
} from '@core/features/ozdash/api/tickets';
import { linkTicketTask } from '@core/features/ozdash/node/link-ticket-task';
import {
  claudeIconRunner,
  createIconGenerator,
  ticketIconsEnabled,
} from '@core/features/ozdash/node/ticket-icons';
import { createTicketsService, resolveVaultPath } from '@core/features/ozdash/node/tickets-service';
import { projects, tasks } from '@core/services/app-db/node/schema';

function vaultPath(): string {
  return resolveVaultPath(process.env.OZDASH_VAULT_PATH, homedir());
}

/** "OZ Tickets": the vault tickets as an issue source for new tasks. */
export function createOzdashTicketsIssueProvider() {
  return createOzTicketsIssueProvider({ vaultPath: vaultPath() });
}

function isLinkInput(value: unknown): value is LinkTicketTaskInput {
  if (!value || typeof value !== 'object') return false;
  const input = value as Record<string, unknown>;
  return (
    typeof input.ticketId === 'string' &&
    /^[\w.-]{1,32}$/.test(input.ticketId) &&
    typeof input.taskId === 'string' &&
    input.taskId.length > 0 &&
    typeof input.taskName === 'string' &&
    typeof input.projectId === 'string' &&
    typeof input.prompt === 'string'
  );
}

/** Set while the tickets IPC is registered; see `ozdashTicketTaskCreated`. */
let onTicketTaskCreated: ((event: McpTicketTaskCreated) => void) | null = null;

/**
 * MCP create_task made a task with a `ticket`: the ticket got a session, so a parked
 * ticket becomes active. Fire and forget; problems are logged.
 */
export function ozdashTicketTaskCreated(event: McpTicketTaskCreated): void {
  onTicketTaskCreated?.(event);
}

const MAX_TITLE = 200;
const MAX_DESCRIPTION = 20_000;

function isShortString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

function isCreateTicketInput(value: unknown): value is CreateTicketInput {
  if (!value || typeof value !== 'object') return false;
  const input = value as Record<string, unknown>;
  const task = input.existingTask as Record<string, unknown> | undefined;
  return (
    isShortString(input.title, MAX_TITLE) &&
    typeof input.description === 'string' &&
    input.description.length <= MAX_DESCRIPTION &&
    (input.priority === undefined || typeof input.priority === 'number') &&
    isShortString(input.projectId, 200) &&
    (task === undefined ||
      (!!task &&
        typeof task === 'object' &&
        isShortString(task.id, 64) &&
        typeof task.name === 'string'))
  );
}

function isEditTicketInput(value: unknown): value is EditTicketInput {
  if (!value || typeof value !== 'object') return false;
  const input = value as Record<string, unknown>;
  const values = input.values as Record<string, unknown> | null | undefined;
  const base = input.base as Record<string, unknown> | null | undefined;
  return (
    isShortString(input.folder, 200) &&
    !!values &&
    typeof values === 'object' &&
    isShortString(values.title, MAX_TITLE) &&
    typeof values.goal === 'string' &&
    values.goal.length <= MAX_DESCRIPTION &&
    typeof values.priority === 'number' &&
    !!base &&
    typeof base === 'object' &&
    typeof base.title === 'string' &&
    typeof base.goal === 'string' &&
    (base.priority === null || typeof base.priority === 'number')
  );
}

function isLinkPmSessionInput(value: unknown): value is LinkPmSessionInput {
  if (!value || typeof value !== 'object') return false;
  const input = value as Record<string, unknown>;
  return (
    isShortString(input.folder, 200) &&
    isShortString(input.projectId, 200) &&
    isShortString(input.taskId, 64) &&
    typeof input.taskName === 'string'
  );
}

/** Registers the tickets IPC handlers and the vault watcher. Returns a dispose function. */
export function registerOzdashTickets(mcp: McpToolDependencies, logger: Logger): () => void {
  const service = createTicketsService({
    vaultPath: vaultPath(),
    logger,
    createPmSession: async ({ projectId, name, prompt }) => {
      const created = await createTaskFromPrompt(mcp, {
        projectId,
        name,
        prompt,
        provider: 'claude',
      });
      if (!created.success) return created;
      return {
        success: true,
        taskId: created.data.taskId,
        ...(created.data.warning && { warning: created.data.warning }),
      };
    },
    pmSessionExists: async (taskId, projectId) => {
      const rows = await mcp.db
        .select({ id: tasks.id })
        .from(tasks)
        .where(
          and(
            eq(tasks.id, taskId),
            eq(tasks.projectId, projectId),
            isNull(tasks.deletedAt),
            // A PM session that closed itself archives its task: treat it as missing.
            isNull(tasks.archivedAt)
          )
        )
        .limit(1);
      return rows.length > 0;
    },
  });

  const taskTickets = taskTicketStoreOf(mcp);
  const firstRow = <T>(rows: T[]): T | undefined => rows[0];

  onTicketTaskCreated = ({ taskName, ticket }) => {
    void service
      .startTicket(ticket.id, `child task ${taskName} created via MCP create_task`)
      .then((result) => {
        if (!result.success || result.warning) {
          logger.warn('ozdash tickets: could not start the ticket of an MCP task', {
            ticketId: ticket.id,
            error: result.success ? result.warning : result.error,
          });
        }
      })
      .catch((error: unknown) =>
        logger.warn('ozdash tickets: could not start the ticket of an MCP task', {
          ticketId: ticket.id,
          error: String(error),
        })
      );
  };

  const {
    list,
    restore,
    archive,
    openSession,
    linkTask,
    createTicket,
    linkPmSession,
    setPriority,
    reorder,
    park,
    edit,
    changed,
  } = OZDASH_TICKETS_CHANNELS;
  ipcMain.handle(list, () => service.list());
  ipcMain.handle(restore, (_event, folder: unknown) =>
    typeof folder === 'string'
      ? service.restore(folder)
      : { success: false, error: 'Invalid ticket folder' }
  );
  ipcMain.handle(archive, (_event, folder: unknown) =>
    typeof folder === 'string'
      ? service.archive(folder)
      : { success: false, error: 'Invalid ticket folder' }
  );
  ipcMain.handle(openSession, (_event, folder: unknown, projectId: unknown) =>
    typeof folder === 'string' && typeof projectId === 'string'
      ? service.openSession(folder, projectId)
      : { success: false, error: 'Invalid ticket folder or project' }
  );
  ipcMain.handle(linkTask, (_event, input: unknown) =>
    isLinkInput(input)
      ? linkTicketTask(
          {
            tickets: service,
            setMarker: (taskId, ticket) => taskTickets.set(taskId, ticket),
            projectName: async (projectId) =>
              firstRow(
                await mcp.db
                  .select({ name: projects.name })
                  .from(projects)
                  .where(eq(projects.id, projectId))
                  .limit(1)
              )?.name ?? null,
            taskProject: async (taskId) =>
              firstRow(
                await mcp.db
                  .select({ projectId: tasks.projectId })
                  .from(tasks)
                  .where(and(eq(tasks.id, taskId), isNull(tasks.deletedAt)))
                  .limit(1)
              )?.projectId ?? null,
            sendMessage: async (message) => {
              const sent = await sendTaskMessage(mcp, message);
              return sent.success ? { success: true } : { success: false, error: sent.error };
            },
            logger,
          },
          input
        )
      : { success: false, error: 'Invalid ticket link' }
  );
  ipcMain.handle(createTicket, (_event, input: unknown) =>
    isCreateTicketInput(input)
      ? service.createTicket(input)
      : { success: false, error: 'Invalid new ticket' }
  );
  ipcMain.handle(linkPmSession, (_event, input: unknown) =>
    isLinkPmSessionInput(input)
      ? service.linkPmSession(input)
      : { success: false, error: 'Invalid PM session link' }
  );
  ipcMain.handle(setPriority, (_event, folder: unknown, priority: unknown) =>
    typeof folder === 'string' && typeof priority === 'number'
      ? service.setPriority(folder, priority)
      : { success: false, error: 'Invalid ticket folder or priority' }
  );
  ipcMain.handle(reorder, (_event, folders: unknown) =>
    Array.isArray(folders) &&
    folders.length <= 500 &&
    folders.every((folder) => typeof folder === 'string')
      ? service.reorder(folders as string[])
      : { success: false, error: 'Invalid ticket order' }
  );
  ipcMain.handle(park, (_event, folder: unknown) =>
    typeof folder === 'string'
      ? service.park(folder)
      : { success: false, error: 'Invalid ticket folder' }
  );
  ipcMain.handle(edit, (_event, input: unknown) =>
    isEditTicketInput(input)
      ? service.editTicket(input)
      : { success: false, error: 'Invalid ticket edit' }
  );
  // Pixel icons for tickets without `icon.svg` (background, one at a time).
  const icons = ticketIconsEnabled(process.env)
    ? createIconGenerator({
        vaultPath: service.vaultPath,
        logger,
        generate: claudeIconRunner(homedir()),
        sync: async () => {
          const synced = await service.sync('tickets: icons (OZdash)');
          if (!synced.success)
            logger.warn('ozdash icons: vault sync failed', { error: synced.error });
        },
      })
    : null;
  const stopWatching = service.watch((next) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(changed, next);
    }
    if (!next.error) icons?.update(next.tickets);
  });
  logger.info('ozdash tickets: watching the vault', { vaultPath: service.vaultPath });

  return () => {
    stopWatching();
    icons?.dispose();
    onTicketTaskCreated = null;
    ipcMain.removeHandler(list);
    ipcMain.removeHandler(restore);
    ipcMain.removeHandler(archive);
    ipcMain.removeHandler(openSession);
    ipcMain.removeHandler(linkTask);
    ipcMain.removeHandler(createTicket);
    ipcMain.removeHandler(linkPmSession);
    ipcMain.removeHandler(setPriority);
    ipcMain.removeHandler(reorder);
    ipcMain.removeHandler(park);
    ipcMain.removeHandler(edit);
  };
}
