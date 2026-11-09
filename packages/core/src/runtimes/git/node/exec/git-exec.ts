import type { EnvSource } from '#primitives/exec/api';
import {
  createBoundExec,
  type BoundExec,
  type ExecBufferResult,
  type ExecOptions,
  type ExecResult,
  type ExecSpawnOptions,
} from '#services/exec/api';
import { nonInteractiveGitEnv } from '#services/exec/node/git-exec';

export type CreateGitExecOptions = {
  cwd: string;
  executable?: string;
  env: NodeJS.ProcessEnv | EnvSource;
  /** OZdash: deadline for commands that set none; `0` disables it. */
  commandTimeoutMs?: number;
};

/**
 * OZdash: one stuck git child must not stall a repository forever. Every status, refs, head and
 * mutation command of a repository runs in one FIFO lane, and idle disposal drains that lane,
 * so a single command that never settles blocks all later work until the app restarts.
 */
export const DEFAULT_GIT_COMMAND_TIMEOUT_MS = 5 * 60_000;

/** OZdash: transfers can legitimately run long; their job's abort signal owns their lifetime. */
const TRANSFER_SUBCOMMANDS = new Set(['clone', 'fetch', 'pull', 'push']);

export function createGitExec(options: CreateGitExecOptions): BoundExec {
  const source = options.env;
  const env =
    typeof source === 'function'
      ? async () => nonInteractiveGitEnv(await source())
      : nonInteractiveGitEnv(source);
  const exec = createBoundExec({
    file: options.executable ?? 'git',
    cwd: options.cwd,
    env,
  });
  // OZdash: bound every non-transfer command so the repository lane always drains.
  return withGitCommandTimeout(exec, options.commandTimeoutMs ?? DEFAULT_GIT_COMMAND_TIMEOUT_MS);
}

/** OZdash: applies `timeoutMs` to non-transfer commands that do not set their own deadline. */
export function withGitCommandTimeout(base: BoundExec, timeoutMs: number): BoundExec {
  if (timeoutMs <= 0) return base;
  const withDeadline = (args: string[], options?: ExecOptions): ExecOptions | undefined =>
    options?.timeoutMs !== undefined || TRANSFER_SUBCOMMANDS.has(gitSubcommand(args) ?? '')
      ? options
      : { ...options, timeoutMs };
  return {
    file: base.file,
    cwd: base.cwd,
    env: base.env,
    exec: (args, options) => base.exec(args, withDeadline(args, options)),
    execStreaming: (args, onStdout, options) =>
      base.execStreaming(args, onStdout, withDeadline(args, options)),
    execBuffer: (args, options) => base.execBuffer(args, withDeadline(args, options)),
    spawn: (args, options) => base.spawn(args, options),
    withCwd: (cwd) => withGitCommandTimeout(base.withCwd(cwd), timeoutMs),
  };
}

/** The git subcommand after global options such as `--git-dir=…`, `-C <path>` and `-c k=v`. */
function gitSubcommand(args: readonly string[]): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? '';
    if (arg === '-C' || arg === '-c') index += 1;
    else if (!arg.startsWith('-')) return arg;
  }
  return undefined;
}

/** Targets every command at one Git directory, independently of the executor's cwd. */
export function bindGitDir(base: BoundExec, gitDir: string): BoundExec {
  const prefix = [`--git-dir=${gitDir}`];
  return {
    file: base.file,
    cwd: base.cwd,
    env: base.env,
    exec(args: string[], options?: ExecOptions): Promise<ExecResult> {
      return base.exec([...prefix, ...args], options);
    },
    execStreaming(
      args: string[],
      onStdout: (chunk: string) => boolean | void,
      options?: ExecOptions
    ): Promise<void> {
      return base.execStreaming([...prefix, ...args], onStdout, options);
    },
    execBuffer(args: string[], options?: ExecOptions): Promise<ExecBufferResult> {
      return base.execBuffer([...prefix, ...args], options);
    },
    spawn(args: string[], options?: ExecSpawnOptions) {
      return base.spawn([...prefix, ...args], options);
    },
    withCwd(cwd: string): BoundExec {
      return bindGitDir(base.withCwd(cwd), gitDir);
    },
  };
}
