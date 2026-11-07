import { log } from '@emdash/shared/logger';
import { and, eq, inArray } from 'drizzle-orm';
import { conversationRegistryTable as conversations } from '@core/features/conversations/api/node/registry';
import type { AppDb } from '@core/services/app-db/node/db';

export async function resetStaleTuiAgentStatuses(db: AppDb): Promise<void> {
  try {
    await db
      .update(conversations)
      // OZdash: keep the seen flag. A restart is not Oleg viewing the conversation, so a
      // wait he has not seen yet stays highlighted (see ozdash/api/attention.ts).
      .set({ agentStatus: 'idle' })
      .where(
        and(
          eq(conversations.type, 'pty'),
          eq(conversations.location, 'local'),
          inArray(conversations.agentStatus, ['working', 'awaiting-input'])
        )
      );
  } catch (error) {
    log.warn('Failed to reset stale TUI agent statuses', { error: String(error) });
  }
}
