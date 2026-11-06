// Fork (ozimakov-st): IPC for the Tickets board (see core/features/ozdash). The
// renderer invokes list/restore/open-session; the main process pushes the list to
// every window when the vault changes.
import { homedir } from 'node:os';
import type { Logger } from '@emdash/shared/logger';
import { and, eq, isNull } from 'drizzle-orm';
import { BrowserWindow, ipcMain } from 'electron';
import { createTaskFromPrompt } from '@core/features/mcp/node/server/create-task-from-prompt';
import type { McpToolDependencies } from '@core/features/mcp/node/server/dependencies';
import { OZDASH_TICKETS_CHANNELS } from '@core/features/ozdash/api/tickets';
import { createTicketsService, resolveVaultPath } from '@core/features/ozdash/node/tickets-service';
import { tasks } from '@core/services/app-db/node/schema';

/** Registers the tickets IPC handlers and the vault watcher. Returns a dispose function. */
export function registerOzdashTickets(mcp: McpToolDependencies, logger: Logger): () => void {
  const service = createTicketsService({
    vaultPath: resolveVaultPath(process.env.OZDASH_VAULT_PATH, homedir()),
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

  const { list, restore, openSession, changed } = OZDASH_TICKETS_CHANNELS;
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
  };
}
