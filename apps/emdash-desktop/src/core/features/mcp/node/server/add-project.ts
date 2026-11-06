import { realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { err, ok, type Result } from '@emdash/shared';
import { basenameFromAnyPath } from '@core/primitives/path-name/api';
import type { Project, ProjectPathInspection } from '@core/primitives/projects/api';
import type { McpToolDependencies } from './dependencies';

export type AddProjectInput = Readonly<{ path: string; name?: string }>;

export type AddProjectOutput = Readonly<{
  projectId: string;
  name: string;
  path: string;
  created: boolean;
}>;

type AddProjectDependencies = Pick<McpToolDependencies, 'projectCreation' | 'logger'>;

/**
 * Adds a local git repository as a project, the same way the Add Project dialog's
 * "open a folder" mode does: inspect the path, return the project already registered
 * there, otherwise create one with the folder name. Unlike the dialog, it never
 * offers to initialize a repository or to trust one Git refuses for its ownership;
 * both stay explicit user actions in the UI.
 */
export async function addLocalProject(
  dependencies: AddProjectDependencies,
  input: AddProjectInput
): Promise<Result<AddProjectOutput, string>> {
  const resolved = resolveInputPath(input.path);
  if (!resolved.success) return resolved;
  const requestedPath = resolved.data;

  const name = input.name?.trim() || basenameFromAnyPath(requestedPath);
  if (!name) return err('name must not be empty');

  // Canonicalize so a symlinked or differently spelled path finds the project
  // registered under the repository's real path.
  let path: string;
  try {
    path = await realpath(requestedPath);
  } catch (error) {
    if (isMissingPathError(error)) return err(`Path does not exist: ${requestedPath}`);
    path = requestedPath;
  }

  const { projectCreation } = dependencies;
  const inspection = await projectCreation.inspectProjectPath({ type: 'local', path });
  if (inspection.existingProject) return ok(existing(inspection.existingProject));
  if (inspection.error) return err(inspectionErrorMessage(dependencies, path, inspection));
  if (!inspection.isDirectory) return err(`Path is not a directory: ${path}`);
  if (!inspection.isGitRepo) {
    return err(
      `Not a git repository: ${path}. Run \`git init\` there first, or add it from the ` +
        "Emdash UI, whose Add Project dialog can initialize one; this tool won't."
    );
  }

  const created = await projectCreation.createProject({
    type: 'local',
    path,
    name,
    initGitRepository: false,
  });
  if (created.success) return ok({ ...existing(created.data), created: true });

  // The repository root can differ from the inspected path (a subfolder of a repo),
  // so a project registered at the root only shows up once creation reports it.
  const errorPath = 'path' in created.error ? created.error.path : undefined;
  if (errorPath) {
    const recheck = await projectCreation.inspectProjectPath({ type: 'local', path: errorPath });
    if (recheck.existingProject) return ok(existing(recheck.existingProject));
  }

  dependencies.logger.error('McpHttpServer: add_project could not create the project', {
    error: created.error,
  });
  if (created.error.type === 'not-repository') return err(`Not a git repository: ${path}`);
  return err(`Emdash could not add the project at ${path} (${created.error.type})`);
}

function existing(project: Project): AddProjectOutput {
  return { projectId: project.id, name: project.name, path: project.path, created: false };
}

function resolveInputPath(raw: string): Result<string, string> {
  const trimmed = raw.trim();
  if (!trimmed) return err('path must not be empty');
  const expanded = /^~(?=$|[\\/])/.test(trimmed) ? join(homedir(), trimmed.slice(1)) : trimmed;
  if (!isAbsolute(expanded)) return err(`path must be absolute or start with ~/: ${raw}`);
  return ok(resolve(expanded));
}

function isMissingPathError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

function inspectionErrorMessage(
  dependencies: AddProjectDependencies,
  path: string,
  inspection: ProjectPathInspection
): string {
  const { error } = inspection;
  if (error?.type === 'inspect-failed' && error.dubiousOwnership) {
    return (
      `Git refuses to open ${path} because another user owns it. Trust it from the Emdash ` +
      'Add Project dialog, or run `git config --global --add safe.directory ' +
      `${error.dubiousOwnership.safeDirectory}\` yourself, then retry.`
    );
  }
  dependencies.logger.error('McpHttpServer: add_project could not inspect the path', { error });
  return `Emdash could not inspect ${path} (${error?.type ?? 'unknown error'})`;
}
