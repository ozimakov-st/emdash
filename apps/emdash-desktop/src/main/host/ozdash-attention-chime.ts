// OZdash: when a task comes back to Oleg, play the Glass chime and show the macOS banner
// together, from the main process (rule: core/features/ozdash/api/attention-chime.ts).
// It does not depend on the renderer, so it also works when the window is hidden.
// The upstream renderer tones and banners for agent events are turned off in
// notification-service-instance.ts, so each transition makes one sound.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Logger } from '@emdash/shared/logger';
import { eq } from 'drizzle-orm';
import { Notification, shell } from 'electron';
import { getPluginMetadata } from '@core/features/agents/api/node/plugin-registry';
import {
  bannerBody,
  createAttentionChimeTracker,
  type AttentionTransition,
  type AttentionChimeTracker,
} from '@core/features/ozdash/api/attention-chime';
import type { AgentEvent } from '@core/primitives/agents/api';
import type { NotificationSettings } from '@core/primitives/app-settings/api';
import type { AppDb } from '@core/services/app-db/node/db';
import { tasks } from '@core/services/app-db/node/schema';
import type { NotificationService } from '@core/services/notifications/node/notification-service';
import type { AgentStatusService } from '@main/core/agent-status/agent-status-service';
import { focusAppFromNotification, isAppFocused } from '@main/host/window';

const GLASS_SOUND = '/System/Library/Sounds/Glass.aiff';

/** The custom sound file ('~/' allowed) if it exists, else the macOS Glass sound. */
export function resolveChimeFile(
  customSoundPath: string,
  exists: (path: string) => boolean = existsSync
): string | null {
  let path = customSoundPath.trim();
  if (path.startsWith('~/')) path = join(homedir(), path.slice(2));
  if (path && exists(path)) return path;
  return exists(GLASS_SOUND) ? GLASS_SOUND : null;
}

function playChime(file: string | null, logger: Pick<Logger, 'warn'>): void {
  if (process.platform !== 'darwin' || !file) {
    shell.beep();
    return;
  }
  // Argument list, no shell.
  const child = spawn('afplay', [file], { stdio: 'ignore' });
  child.on('error', (error) => logger.warn('ozdash: chime failed', { error: String(error) }));
  child.unref();
}

export type OzdashAttentionChimeDeps = {
  onAgentEvent(handler: (event: AgentEvent) => void): () => void;
  settings: { get(key: 'notifications'): Promise<NotificationSettings> };
  isAppFocused(): boolean;
  /** Banner title, e.g. "Claude Code - my-task". */
  describe(event: AgentEvent): Promise<string>;
  /** Opens the task in the renderer (after the window is focused). */
  openTask(event: AgentEvent): void;
  logger: Pick<Logger, 'warn'>;
  tracker?: AttentionChimeTracker;
  playSound?(settings: NotificationSettings): void;
  showBanner?(event: AgentEvent, title: string, transition: AttentionTransition): void;
};

export function attachAttentionChime(deps: OzdashAttentionChimeDeps): () => void {
  const tracker = deps.tracker ?? createAttentionChimeTracker();
  const banners = new Map<string, Notification>();

  const playSound =
    deps.playSound ??
    ((settings: NotificationSettings) =>
      playChime(resolveChimeFile(settings.customSoundPath), deps.logger));

  const showBanner =
    deps.showBanner ??
    ((event: AgentEvent, title: string, transition: AttentionTransition) => {
      if (!Notification.isSupported()) return;
      banners.get(event.conversationId)?.close();
      // Silent: the chime above is the only sound.
      const banner = new Notification({ title, body: bannerBody(transition.status), silent: true });
      banners.set(event.conversationId, banner);
      const release = () => {
        if (banners.get(event.conversationId) === banner) banners.delete(event.conversationId);
      };
      banner.on('close', release);
      banner.on('failed', release);
      banner.on('click', () => {
        focusAppFromNotification();
        release();
        deps.openTask(event);
      });
      banner.show();
    });

  const announce = async (event: AgentEvent, transition: AttentionTransition) => {
    const settings = await deps.settings.get('notifications');
    const routing = tracker.route(settings, deps.isAppFocused());
    if (routing.sound) playSound(settings);
    if (routing.banner) showBanner(event, await deps.describe(event), transition);
  };

  const unsubscribe = deps.onAgentEvent((event) => {
    // Track synchronously so events for one conversation keep their order.
    const transition = tracker.track(event);
    if (!transition) return;
    void announce(event, transition).catch((error: unknown) =>
      deps.logger.warn('ozdash: attention chime failed', { error: String(error) })
    );
  });

  return () => {
    unsubscribe();
    for (const banner of banners.values()) banner.close();
    banners.clear();
  };
}

/** Wires the chime to the app services (main/bootstrap/boot/phases/services.ts). */
export function installOzdashAttentionChime(
  db: AppDb,
  agentStatus: Pick<AgentStatusService, 'on'>,
  settings: OzdashAttentionChimeDeps['settings'],
  notifications: Pick<NotificationService, 'emitDelivery'>,
  logger: Pick<Logger, 'warn'>
): () => void {
  return attachAttentionChime({
    onAgentEvent: (handler) => agentStatus.on('agent:event', handler),
    settings,
    isAppFocused,
    describe: (event) => describeAgentEvent(db, event),
    openTask: (event) =>
      notifications.emitDelivery({
        type: 'open',
        notificationId: `ozdash-chime:${event.conversationId}`,
        target: {
          kind: 'task',
          projectId: event.projectId,
          taskId: event.taskId,
          conversationId: event.conversationId,
        },
      }),
    logger,
  });
}

/** "Provider - task name", like the upstream agent notifications. */
async function describeAgentEvent(db: AppDb, event: AgentEvent): Promise<string> {
  let providerName = event.providerId ?? 'Agent';
  try {
    if (event.providerId) providerName = getPluginMetadata(event.providerId).name;
  } catch {
    // Unknown provider: keep its id.
  }
  const [row] = await db
    .select({ name: tasks.name })
    .from(tasks)
    .where(eq(tasks.id, event.taskId))
    .limit(1);
  return row?.name ? `${providerName} - ${row.name}` : providerName;
}
