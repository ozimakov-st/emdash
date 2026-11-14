import { log } from '@emdash/shared/logger';
import { and, eq, inArray } from 'drizzle-orm';
import { conversationRegistryTable as conversations } from '@core/features/conversations/api/node/registry';
import type { AppDb } from '@core/services/app-db/node/db';

/**
 * Resets statuses left over from the last run and returns the ids it reset: the
 * conversations that were working (or waiting) when the app stopped.
 */
export async function resetStaleAcpAgentStatuses(db: AppDb): Promise<string[]> {
  try {
    const rows = await db
      .update(conversations)
      // OZdash: keep the seen flag. A restart is not Oleg viewing the conversation, so a
      // wait he has not seen yet stays highlighted (see ozdash/api/attention.ts).
      .set({ agentStatus: 'idle' })
      .where(
        and(
          eq(conversations.type, 'acp'),
          eq(conversations.location, 'local'),
          inArray(conversations.agentStatus, ['working', 'awaiting-input'])
        )
      )
      .returning({ id: conversations.id });
    return rows.map((row) => row.id);
  } catch (error) {
    log.warn('Failed to reset stale ACP agent statuses', { error: String(error) });
    return [];
  }
}
