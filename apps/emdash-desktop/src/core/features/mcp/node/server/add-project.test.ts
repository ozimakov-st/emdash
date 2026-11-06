import { existsSync, statSync } from 'node:fs';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import type * as osModule from 'node:os';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { err, ok } from '@emdash/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CreateProjectParams,
  InspectProjectPathParams,
  Project,
} from '@core/primitives/projects/api';
import { addLocalProject } from './add-project';
import type { McpToolDependencies } from './dependencies';

const home = vi.hoisted(() => ({ dir: '' }));
vi.mock('node:os', async (importOriginal) => ({
  ...(await importOriginal<typeof osModule>()),
  homedir: () => home.dir,
}));

const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as never;

/**
 * Stands in for the projects controller's inspect and create operations: reads the
 * real filesystem for directory and `.git` checks and keeps registered projects in
 * memory by path, like the registry does.
 */
function fakeProjectCreation() {
  const byPath = new Map<string, Project>();
  const inspectProjectPath = vi.fn(async ({ path }: InspectProjectPathParams) => {
    const isDirectory = existsSync(path) && statSync(path).isDirectory();
    return {
      isDirectory,
      isGitRepo: isDirectory && existsSync(join(path, '.git')),
      existingProject: byPath.get(path),
    };
  });
  const createProject = vi.fn(async (params: CreateProjectParams) => {
    if (byPath.has(params.path)) {
      return err({
        type: 'invalid-directory' as const,
        path: params.path,
        message: 'A project already exists at this path',
      });
    }
    const project: Project = {
      type: 'local',
      id: `project-${byPath.size + 1}`,
      name: params.name,
      path: params.path,
      baseRef: 'origin/main',
      repositoryWorkspaceId: 'workspace-1',
      createdAt: '',
      updatedAt: '',
    };
    byPath.set(params.path, project);
    return ok(project);
  });
  return { inspectProjectPath, createProject };
}

describe('addLocalProject', () => {
  let root: string;
  let projectCreation: ReturnType<typeof fakeProjectCreation>;
  let deps: McpToolDependencies;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'emdash-add-project-'));
    home.dir = root;
    projectCreation = fakeProjectCreation();
    deps = { projectCreation, logger } as unknown as McpToolDependencies;
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function makeRepo(name: string): Promise<string> {
    const path = join(root, name);
    await mkdir(join(path, '.git'), { recursive: true });
    return path;
  }

  it('creates a local project named after the folder, without initializing git', async () => {
    const path = await makeRepo('my-repo');
    const canonical = await realpath(path);

    await expect(addLocalProject(deps, { path })).resolves.toEqual(
      ok({ projectId: 'project-1', name: 'my-repo', path: canonical, created: true })
    );
    expect(projectCreation.createProject).toHaveBeenCalledWith({
      type: 'local',
      path: canonical,
      name: 'my-repo',
      initGitRepository: false,
    });
  });

  it('uses the given name', async () => {
    const path = await makeRepo('my-repo');

    const result = await addLocalProject(deps, { path, name: ' Custom ' });

    expect(result).toMatchObject(ok({ name: 'Custom', created: true }));
  });

  it('returns the existing project on a second call, also when the path uses ~', async () => {
    const path = await makeRepo('my-repo');
    const first = await addLocalProject(deps, { path });
    expect(first.success && first.data.created).toBe(true);

    const again = await addLocalProject(deps, { path: `${path}/` });
    const viaHome = await addLocalProject(deps, { path: '~/my-repo' });

    const expected = ok({
      projectId: 'project-1',
      name: 'my-repo',
      path: await realpath(path),
      created: false,
    });
    expect(again).toEqual(expected);
    expect(viaHome).toEqual(expected);
    expect(projectCreation.createProject).toHaveBeenCalledTimes(1);
  });

  it('returns the project a create call reports at the repository root', async () => {
    const path = await makeRepo('my-repo');
    await addLocalProject(deps, { path });
    // A path the first inspection misses, which creation resolves to the same root.
    projectCreation.inspectProjectPath.mockResolvedValueOnce({
      isDirectory: true,
      isGitRepo: true,
      existingProject: undefined,
    });

    const result = await addLocalProject(deps, { path });

    expect(result).toMatchObject(ok({ projectId: 'project-1', created: false }));
  });

  it('rejects a folder that is not a git repository', async () => {
    const path = join(root, 'plain');
    await mkdir(path);

    const result = await addLocalProject(deps, { path });

    expect(result.success).toBe(false);
    expect(!result.success && result.error).toMatch(/^Not a git repository/);
    expect(projectCreation.createProject).not.toHaveBeenCalled();
  });

  it('rejects a missing path', async () => {
    const result = await addLocalProject(deps, { path: join(root, 'missing') });

    expect(result.success).toBe(false);
    expect(!result.success && result.error).toMatch(/^Path does not exist/);
    expect(projectCreation.createProject).not.toHaveBeenCalled();
  });

  it('rejects a file', async () => {
    const path = join(root, 'file.txt');
    await writeFile(path, 'x');

    const result = await addLocalProject(deps, { path });

    expect(!result.success && result.error).toMatch(/^Path is not a directory/);
  });

  it('rejects a relative path', async () => {
    const result = await addLocalProject(deps, { path: 'my-repo' });

    expect(!result.success && result.error).toMatch(/must be absolute/);
    expect(projectCreation.inspectProjectPath).not.toHaveBeenCalled();
  });
});
