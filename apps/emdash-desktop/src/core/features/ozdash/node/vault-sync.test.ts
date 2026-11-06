import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  resolveVaultRepo,
  runGit,
  syncVault,
  type GitResult,
  type GitRunner,
  type VaultRepo,
} from './vault-sync';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
}

/** A bare remote, a clone with a `vault/` folder (the "work" repo), and a second clone. */
function setUpRepos(root: string) {
  const remote = join(root, 'remote.git');
  const work = join(root, 'work');
  const other = join(root, 'other');
  git(root, 'init', '--bare', '-b', 'main', remote);
  git(root, 'clone', remote, work);
  for (const repo of [work]) {
    git(repo, 'config', 'user.name', 'Test');
    git(repo, 'config', 'user.email', 'test@example.com');
    git(repo, 'config', 'commit.gpgsign', 'false');
  }
  mkdirSync(join(work, 'vault', 'tickets', '1-a'), { recursive: true });
  writeFileSync(join(work, 'vault', 'tickets', '1-a', 'ticket.md'), 'one\n');
  writeFileSync(join(work, 'README.md'), 'readme\n');
  git(work, 'add', '.');
  git(work, 'commit', '-m', 'init');
  git(work, 'push', '-u', 'origin', 'main');
  git(root, 'clone', remote, other);
  git(other, 'config', 'user.name', 'Other');
  git(other, 'config', 'user.email', 'other@example.com');
  git(other, 'config', 'commit.gpgsign', 'false');
  return { remote, work, other };
}

describe('vault sync (temp git repos)', () => {
  let root: string;
  let repos: ReturnType<typeof setUpRepos>;
  let repo: VaultRepo;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'ozdash-vault-sync-'));
    repos = setUpRepos(root);
    const resolved = await resolveVaultRepo(join(repos.work, 'vault'));
    if (!resolved.success) throw new Error(resolved.error);
    repo = resolved.repo;
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('finds the repo root and the vault path inside it', () => {
    expect(repo.pathspec).toBe('vault');
    expect(git(repo.repoRoot, 'rev-parse', '--show-toplevel')).toBe(repo.repoRoot);
  });

  it('commits only the vault, rebases on the remote, and pushes', async () => {
    // Someone else pushed meanwhile.
    writeFileSync(join(repos.other, 'other.txt'), 'x\n');
    git(repos.other, 'add', '.');
    git(repos.other, 'commit', '-m', 'other');
    git(repos.other, 'push');
    // A vault edit, and an unrelated edit outside the vault that must stay uncommitted.
    writeFileSync(join(repos.work, 'vault', 'tickets', '1-a', 'ticket.md'), 'two\n');
    writeFileSync(join(repos.work, 'README.md'), 'local change\n');

    expect(await syncVault(repo, 'tickets: test')).toEqual({ success: true });

    expect(git(repos.remote, 'log', '-1', '--format=%s', 'main')).toBe('tickets: test');
    expect(git(repos.remote, 'show', 'main:vault/tickets/1-a/ticket.md')).toBe('two');
    expect(git(repos.remote, 'show', 'main:README.md')).toBe('readme');
    expect(git(repos.work, 'status', '--porcelain')).toBe('M README.md');
  });

  it('skips the commit when nothing changed, and still pulls and pushes', async () => {
    expect(await syncVault(repo, 'tickets: nothing')).toEqual({ success: true });
    expect(git(repos.remote, 'log', '-1', '--format=%s', 'main')).toBe('init');
  });

  it('aborts the rebase on a conflict and does not push', async () => {
    writeFileSync(join(repos.other, 'vault', 'tickets', '1-a', 'ticket.md'), 'theirs\n');
    git(repos.other, 'commit', '-am', 'theirs');
    git(repos.other, 'push');
    writeFileSync(join(repos.work, 'vault', 'tickets', '1-a', 'ticket.md'), 'ours\n');

    const result = await syncVault(repo, 'tickets: ours');

    expect(result.success).toBe(false);
    expect(!result.success && result.error).toMatch(/^git pull failed: .*not pushed\.$/);
    expect(git(repos.remote, 'log', '-1', '--format=%s', 'main')).toBe('theirs');
    expect(git(repos.work, 'log', '-1', '--format=%s')).toBe('tickets: ours');
    // No rebase left in progress.
    expect(git(repos.work, 'status', '--porcelain')).toBe('');
  });

  it('reports when the vault is not in a git repo', async () => {
    const plain = join(root, 'plain');
    mkdirSync(plain);
    const result = await resolveVaultRepo(plain, runGit);
    expect(result.success).toBe(false);
  });
});

describe('vault sync (git command sequence)', () => {
  function fakeRunner(failOn?: string) {
    const calls: string[] = [];
    const run: GitRunner = async (args) => {
      calls.push(args.join(' '));
      const step = args[2];
      const result: GitResult = { code: 0, stdout: '', stderr: '' };
      if (step === 'diff') return { ...result, code: 1 }; // something is staged
      if (step === failOn) return { code: 1, stdout: '', stderr: `error: ${step} broke\n` };
      return result;
    };
    return { calls, run };
  }

  const repo = { repoRoot: '/w', pathspec: 'vault' };

  it('runs add, commit, pull --rebase --autostash, push with argument lists', async () => {
    const { calls, run } = fakeRunner();
    expect(await syncVault(repo, 'tickets: x "quoted" $HOME', run)).toEqual({ success: true });
    expect(calls).toEqual([
      '-C /w add -- vault',
      '-C /w diff --cached --quiet -- vault',
      '-C /w commit -m tickets: x "quoted" $HOME -- vault',
      '-C /w pull --rebase --autostash',
      '-C /w push',
    ]);
  });

  it('runs rebase --abort and skips push when pull fails', async () => {
    const { calls, run } = fakeRunner('pull');
    const result = await syncVault(repo, 'm', run);
    expect(result).toEqual({
      success: false,
      error: 'git pull failed: error: pull broke. The change is committed locally but not pushed.',
    });
    expect(calls.slice(-2)).toEqual(['-C /w pull --rebase --autostash', '-C /w rebase --abort']);
  });
});
