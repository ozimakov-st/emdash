// Fork (ozimakov-st): commits and pushes vault changes, the same way the PM skills
// do: add, commit, pull --rebase --autostash, push. Git runs with argument lists
// (no shell), and a pull conflict is rolled back with `rebase --abort`.
import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { relative } from 'node:path';

export type GitResult = { code: number; stdout: string; stderr: string };
/** Runs `git <args>`; never throws for a non-zero exit. */
export type GitRunner = (args: readonly string[]) => Promise<GitResult>;

export const runGit: GitRunner = (args) =>
  new Promise((resolve) => {
    execFile(
      'git',
      [...args],
      {
        timeout: 60_000,
        maxBuffer: 4 * 1024 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      },
      (error, stdout, stderr) => {
        const code =
          error == null ? 0 : typeof error.code === 'number' ? error.code : error.killed ? 124 : 1;
        resolve({
          code,
          stdout: String(stdout),
          stderr: String(stderr || (error && typeof error.code !== 'number' ? error.message : '')),
        });
      }
    );
  });

export type VaultRepo = { repoRoot: string; pathspec: string };

/** The git repo that holds the vault, and the vault's path inside it. */
export async function resolveVaultRepo(
  vaultPath: string,
  run: GitRunner = runGit
): Promise<{ success: true; repo: VaultRepo } | { success: false; error: string }> {
  const top = await run(['-C', vaultPath, 'rev-parse', '--show-toplevel']);
  if (top.code !== 0) {
    return { success: false, error: `The vault is not in a git repo: ${firstLine(top.stderr)}` };
  }
  const repoRoot = top.stdout.trim();
  let vaultReal = vaultPath;
  try {
    vaultReal = await realpath(vaultPath);
  } catch {
    // Keep the given path.
  }
  return { success: true, repo: { repoRoot, pathspec: relative(repoRoot, vaultReal) || '.' } };
}

function firstLine(text: string): string {
  return (
    text
      .split('\n')
      .map((line) => line.trim())
      .find(Boolean) ?? 'unknown error'
  );
}

function describe(step: string, result: GitResult): string {
  return `git ${step} failed: ${firstLine(result.stderr || result.stdout)}`;
}

export type SyncResult = { success: true } | { success: false; error: string };

/** Pulls before an edit, so the edit starts from the latest vault. */
export async function pullVault(repo: VaultRepo, run: GitRunner = runGit): Promise<SyncResult> {
  const pulled = await run(['-C', repo.repoRoot, 'pull', '--rebase', '--autostash']);
  if (pulled.code === 0) return { success: true };
  await abortRebaseIfAny(repo, run);
  return { success: false, error: describe('pull', pulled) };
}

/** After a failed pull: undo a stopped rebase (fails harmlessly when there is none). */
async function abortRebaseIfAny(repo: VaultRepo, run: GitRunner): Promise<void> {
  await run(['-C', repo.repoRoot, 'rebase', '--abort']);
}

/** add, commit (when something is staged), pull --rebase --autostash, push. */
export async function syncVault(
  repo: VaultRepo,
  message: string,
  run: GitRunner = runGit
): Promise<SyncResult> {
  const git = (...args: string[]) => run(['-C', repo.repoRoot, ...args]);

  const added = await git('add', '--', repo.pathspec);
  if (added.code !== 0) return { success: false, error: describe('add', added) };

  const staged = await git('diff', '--cached', '--quiet', '--', repo.pathspec);
  if (staged.code !== 0) {
    const committed = await git('commit', '-m', message, '--', repo.pathspec);
    if (committed.code !== 0) return { success: false, error: describe('commit', committed) };
  }

  const pulled = await git('pull', '--rebase', '--autostash');
  if (pulled.code !== 0) {
    await abortRebaseIfAny(repo, run);
    return {
      success: false,
      error: `${describe('pull', pulled)}. The change is committed locally but not pushed.`,
    };
  }

  const pushed = await git('push');
  if (pushed.code !== 0) {
    return {
      success: false,
      error: `${describe('push', pushed)}. The change is committed locally but not pushed.`,
    };
  }
  return { success: true };
}
