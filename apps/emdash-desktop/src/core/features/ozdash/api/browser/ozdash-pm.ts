// Fork (ozimakov-st): the "PM" project. Oleg runs manager agents as tasks in one
// local project (default `~/Projects/work`, override with OZDASH_PM_PROJECT_PATH).
// The sidebar shows that project first, with a PM header and icon.

/** Values the preload script exposes as `window.ozdash`. */
export interface OzdashEnv {
  homeDir: string | null;
  pmProjectPathOverride: string | null;
}

/** Minimal project shape: `ProjectStore` fits it. */
interface ProjectLike {
  data: { type: string; path: string } | null;
}

const DEFAULT_PM_PATH = '~/Projects/work';

/** Collapses `//`, `.` and `..`, and drops the trailing slash of an absolute POSIX path. */
export function normalizeAbsolutePath(path: string): string {
  const parts: string[] = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return `/${parts.join('/')}`;
}

/** Resolves the PM project path to an absolute path, or null when it cannot. */
export function resolvePmProjectPath(env: OzdashEnv | null | undefined): string | null {
  const raw = env?.pmProjectPathOverride?.trim() || DEFAULT_PM_PATH;
  const home = env?.homeDir?.trim() || null;
  let path = raw;
  if (raw === '~' || raw.startsWith('~/')) {
    if (!home) return null;
    path = home + raw.slice(1);
  } else if (!raw.startsWith('/')) {
    if (!home) return null;
    path = `${home}/${raw}`;
  }
  return normalizeAbsolutePath(path);
}

/** True when the project is a local project whose path is the PM path. */
export function isPmProject(project: ProjectLike | null | undefined, pmPath: string | null) {
  if (!pmPath || project?.data?.type !== 'local') return false;
  return normalizeAbsolutePath(project.data.path) === pmPath;
}

/** Moves the PM project (if any) to the front, keeping the order of the rest. */
export function withPmProjectFirst<T extends ProjectLike>(
  projects: T[],
  pmPath: string | null
): T[] {
  const index = projects.findIndex((project) => isPmProject(project, pmPath));
  if (index <= 0) return projects;
  return [projects[index]!, ...projects.slice(0, index), ...projects.slice(index + 1)];
}

let cachedPmPath: string | null | undefined;

/** The PM path for this window, read once from `window.ozdash` (null outside Electron). */
export function getPmProjectPath(): string | null {
  if (cachedPmPath === undefined) {
    const env = (globalThis as { ozdash?: OzdashEnv }).ozdash;
    cachedPmPath = env ? resolvePmProjectPath(env) : null;
  }
  return cachedPmPath;
}

export function isPmProjectInWindow(project: ProjectLike | null | undefined): boolean {
  return isPmProject(project, getPmProjectPath());
}

/** What "new task" creates in a project: a ticket (and its PM session) in the PM project. */
export type NewTaskKind = 'ticket' | 'task';

export function newTaskKind(
  project: ProjectLike | null | undefined,
  pmPath: string | null
): NewTaskKind {
  return isPmProject(project, pmPath) ? 'ticket' : 'task';
}

export function newTaskKindInWindow(project: ProjectLike | null | undefined): NewTaskKind {
  return newTaskKind(project, getPmProjectPath());
}
