import type { Logger } from '@emdash/shared/logger';
// Fork (ozimakov-st): stores the `pmTask` of tasks created through MCP. Uses the
// existing `kv` table (namespace below, keyed by Emdash task id), so no migration.
import { inArray } from 'drizzle-orm';
import type { PmTask, PmTaskInfo } from '@core/features/mcp/api/ozdash-pm-task';
import type { AppDb } from '@core/services/app-db/node/db';
import { AppDbKeyValueStore } from '@core/services/app-db/node/key-value-store';
import { kv, tasks } from '@core/services/app-db/node/schema';
import type { McpToolDependencies } from './dependencies';

const NAMESPACE = 'ozdash-pm-task';
/** An entry is written just before its task row; give that row time to appear. */
const PRUNE_GRACE_MS = 10 * 60 * 1000;

type StoredPmTask = PmTask & { savedAt: number };

export interface PmTaskStore {
  get(taskId: string): Promise<PmTask | null>;
  /** Entries for the given task ids; ids without one are left out. */
  getMany(taskIds: readonly string[]): Promise<Map<string, PmTask>>;
  /** Throws when the write fails. */
  set(taskId: string, pmTask: PmTask): Promise<void>;
  delete(taskId: string): Promise<void>;
  /** Every entry, for the renderer, with its manager task resolved; prunes deleted tasks. */
  listInfos(now?: number): Promise<Record<string, PmTaskInfo>>;
}

function toPmTask(value: unknown): PmTask | null {
  if (!value || typeof value !== 'object') return null;
  const { id, title, managerTaskId } = value as Partial<StoredPmTask>;
  if (typeof id !== 'string' || !id) return null;
  return {
    id,
    ...(typeof title === 'string' && title && { title }),
    ...(typeof managerTaskId === 'string' && managerTaskId && { managerTaskId }),
  };
}

export function createPmTaskStore(db: AppDb, logger: Logger): PmTaskStore {
  // KV read/write failures are not worth an error-level log: the marker is cosmetic.
  const kvStore = new AppDbKeyValueStore<Record<string, StoredPmTask>>(db, NAMESPACE, {
    error: (message, context) => logger.warn(`ozdash pm task: ${message}`, context),
  });

  const store: PmTaskStore = {
    async get(taskId) {
      return toPmTask(await kvStore.get(taskId));
    },

    async getMany(taskIds) {
      const result = new Map<string, PmTask>();
      if (taskIds.length === 0) return result;
      const prefix = `${NAMESPACE}:`;
      try {
        const rows = await db
          .select({ key: kv.key, value: kv.value })
          .from(kv)
          .where(
            inArray(
              kv.key,
              taskIds.map((id) => prefix + id)
            )
          );
        for (const row of rows) {
          if (typeof row.key !== 'string' || typeof row.value !== 'string') continue;
          const pmTask = toPmTask(JSON.parse(row.value));
          if (pmTask) result.set(row.key.slice(prefix.length), pmTask);
        }
      } catch (error) {
        logger.warn('ozdash pm task: could not read entries', { error: String(error) });
      }
      return result;
    },

    async set(taskId, pmTask) {
      await kvStore.setOrThrow(taskId, { ...pmTask, savedAt: Date.now() });
    },

    async delete(taskId) {
      await kvStore.del(taskId);
    },

    async listInfos(now = Date.now()) {
      const entries = await kvStore.getAll();
      const taskIds = Object.keys(entries);
      if (taskIds.length === 0) return {};
      const managerIds = Object.values(entries)
        .map((entry) => entry?.managerTaskId)
        .filter((id): id is string => typeof id === 'string' && id.length > 0);
      const rows = await db
        .select({
          id: tasks.id,
          projectId: tasks.projectId,
          name: tasks.name,
          deletedAt: tasks.deletedAt,
        })
        .from(tasks)
        .where(inArray(tasks.id, [...new Set([...taskIds, ...managerIds])]));
      const liveTasks = new Map(rows.filter((row) => !row.deletedAt).map((row) => [row.id, row]));

      const infos: Record<string, PmTaskInfo> = {};
      for (const taskId of taskIds) {
        const entry = entries[taskId];
        const pmTask = toPmTask(entry);
        if (!pmTask || !liveTasks.has(taskId)) {
          const savedAt = typeof entry?.savedAt === 'number' ? entry.savedAt : 0;
          if (!pmTask || now - savedAt > PRUNE_GRACE_MS) await store.delete(taskId);
          continue;
        }
        const manager = pmTask.managerTaskId ? liveTasks.get(pmTask.managerTaskId) : undefined;
        infos[taskId] = {
          pmTask,
          manager: manager
            ? { taskId: manager.id, projectId: manager.projectId, name: manager.name }
            : null,
        };
      }
      return infos;
    },
  };
  return store;
}

/** The store the MCP tools use: an injected one in tests, else the app db's. */
export function pmTaskStoreOf(dependencies: McpToolDependencies): PmTaskStore {
  return dependencies.pmTasks ?? createPmTaskStore(dependencies.db, dependencies.logger);
}
