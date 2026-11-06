// Fork (ozimakov-st): a "PM task" marks an Emdash task that a PM (task-manager)
// session started through the MCP create_task tool, and for which PM task.
import { z } from 'zod';

export const PM_TASK_ID_MAX = 32;
export const PM_TASK_TITLE_MAX = 200;
const MANAGER_TASK_ID_MAX = 64;

/** The `pmTask` argument of create_task. Blank optional strings count as absent. */
export const pmTaskInputSchema = z.object({
  id: z
    .string()
    .trim()
    .min(1, 'pmTask.id must not be empty')
    .max(PM_TASK_ID_MAX, `pmTask.id must be at most ${PM_TASK_ID_MAX} characters`)
    .describe('The PM task id, for example "123"'),
  title: z
    .string()
    .trim()
    .max(PM_TASK_TITLE_MAX, `pmTask.title must be at most ${PM_TASK_TITLE_MAX} characters`)
    .optional()
    .describe('The PM task title'),
  managerTaskId: z
    .string()
    .trim()
    .max(
      MANAGER_TASK_ID_MAX,
      `pmTask.managerTaskId must be at most ${MANAGER_TASK_ID_MAX} characters`
    )
    .optional()
    .describe('The Emdash task id of the PM session that controls this task'),
});

export type PmTask = {
  id: string;
  title?: string;
  managerTaskId?: string;
};

/** What the renderer gets for one PM-controlled task. */
export type PmTaskInfo = {
  pmTask: PmTask;
  /** The manager task, when `managerTaskId` points to a task that still exists. */
  manager: { taskId: string; projectId: string; name: string } | null;
};

/** Main-process invoke channel: returns `Record<emdashTaskId, PmTaskInfo>`. */
export const OZDASH_PM_TASKS_CHANNEL = 'ozdash:list-pm-tasks';

/** Parses a raw `pmTask` argument into its stored form, dropping blank optional fields. */
export function parsePmTask(
  raw: unknown
): { success: true; data: PmTask } | { success: false; error: string } {
  const parsed = pmTaskInputSchema.safeParse(raw);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((issue) => issue.message).join('; ') };
  }
  const { id, title, managerTaskId } = parsed.data;
  return {
    success: true,
    data: { id, ...(title && { title }), ...(managerTaskId && { managerTaskId }) },
  };
}

/** Sidebar badge text, for example `#123`. */
export function pmTaskBadgeText(pmTask: PmTask): string {
  return `#${pmTask.id}`;
}

/** Tooltip text, for example `PM task #123: Fix login (managed by PM 123)`. */
export function pmTaskTooltip(info: PmTaskInfo): string {
  const { id, title } = info.pmTask;
  const base = title ? `PM task #${id}: ${title}` : `PM task #${id}`;
  return info.manager ? `${base} (managed by ${info.manager.name})` : base;
}

/** Task header chip: the `PM #123` label and the title cut to `maxTitle` characters. */
export function pmTaskChipText(
  pmTask: PmTask,
  maxTitle = 40
): { label: string; title: string | null } {
  const title = pmTask.title ?? null;
  return {
    label: `PM #${pmTask.id}`,
    title: title && title.length > maxTitle ? `${title.slice(0, maxTitle - 1).trimEnd()}…` : title,
  };
}
