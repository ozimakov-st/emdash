import type { Logger } from '@emdash/shared/logger';
// Fork (ozimakov-st): stores the `ticket` of tasks created through MCP. Uses the
// existing `kv` table (namespace below, keyed by Emdash task id), so no migration.
import { inArray } from 'drizzle-orm';
import type { TaskTicket, TaskTicketInfo } from '@core/features/mcp/api/ozdash-task-ticket';
import type { AppDb } from '@core/services/app-db/node/db';
import { AppDbKeyValueStore } from '@core/services/app-db/node/key-value-store';
import { kv, tasks } from '@core/services/app-db/node/schema';
import type { McpToolDependencies } from './dependencies';

const NAMESPACE = 'ozdash-task-ticket';
/** The namespace before tickets were called tickets (`{ id, title?, managerTaskId? }`). */
const LEGACY_NAMESPACE = 'ozdash-pm-task';
/** An entry is written just before its task row; give that row time to appear. */
const PRUNE_GRACE_MS = 10 * 60 * 1000;

type StoredTaskTicket = TaskTicket & { savedAt: number };
type LegacyEntry = { id?: unknown; title?: unknown; managerTaskId?: unknown; savedAt?: unknown };

export interface TaskTicketStore {
  get(taskId: string): Promise<TaskTicket | null>;
  /** Entries for the given task ids; ids without one are left out. */
  getMany(taskIds: readonly string[]): Promise<Map<string, TaskTicket>>;
  /** Throws when the write fails. */
  set(taskId: string, ticket: TaskTicket): Promise<void>;
  delete(taskId: string): Promise<void>;
  /** Every entry, for the renderer, with its PM session resolved; prunes deleted tasks. */
  listInfos(now?: number): Promise<Record<string, TaskTicketInfo>>;
  /** Moves entries from the old `ozdash-pm-task` namespace. Returns how many moved. */
  migrateLegacyEntries(): Promise<number>;
}

function toTaskTicket(value: unknown): TaskTicket | null {
  if (!value || typeof value !== 'object') return null;
  const { id, title, pmSessionId } = value as Partial<StoredTaskTicket>;
  if (typeof id !== 'string' || !id) return null;
  return {
    id,
    ...(typeof title === 'string' && title && { title }),
    ...(typeof pmSessionId === 'string' && pmSessionId && { pmSessionId }),
  };
}

export function createTaskTicketStore(db: AppDb, logger: Logger): TaskTicketStore {
  // KV read/write failures are not worth an error-level log: the marker is cosmetic.
  const kvLogger = {
    error: (message: string, context: Record<string, unknown>) =>
      logger.warn(`ozdash task ticket: ${message}`, context),
  };
  const kvStore = new AppDbKeyValueStore<Record<string, StoredTaskTicket>>(db, NAMESPACE, kvLogger);

  const store: TaskTicketStore = {
    async get(taskId) {
      return toTaskTicket(await kvStore.get(taskId));
    },

    async getMany(taskIds) {
      const result = new Map<string, TaskTicket>();
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
          const ticket = toTaskTicket(JSON.parse(row.value));
          if (ticket) result.set(row.key.slice(prefix.length), ticket);
        }
      } catch (error) {
        logger.warn('ozdash task ticket: could not read entries', { error: String(error) });
      }
      return result;
    },

    async set(taskId, ticket) {
      await kvStore.setOrThrow(taskId, { ...ticket, savedAt: Date.now() });
    },

    async delete(taskId) {
      await kvStore.del(taskId);
    },

    async listInfos(now = Date.now()) {
      const entries = await kvStore.getAll();
      const taskIds = Object.keys(entries);
      if (taskIds.length === 0) return {};
      const pmSessionIds = Object.values(entries)
        .map((entry) => entry?.pmSessionId)
        .filter((id): id is string => typeof id === 'string' && id.length > 0);
      const rows = await db
        .select({
          id: tasks.id,
          projectId: tasks.projectId,
          name: tasks.name,
          deletedAt: tasks.deletedAt,
        })
        .from(tasks)
        .where(inArray(tasks.id, [...new Set([...taskIds, ...pmSessionIds])]));
      const liveTasks = new Map(rows.filter((row) => !row.deletedAt).map((row) => [row.id, row]));

      const infos: Record<string, TaskTicketInfo> = {};
      for (const taskId of taskIds) {
        const entry = entries[taskId];
        const ticket = toTaskTicket(entry);
        if (!ticket || !liveTasks.has(taskId)) {
          const savedAt = typeof entry?.savedAt === 'number' ? entry.savedAt : 0;
          if (!ticket || now - savedAt > PRUNE_GRACE_MS) await store.delete(taskId);
          continue;
        }
        const pmSession = ticket.pmSessionId ? liveTasks.get(ticket.pmSessionId) : undefined;
        infos[taskId] = {
          ticket,
          pmSession: pmSession
            ? { taskId: pmSession.id, projectId: pmSession.projectId, name: pmSession.name }
            : null,
        };
      }
      return infos;
    },

    async migrateLegacyEntries() {
      const legacy = new AppDbKeyValueStore<Record<string, LegacyEntry>>(
        db,
        LEGACY_NAMESPACE,
        kvLogger
      );
      const entries = await legacy.getAll();
      let moved = 0;
      for (const [taskId, entry] of Object.entries(entries)) {
        const ticket = toTaskTicket({
          id: entry?.id,
          title: entry?.title,
          pmSessionId: entry?.managerTaskId,
        });
        if (ticket && !(await kvStore.get(taskId))) {
          const savedAt = typeof entry?.savedAt === 'number' ? entry.savedAt : Date.now();
          await kvStore.setOrThrow(taskId, { ...ticket, savedAt });
          moved += 1;
        }
        await legacy.del(taskId);
      }
      return moved;
    },
  };
  return store;
}

/** The store the MCP tools use: an injected one in tests, else the app db's. */
export function taskTicketStoreOf(dependencies: McpToolDependencies): TaskTicketStore {
  return dependencies.taskTickets ?? createTaskTicketStore(dependencies.db, dependencies.logger);
}
