// OZdash: the attention rule on conversation rows shaped like the live OZdash database
// (2026-11-07, `conversations` table), through the same path the sidebar uses:
// DB row -> Conversation DTO (main) -> ConversationStore (renderer) -> taskAttention.
import { describe, expect, it } from 'vitest';
import { ConversationStore } from '@core/features/conversations/api/browser/conversation-manager';
import { mapConversationRowToConversation } from '@core/features/conversations/api/node/utils';
import type { ConversationRow } from '@core/services/app-db/node/schema';
import { taskAttention } from './attention';

const PROJECT_ID = 'd3c792dd-470a-4dbc-8af8-f29d9acf6bab';

// The `attention-test` task: created over MCP, never opened, Claude PTY session.
const liveRow: ConversationRow = {
  id: '71abaec4-6674-4a38-92a0-48fc6f7969f5',
  projectId: PROJECT_ID,
  taskId: '96fb1cfe-43d4-475a-ae72-bc56f2a54d57',
  isInitialConversation: true,
  agentStatusSeen: 0,
  agentStatus: 'awaiting-input',
  title: 'attention-test',
  provider: 'claude',
  type: 'pty',
  config: {
    version: '1',
    type: 'pty',
    autoApprove: true,
    initialPrompt:
      'Attention test. Do not change files or run tools. Ask me one short question and wait for my answer.',
  } as ConversationRow['config'],
  createdAt: '2026-11-07T00:31:19.306Z',
  updatedAt: '2026-11-07T00:31:35.443Z',
  cwd: '/Users/olegzimakov/emdash/worktrees/ium-token-server-8e30684b/emdash-feat-attention-test-0zcal',
  workspacePath:
    '/Users/olegzimakov/emdash/worktrees/ium-token-server-8e30684b/emdash-feat-attention-test-0zcal',
  providerSessionId: '71abaec4-6674-4a38-92a0-48fc6f7969f5',
  idRegime: 'emdash-chosen',
  lastSessionActivityAt: '2026-11-07T00:31:35.443Z',
  observedStatus: 'present',
  lastObservedAt: '2026-11-07T00:32:44.680Z',
  origin: 'registered',
  location: 'local',
  sshConnectionId: null,
  deletionTombstone: null,
  untrackedAt: null,
};

function attentionOf(...rows: Partial<ConversationRow>[]) {
  return taskAttention(
    rows.map((overrides) => {
      const conversation = mapConversationRowToConversation({ ...liveRow, ...overrides });
      if (!conversation) throw new Error('row is not linked to a task');
      return new ConversationStore(conversation);
    })
  );
}

describe('attention on live-shaped conversation rows', () => {
  it('flags the unopened task whose agent waits for input (strong)', () => {
    expect(attentionOf({})).toBe('input');
  });

  it('flags the same task as finished (soft) right after Claude stops', () => {
    expect(attentionOf({ agentStatus: 'completed' })).toBe('done');
  });

  it('keeps the soft mark after a restart reset the wait to idle but kept seen = 0', () => {
    expect(attentionOf({ agentStatus: 'idle' })).toBe('done');
  });

  it('flags a failed agent (strong)', () => {
    expect(attentionOf({ agentStatus: 'error' })).toBe('input');
  });

  it('clears once Oleg viewed it (agent_status_seen = 1), as for ticket-1 / child-demo', () => {
    expect(attentionOf({ agentStatusSeen: 1 })).toBeNull();
    expect(attentionOf({ agentStatus: 'idle', agentStatusSeen: 1 })).toBeNull();
    expect(attentionOf({ agentStatus: 'completed', agentStatusSeen: 1 })).toBeNull();
  });

  it('clears while the agent works again', () => {
    expect(attentionOf({ agentStatus: 'working', agentStatusSeen: 1 })).toBeNull();
  });

  it('is nothing for a new conversation before the first status (null status, seen default 1)', () => {
    expect(attentionOf({ agentStatus: null, agentStatusSeen: 1 })).toBeNull();
  });

  it('takes the strongest level across the conversations of a task', () => {
    expect(
      attentionOf(
        { id: 'a', agentStatus: 'completed' },
        { id: 'b', agentStatus: 'awaiting-input' },
        { id: 'c', agentStatus: 'working', agentStatusSeen: 1 }
      )
    ).toBe('input');
  });
});
