import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TicketSummary } from '../api/tickets';
import {
  CLAUDE_ICON_ARGS,
  claudeCandidates,
  createIconGenerator,
  iconPrompt,
  resolveClaudeBinary,
  ticketIconsEnabled,
} from './ticket-icons';

const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as never;
const GOOD =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges"><rect x="1" y="1" width="3" height="2" fill="#ffd166"/></svg>';
const BAD = '<svg viewBox="0 0 16 16"><script>alert(1)</script></svg>';

function ticket(id: string, overrides: Partial<TicketSummary> = {}): TicketSummary {
  return {
    id,
    title: `Ticket ${id}`,
    status: 'active',
    priority: 3,
    rank: null,
    needsOleg: false,
    nextCheck: null,
    pmSession: null,
    updated: '2026-11-01',
    folder: `${id}-t`,
    goal: `Goal of ${id}\nmore`,
    nextStep: null,
    waitingOn: [],
    openQuestions: { count: 0, first: null },
    searchText: '',
    ...overrides,
  };
}

describe('settings and the CLI call', () => {
  it('is on unless OZDASH_TICKET_ICONS=off', () => {
    expect(ticketIconsEnabled({})).toBe(true);
    expect(ticketIconsEnabled({ OZDASH_TICKET_ICONS: 'on' })).toBe(true);
    expect(ticketIconsEnabled({ OZDASH_TICKET_ICONS: 'off' })).toBe(false);
    expect(ticketIconsEnabled({ OZDASH_TICKET_ICONS: ' OFF ' })).toBe(false);
    expect(ticketIconsEnabled({ OZDASH_TICKET_ICONS: '0' })).toBe(false);
  });

  it('runs haiku with text output and no tools', () => {
    expect(CLAUDE_ICON_ARGS).toEqual([
      '-p',
      '--model',
      'haiku',
      '--output-format',
      'text',
      '--no-session-persistence',
      '--strict-mcp-config',
      '--tools',
      '',
    ]);
  });

  it('asks for a 16x16 rect-only SVG about the title and the first Goal line', () => {
    const prompt = iconPrompt({ title: 'Add SCIM sync', goal: '\nSync groups.\nDetails' });
    expect(prompt).toContain('Ticket title: Add SCIM sync');
    expect(prompt).toContain('Goal: Sync groups.');
    expect(prompt).not.toContain('Details');
    expect(prompt).toContain('viewBox="0 0 16 16"');
    expect(prompt).toContain('crispEdges');
    expect(iconPrompt({ title: 'X', goal: null })).not.toContain('Goal:');
  });
});

describe('resolveClaudeBinary', () => {
  const home = '/Users/o';
  const resolveWith = (
    executables: string[],
    envPath?: string,
    shellPath: string | null = null
  ) => {
    const loginShellPath = vi.fn(async () => shellPath);
    const result = resolveClaudeBinary({
      homeDir: home,
      envPath,
      isExecutable: async (path) => executables.includes(path),
      loginShellPath,
    });
    return { result, loginShellPath };
  };

  it('prefers ~/.local/bin, then Homebrew, then /usr/local', async () => {
    expect(claudeCandidates(home).slice(0, 3)).toEqual([
      '/Users/o/.local/bin/claude',
      '/opt/homebrew/bin/claude',
      '/usr/local/bin/claude',
    ]);
    const all = ['/Users/o/.local/bin/claude', '/opt/homebrew/bin/claude'];
    expect(await resolveWith(all).result).toBe('/Users/o/.local/bin/claude');
    expect(await resolveWith(['/usr/local/bin/claude']).result).toBe('/usr/local/bin/claude');
  });

  it('then looks in PATH, and asks the login shell only when nothing was found', async () => {
    const viaPath = resolveWith(['/opt/x/bin/claude'], '/usr/bin:/opt/x/bin');
    expect(await viaPath.result).toBe('/opt/x/bin/claude');
    expect(viaPath.loginShellPath).not.toHaveBeenCalled();

    const viaShell = resolveWith(['/nix/bin/claude'], '/usr/bin:/bin', '/usr/bin:/nix/bin');
    expect(await viaShell.result).toBe('/nix/bin/claude');
    expect(viaShell.loginShellPath).toHaveBeenCalledTimes(1);

    expect(await resolveWith([], '/usr/bin', '/usr/bin:relative/dir').result).toBeNull();
  });
});

describe('icon generator', () => {
  let vault: string;
  const iconPath = (folder: string) => join(vault, 'tickets', folder, 'icon.svg');

  beforeEach(() => {
    vault = join(mkdtempSync(join(tmpdir(), 'ozdash-icons-')), 'vault');
    mkdirSync(vault);
  });
  afterEach(() => {
    rmSync(join(vault, '..'), { recursive: true, force: true });
  });

  function addTicket(folder: string) {
    mkdirSync(join(vault, 'tickets', folder), { recursive: true });
    writeFileSync(join(vault, 'tickets', folder, 'ticket.md'), '---\nid: 1\n---\n');
  }

  function makeGenerator(generate: (prompt: string) => Promise<string>, extra = {}) {
    const sync = vi.fn(async () => {});
    const generator = createIconGenerator({
      vaultPath: vault,
      logger,
      generate: vi.fn(generate),
      sync,
      syncDelayMs: 10,
      retryDelayMs: 20,
      ...extra,
    });
    return { generator, sync };
  }

  it('writes icons one at a time, skips tickets that have one, and syncs once', async () => {
    for (const folder of ['1-t', '2-t', '3-t']) addTicket(folder);
    let running = 0;
    let most = 0;
    const prompts: string[] = [];
    const { generator, sync } = makeGenerator(async (prompt) => {
      running += 1;
      most = Math.max(most, running);
      prompts.push(prompt);
      await new Promise((resolve) => setTimeout(resolve, 30)); // Longer than syncDelayMs.
      running -= 1;
      return `Sure!\n\`\`\`svg\n${GOOD}\n\`\`\``;
    });
    generator.update([ticket('1'), ticket('2', { icon: GOOD }), ticket('3')]);
    generator.update([ticket('1'), ticket('2', { icon: GOOD }), ticket('3')]); // No duplicates.
    await generator.idle();
    expect(most).toBe(1);
    expect(prompts).toHaveLength(2);
    expect(readFileSync(iconPath('1-t'), 'utf8')).toBe(`${GOOD}\n`);
    expect(readFileSync(iconPath('3-t'), 'utf8')).toBe(`${GOOD}\n`);
    expect(existsSync(iconPath('2-t'))).toBe(false);
    expect(sync).toHaveBeenCalledTimes(1);
    generator.dispose();
  });

  it('does open tickets first (board order), archived ones last', async () => {
    for (const folder of ['1-t', '2-t', '3-t']) addTicket(folder);
    const order: string[] = [];
    const { generator } = makeGenerator(async (prompt) => {
      order.push(/Ticket (\d+)/.exec(prompt)![1]!);
      return GOOD;
    });
    generator.update([
      ticket('1', { status: 'done', priority: 1 }),
      ticket('2', { priority: 4 }),
      ticket('3', { priority: 1 }),
    ]);
    await generator.idle();
    expect(order).toEqual(['3', '2', '1']);
    generator.dispose();
  });

  it('retries an invalid answer once, then keeps the fallback and tries later', async () => {
    addTicket('1-t');
    const answers = [BAD, 'no svg here', BAD, GOOD];
    const { generator, sync } = makeGenerator(async () => answers.shift()!);
    generator.update([ticket('1')]);
    await generator.idle();
    expect(answers).toHaveLength(2); // Two tries in the first round.
    expect(existsSync(iconPath('1-t'))).toBe(false);
    expect(sync).not.toHaveBeenCalled();
    // The retry timer queues it again; the second round succeeds.
    await vi.waitFor(() => expect(existsSync(iconPath('1-t'))).toBe(true));
    await generator.idle();
    expect(sync).toHaveBeenCalledTimes(1);
    generator.dispose();
  });

  it('gives up after maxRounds failures (errors and timeouts)', async () => {
    addTicket('1-t');
    const generate = vi.fn(async () => {
      throw new Error('claude timed out after 60 s');
    });
    const { generator } = makeGenerator(generate, { maxRounds: 2 });
    generator.update([ticket('1')]);
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 60));
    generator.update([ticket('1')]);
    await generator.idle();
    expect(generate).toHaveBeenCalledTimes(2);
    generator.dispose();
  });

  it('does not wait for a failed ticket before others, and never overwrites a file', async () => {
    addTicket('1-t');
    addTicket('2-t');
    writeFileSync(iconPath('2-t'), 'hand-made, not valid');
    const generate = vi.fn(async () => GOOD);
    const { generator } = makeGenerator(generate);
    generator.update([ticket('2'), ticket('1'), ticket('9')]); // 9 has no folder.
    await generator.idle();
    expect(generate).toHaveBeenCalledTimes(1);
    expect(readFileSync(iconPath('2-t'), 'utf8')).toBe('hand-made, not valid');
    generator.dispose();
  });
});
