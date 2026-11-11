import type { ToolNode } from '@emdash/core/runtimes/acp/api/client';
import { describe, expect, it } from 'vitest';
import {
  countTools,
  firstLine,
  formatDuration,
  isBackgroundShell,
  lineDiffStats,
  shortPath,
  stepsLabel,
  summarizeTool,
} from './tool-summary';

const base = { id: 't', seq: 0, toolCallId: 'tc', title: '', status: 'done' as const };

describe('tool rows', () => {
  it('shell: purpose as label, command as detail', () => {
    expect(
      summarizeTool({
        ...base,
        kind: 'execute-tool-call',
        title: 'git status',
        command: 'git status\n--short',
        inputSummary: 'Check the tree',
      })
    ).toEqual({ icon: 'terminal', label: 'Check the tree', detail: 'git status', status: 'done' });
  });

  it('shell without a purpose says Run', () => {
    const row = summarizeTool({ ...base, kind: 'execute-tool-call', title: 'ls', command: 'ls' });
    expect(row.label).toBe('Run');
    expect(row.detail).toBe('ls');
  });

  it('marks background shells', () => {
    const node: ToolNode = {
      ...base,
      kind: 'execute-tool-call',
      command: 'npm test',
      outputText: 'Command running in background with ID: b1',
    };
    expect(isBackgroundShell(node)).toBe(true);
    expect(summarizeTool(node).background).toBe(true);
  });

  it('edits carry line stats and a short path', () => {
    expect(
      summarizeTool({
        ...base,
        kind: 'modify-file-tool-call',
        path: '/repo/src/a/b.ts',
        oldText: 'x\ny',
        newText: 'x\nz\nw',
      })
    ).toEqual({
      icon: 'edit',
      label: 'Edit',
      detail: '…/a/b.ts',
      added: 2,
      removed: 1,
      status: 'done',
    });
  });

  it('subagents and MCP tools', () => {
    expect(
      summarizeTool({
        ...base,
        kind: 'spawn-subagent-tool-call',
        name: 'Watch PR',
        background: true,
      })
    ).toMatchObject({
      icon: 'agent',
      label: 'Background agent',
      detail: 'Watch PR',
      background: true,
    });
    expect(
      summarizeTool({ ...base, kind: 'mcp-tool-call', server: 'emdash', tool: 'create_task' })
    ).toMatchObject({ icon: 'mcp', label: 'emdash · create_task' });
  });

  it('counts nested tools and labels steps', () => {
    const nodes: ToolNode[] = [
      {
        ...base,
        kind: 'spawn-subagent-tool-call',
        name: 'a',
        children: [{ ...base, kind: 'read-tool-call' }],
      },
      {
        kind: 'tool-group',
        id: 'g',
        seq: 1,
        label: 'Read 2 files',
        groupKind: 'read-batch',
        status: 'done',
        children: [
          { ...base, kind: 'read-tool-call' },
          { ...base, kind: 'read-tool-call' },
        ],
      },
    ];
    expect(countTools(nodes)).toBe(4);
    expect(stepsLabel({ tools: 3, messages: 2, subagents: 0 })).toBe('3 tool calls, 2 messages');
    expect(stepsLabel({ tools: 0, messages: 1, subagents: 1 })).toBe('1 message, 1 subagent');
  });

  it('helpers', () => {
    expect(firstLine('  a\nb')).toBe('a');
    expect(firstLine('abcdef', 4)).toBe('abc…');
    expect(shortPath('a/b')).toBe('a/b');
    expect(lineDiffStats(null, '')).toEqual({ added: 0, removed: 0 });
    expect(formatDuration(174_500)).toBe('2m, 54s');
    expect(formatDuration(12_000)).toBe('12s');
    expect(formatDuration(3_780_000)).toBe('1h, 3m');
  });
});
