import type { TranscriptTurn } from '@emdash/core/runtimes/acp/api/client';
import { describe, expect, it } from 'vitest';
import {
  buildTurnView,
  fileChipsLayout,
  parseTaskNotificationText,
  stepsPresentation,
} from './transcript-view';

const tool = { toolCallId: 'tc', title: '', status: 'done' as const };

const turn: TranscriptTurn = {
  id: 'turn-1',
  seq: 1,
  initiator: 'user',
  outcome: { kind: 'done' },
  items: [
    { kind: 'message', id: 'u', seq: 0, role: 'user', text: 'Fix it' },
    {
      kind: 'thinking',
      id: 'th',
      seq: 1,
      segmentId: 's',
      text: 'hmm',
      status: 'done',
      startedAt: 0,
    },
    { ...tool, kind: 'read-tool-call', id: 'r', seq: 2 },
    { kind: 'message', id: 'm1', seq: 3, role: 'assistant', text: 'Looking' },
    {
      ...tool,
      kind: 'modify-file-tool-call',
      id: 'e',
      seq: 4,
      path: 'a.ts',
      oldText: 'a',
      newText: 'b\nc',
    },
    { ...tool, kind: 'spawn-subagent-tool-call', id: 'sa', seq: 5, name: 'Check' },
    { kind: 'message', id: 'm2', seq: 6, role: 'assistant', text: 'Done.' },
  ],
};

describe('buildTurnView', () => {
  it('splits user message, steps and the final answer', () => {
    const view = buildTurnView(turn, { active: false });
    expect(view.user?.id).toBe('u');
    expect(view.answer?.id).toBe('m2');
    expect(view.steps.map((step) => step.kind)).toEqual([
      'thinking',
      'tool',
      'message',
      'tool',
      'tool',
    ]);
    expect(view.counts).toEqual({ tools: 3, messages: 1, subagents: 1 });
    expect(view.fileChanges).toEqual([{ path: 'a.ts', added: 2, removed: 1 }]);
    expect(stepsPresentation(view, false, 'x')).toEqual({ kind: 'collapsed', label: 'x' });
    expect(stepsPresentation(view, true, 'x')).toEqual({ kind: 'inline' });
  });

  it('has no answer while a tool runs after the last message', () => {
    const running: TranscriptTurn = {
      ...turn,
      items: [...turn.items.slice(0, 4), { ...tool, kind: 'read-tool-call', id: 'r2', seq: 9 }],
    };
    expect(buildTurnView(running, { active: true }).answer).toBeNull();
  });

  it('shows task notifications as system rows, not user messages', () => {
    const agentTurn: TranscriptTurn = {
      id: 'turn-2',
      seq: 2,
      initiator: 'agent',
      items: [
        {
          kind: 'message',
          id: 'n',
          seq: 0,
          role: 'user',
          text: '<task-notification><task-id>a</task-id><status>completed</status><summary>Watcher done</summary></task-notification>',
        },
        { kind: 'notification', id: 'n2', seq: 1, title: 'Shell finished', text: 'exit 0' },
        { kind: 'message', id: 'm', seq: 2, role: 'assistant', text: 'The watcher finished.' },
      ],
    };
    const view = buildTurnView(agentTurn, { active: false });
    expect(view.user).toBeNull();
    expect(view.steps).toEqual([
      { kind: 'system', item: { id: 'n', title: 'Watcher done', text: 'Status: completed' } },
      { kind: 'system', item: { id: 'n2', title: 'Shell finished', text: 'exit 0' } },
    ]);
    expect(view.answer?.id).toBe('m');
    expect(stepsPresentation(view, false, '')).toEqual({ kind: 'inline' });
  });

  it('ignores normal user text in the notification parser', () => {
    expect(parseTaskNotificationText('hello')).toBeNull();
  });
});

describe('fileChipsLayout', () => {
  it('shows up to 3 chips plus a "+N more" total', () => {
    const changes = [1, 2, 3, 4, 5].map((n) => ({ path: `f${n}`, added: n, removed: 1 }));
    expect(fileChipsLayout(changes)).toEqual({
      shown: changes.slice(0, 3),
      more: { count: 2, added: 9, removed: 2 },
    });
    expect(fileChipsLayout(changes.slice(0, 4)).more).toBeNull();
  });
});
