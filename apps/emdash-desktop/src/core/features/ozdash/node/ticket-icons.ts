// Fork (ozimakov-st): generates `icon.svg` for tickets that have none. Runs the Claude
// CLI in the background, one ticket at a time (never blocks the UI), checks the answer
// strictly (api/ticket-icon.ts), writes the icon next to `ticket.md`, and asks for one
// vault sync for icons that finish close together. Off with OZDASH_TICKET_ICONS=off.
import { execFile, spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import type { Logger } from '@emdash/shared/logger';
import { extractSvg, ICON_FILE, validatePixelSvg } from '../api/ticket-icon';
import { compareTickets, goalFirstLine, isArchived, type TicketSummary } from '../api/tickets';

/** False when `OZDASH_TICKET_ICONS` is `off` (also `0`, `false`, `no`). */
export function ticketIconsEnabled(env: Record<string, string | undefined>): boolean {
  const value = env.OZDASH_TICKET_ICONS?.trim().toLowerCase();
  return !value || !['off', '0', 'false', 'no'].includes(value);
}

// ---------------------------------------------------------------- claude binary

export type ResolveClaudeOptions = {
  homeDir: string;
  /** This process's PATH (an app started from the Dock has a minimal one). */
  envPath: string | undefined;
  isExecutable(path: string): Promise<boolean>;
  /** The PATH of the user's login shell, or null. Called only when nothing else is found. */
  loginShellPath(): Promise<string | null>;
};

/** Where the Claude CLI usually is, checked before any PATH. */
export function claudeCandidates(homeDir: string): string[] {
  return [
    join(homeDir, '.local', 'bin', 'claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
    join(homeDir, '.claude', 'local', 'claude'),
  ];
}

function inPath(path: string | null | undefined): string[] {
  return (path ?? '')
    .split(delimiter)
    .filter((dir) => dir.startsWith('/'))
    .map((dir) => join(dir, 'claude'));
}

/** The `claude` binary: known places, then PATH, then the login shell's PATH. */
export async function resolveClaudeBinary(options: ResolveClaudeOptions): Promise<string | null> {
  const checked = new Set<string>();
  const firstExecutable = async (paths: string[]) => {
    for (const path of paths) {
      if (checked.has(path)) continue;
      checked.add(path);
      if (await options.isExecutable(path)) return path;
    }
    return null;
  };
  return (
    (await firstExecutable([...claudeCandidates(options.homeDir), ...inPath(options.envPath)])) ??
    (await firstExecutable(inPath(await options.loginShellPath().catch(() => null))))
  );
}

export async function isExecutableFile(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

const PATH_MARKER = '__OZDASH_PATH__';

/** Asks the login shell for its PATH (5 s at most). */
export function readLoginShellPath(
  shell = process.env.SHELL || '/bin/zsh'
): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      shell,
      ['-ilc', `printf '${PATH_MARKER}%s' "$PATH"`],
      { timeout: 5_000, maxBuffer: 256 * 1024 },
      (error, stdout) => {
        const text = String(stdout ?? '');
        const at = text.lastIndexOf(PATH_MARKER);
        resolve(error || at < 0 ? null : text.slice(at + PATH_MARKER.length).trim() || null);
      }
    );
  });
}

// ---------------------------------------------------------------- the CLI call

export const CLAUDE_TIMEOUT_MS = 60_000;

/**
 * Arguments for a one-shot, tool-less Claude call (the prompt goes to stdin):
 * haiku, plain text out, no tools, no MCP servers, no saved session.
 */
export const CLAUDE_ICON_ARGS = [
  '-p',
  '--model',
  'haiku',
  '--output-format',
  'text',
  '--no-session-persistence',
  '--strict-mcp-config',
  '--tools',
  '',
] as const;

/** Runs the CLI with the prompt on stdin; resolves stdout, rejects on error or timeout. */
export function runClaudeCli(
  binary: string,
  prompt: string,
  timeoutMs = CLAUDE_TIMEOUT_MS
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, [...CLAUDE_ICON_ARGS], {
      cwd: tmpdir(),
      // The CLI may need tools next to it (for example node): put its folder on PATH.
      env: {
        ...process.env,
        PATH: [dirname(binary), process.env.PATH].filter(Boolean).join(delimiter),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`claude timed out after ${timeoutMs / 1000} s`));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      if (stdout.length < 256 * 1024) stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      if (stderr.length < 16 * 1024) stderr += String(chunk);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(`claude exited with ${code}: ${stderr.trim().split('\n')[0] ?? ''}`));
    });
    child.stdin.end(prompt);
  });
}

/** The prompt for one ticket's icon. */
export function iconPrompt(ticket: Pick<TicketSummary, 'title' | 'goal'>): string {
  const goal = goalFirstLine(ticket.goal);
  return [
    'Create a small, FUN, colorful 16x16 pixel-art SVG icon that represents this work ticket.',
    `Ticket title: ${ticket.title}`,
    ...(goal ? [`Goal: ${goal}`] : []),
    '',
    'Rules:',
    '- Output ONLY the SVG markup. No code fences, no explanation.',
    '- Root element exactly: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" shape-rendering="crispEdges">',
    '- Use only <rect> elements with integer x, y, width, height on the 16x16 grid, each with a fill color (#rrggbb). Merge runs of same-colored pixels into wider rects.',
    '- Transparent background: no rect that covers the whole canvas.',
    '- 4 to 8 colors that look good on a dark UI (bright, friendly, not too dark).',
    '- No text, no style attributes, no gradients, no scripts, no links. Under 4 KB.',
  ].join('\n');
}

// ---------------------------------------------------------------- the queue

export type IconGeneratorOptions = {
  vaultPath: string;
  logger: Logger;
  /** Returns the model's answer for a prompt; throws on errors (tests pass a fake). */
  generate(prompt: string): Promise<string>;
  /** Commits and pushes the vault (called once for icons that finish close together). */
  sync(): Promise<void>;
  /** Wait before a ticket whose icon failed is tried again. */
  retryDelayMs?: number;
  /** Give up on a ticket (until restart) after this many failed rounds. */
  maxRounds?: number;
  /** Wait after the last new icon before the vault sync. */
  syncDelayMs?: number;
  /** While more icons are queued the sync waits for them, but not longer than this. */
  maxSyncWaitMs?: number;
  now?: () => number;
};

export interface IconGenerator {
  /** The current tickets; queues every one without an icon. */
  update(tickets: readonly TicketSummary[]): void;
  /** Resolves when the queue is empty and nothing runs (for tests). */
  idle(): Promise<void>;
  dispose(): void;
}

export const ICON_RETRY_DELAY_MS = 30 * 60_000;
export const ICON_SYNC_DELAY_MS = 5_000;
export const ICON_MAX_SYNC_WAIT_MS = 2 * 60_000;

export function createIconGenerator(options: IconGeneratorOptions): IconGenerator {
  const { vaultPath, logger } = options;
  const retryDelay = options.retryDelayMs ?? ICON_RETRY_DELAY_MS;
  const maxRounds = options.maxRounds ?? 3;
  const syncDelay = options.syncDelayMs ?? ICON_SYNC_DELAY_MS;
  const maxSyncWait = options.maxSyncWaitMs ?? ICON_MAX_SYNC_WAIT_MS;
  const now = options.now ?? Date.now;
  const folderPath = (folder: string) => join(vaultPath, 'tickets', folder);

  let latest: readonly TicketSummary[] = [];
  const queue: TicketSummary[] = [];
  /** Folder -> failed rounds and when it may be tried again. */
  const failures = new Map<string, { rounds: number; retryAt: number }>();
  let running: string | null = null;
  let disposed = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let syncTimer: ReturnType<typeof setTimeout> | null = null;
  let syncing: Promise<void> | null = null;
  /** When the oldest icon that is not synced yet was written. */
  let unsyncedSince: number | null = null;
  /** A sync waits for the queue to finish. */
  let syncAfterQueue = false;
  let idleWaiters: Array<() => void> = [];

  const isIdle = () => !running && queue.length === 0 && !syncTimer && !syncing && !syncAfterQueue;
  const notifyIdle = () => {
    if (!isIdle()) return;
    const waiters = idleWaiters;
    idleWaiters = [];
    for (const resolve of waiters) resolve();
  };

  function scheduleRetry(at: number) {
    if (disposed) return;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = setTimeout(
      () => {
        retryTimer = null;
        update(latest);
      },
      // A little late on purpose: timers may fire a few ms early, before `retryAt`.
      Math.max(0, at - now()) + 25
    );
  }

  function scheduleSync() {
    unsyncedSince ??= now();
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      syncTimer = null;
      // More icons are on the way: one sync for all of them (unless this one waited long).
      const busy = running !== null || queue.length > 0;
      if (busy && now() - (unsyncedSince ?? now()) < maxSyncWait) {
        syncAfterQueue = true;
        return;
      }
      unsyncedSince = null;
      syncing = options
        .sync()
        .catch((error: unknown) =>
          logger.warn('ozdash icons: vault sync failed', { error: String(error) })
        )
        .finally(() => {
          syncing = null;
          notifyIdle();
        });
    }, syncDelay);
  }

  /** Two tries; the checked SVG, or the last problem. */
  async function makeIcon(ticket: TicketSummary): Promise<{ svg: string } | { error: string }> {
    let error = 'no answer';
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const answer = await options.generate(iconPrompt(ticket));
      const svg = extractSvg(answer);
      const checked = svg ? validatePixelSvg(svg) : { success: false as const, error: 'no <svg>' };
      if (checked.success) return { svg: checked.svg };
      error = checked.error;
    }
    return { error: `invalid SVG: ${error}` };
  }

  async function processOne(ticket: TicketSummary): Promise<void> {
    const dir = folderPath(ticket.folder);
    // Gone, or it got an icon meanwhile (also an icon the board cannot show: keep it).
    if (!(await exists(join(dir, 'ticket.md'))) || (await exists(join(dir, ICON_FILE)))) return;
    let problem: string;
    try {
      const made = await makeIcon(ticket);
      if ('svg' in made) {
        await writeFile(join(dir, ICON_FILE), `${made.svg}\n`, { encoding: 'utf8', flag: 'wx' });
        failures.delete(ticket.folder);
        logger.info('ozdash icons: icon saved', { ticket: ticket.id });
        scheduleSync();
        return;
      }
      problem = made.error;
    } catch (error) {
      problem = error instanceof Error ? error.message : String(error);
    }
    const rounds = (failures.get(ticket.folder)?.rounds ?? 0) + 1;
    const retryAt = now() + retryDelay;
    failures.set(ticket.folder, { rounds, retryAt });
    logger.warn('ozdash icons: no icon this time', { ticket: ticket.id, rounds, problem });
    if (rounds < maxRounds) scheduleRetry(retryAt);
  }

  async function pump(): Promise<void> {
    if (running || disposed) return;
    const ticket = queue.shift();
    if (!ticket) {
      if (syncAfterQueue) {
        syncAfterQueue = false;
        scheduleSync();
      }
      notifyIdle();
      return;
    }
    running = ticket.folder;
    try {
      await processOne(ticket);
    } catch (error) {
      logger.warn('ozdash icons: unexpected error', { error: String(error) });
    } finally {
      running = null;
    }
    void pump();
  }

  function update(tickets: readonly TicketSummary[]): void {
    if (disposed) return;
    latest = tickets;
    const queued = new Set(queue.map((ticket) => ticket.folder));
    const wanted = tickets
      .filter((ticket) => !ticket.icon)
      .filter((ticket) => ticket.folder !== running && !queued.has(ticket.folder))
      .filter((ticket) => {
        const failed = failures.get(ticket.folder);
        return !failed || (failed.rounds < maxRounds && failed.retryAt <= now());
      });
    // Open tickets first, in board order; archived ones last.
    wanted.sort((a, b) => Number(isArchived(a)) - Number(isArchived(b)) || compareTickets(a, b));
    queue.push(...wanted);
    void pump();
  }

  return {
    update,
    idle() {
      if (isIdle()) return Promise.resolve();
      return new Promise((resolve) => idleWaiters.push(resolve));
    },
    dispose() {
      disposed = true;
      queue.length = 0;
      if (retryTimer) clearTimeout(retryTimer);
      if (syncTimer) clearTimeout(syncTimer);
      syncTimer = null;
      syncAfterQueue = false;
      notifyIdle();
    },
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** The production `generate`: finds the CLI once (again after a miss) and runs it. */
export function claudeIconRunner(homeDir: string): (prompt: string) => Promise<string> {
  let binary: Promise<string | null> | null = null;
  return async (prompt) => {
    binary ??= resolveClaudeBinary({
      homeDir,
      envPath: process.env.PATH,
      isExecutable: isExecutableFile,
      loginShellPath: () => readLoginShellPath(),
    });
    const path = await binary;
    if (!path) {
      binary = null; // Look again next time (it may be installed later).
      throw new Error('the claude CLI was not found');
    }
    return runClaudeCli(path, prompt);
  };
}
