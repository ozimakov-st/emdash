// Fork (ozimakov-st): IPC for the Tickets board (see core/features/ozdash). The
// renderer invokes list/restore/open-session; the main process pushes the list to
// every window when the vault changes.
import { homedir } from 'node:os';
import type { Logger } from '@emdash/shared/logger';
import { and, eq, isNull } from 'drizzle-orm';
import { BrowserWindow, ipcMain } from 'electron';
import { createTaskFromPrompt } from '@core/features/mcp/node/server/create-task-from-prompt';
import type { McpToolDependencies } from '@core/features/mcp/node/server/dependencies';
import { taskTicketStoreOf } from '@core/features/mcp/node/server/ozdash-task-ticket-store';
import { sendTaskMessage } from '@core/features/mcp/node/server/task-conversation';
import { createOzTicketsIssueProvider } from '@core/features/ozdash/api/node/oz-tickets-issue-provider';
import type { LinkTicketTaskInput } from '@core/features/ozdash/api/ticket-issues';
import { OZDASH_TICKETS_CHANNELS } from '@core/features/ozdash/api/tickets';
import { linkTicketTask } from '@core/features/ozdash/node/link-ticket-task';
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
        .where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId), isNull(tasks.deletedAt)))
        .limit(1);
      return rows.length > 0;
    },
  });

  const taskTickets = taskTicketStoreOf(mcp);
  const firstRow = <T>(rows: T[]): T | undefined => rows[0];

  const { list, restore, openSession, linkTask, changed } = OZDASH_TICKETS_CHANNELS;
  ipcMain.handle(list, () => service.list());
  ipcMain.handle(restore, (_event, folder: unknown) =>
    typeof folder === 'string'
      ? service.restore(folder)
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
  const stopWatching = service.watch((next) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(changed, next);
    }
  });
  logger.info('ozdash tickets: watching the vault', { vaultPath: service.vaultPath });

  return () => {
    stopWatching();
    ipcMain.removeHandler(list);
    ipcMain.removeHandler(restore);
    ipcMain.removeHandler(openSession);
    ipcMain.removeHandler(linkTask);
  };
}
