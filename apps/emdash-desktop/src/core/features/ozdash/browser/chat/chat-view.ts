// Fork (ozimakov-st): the per-session mode switch.
//
// - A chat (ACP) tab can be shown as OZ chat or Emdash chat at any time (a memento per
//   conversation; none = follow the global session mode).
// - Chat ↔ terminal needs a new session: the transport of a running session is fixed. The
//   tab menu starts a new session for the same agent in the same task, in the other mode.
import { formatHostRef } from '@emdash/core/primitives/host/api';
import type { AgentProviderId } from '@emdash/plugins/agents/types';
import { toast } from '@emdash/ui/react/primitives';
import { hostRefFromConnectionId } from '@core/features/agents/api/browser/client';
import { nextDefaultConversationTitle } from '@core/features/conversations/api/browser/conversation-title-utils';
import { readProviderSettings } from '@core/features/conversations/api/browser/provider-preferences';
import { conversationRegistry } from '@core/features/conversations/api/browser/stores/conversation-registry';
import { conversationSubject } from '@core/features/conversations/contributions/subject';
import {
  normalizeSessionMode,
  resolveChatView,
  type ChatView,
  type SessionMode,
} from '@core/features/ozdash/api/chat/session-mode';
import { ozdashChatViewMemento } from '@core/features/ozdash/contributions/mementos';
import { getProjectSshConnectionId } from '@core/features/projects/api/browser/stores/project-selectors';
import { getAppSettingValueSnapshot } from '@core/features/settings/api/browser/use-app-settings-key';
import { getTaskComposition } from '@core/features/workbench/api/browser/task-composition-selectors';
import type { MementoHandle } from '@core/primitives/mementos/browser';
import { getMementoClient } from '@core/primitives/mementos/browser/singleton';
import type { TabCommand } from '@core/primitives/workbench-shell/browser/tabs/tab-bar/tab-commands';

type ChatViewState = typeof ozdashChatViewMemento.default;

const handles = new Map<string, MementoHandle<ChatViewState>>();

function chatViewHandle(conversationId: string): MementoHandle<ChatViewState> {
  let handle = handles.get(conversationId);
  if (!handle) {
    handle = getMementoClient()
      .subject(conversationSubject({ conversationId }))
      .handle(ozdashChatViewMemento);
    handles.set(conversationId, handle);
  }
  return handle;
}

/** The global session mode, from the settings cache (OZ chat until it has loaded). */
export function currentSessionMode(): SessionMode {
  return normalizeSessionMode(getAppSettingValueSnapshot('interface')?.sessionMode);
}

/** Observable (mobx): how a chat conversation is shown right now. */
export function chatViewFor(conversationId: string, mode: SessionMode): ChatView {
  return resolveChatView(chatViewHandle(conversationId).value.view, mode);
}

export function setChatView(conversationId: string, view: ChatView): void {
  chatViewHandle(conversationId).update({ version: '1', view });
}

/**
 * Starts a new session for the same agent in the same task, in another mode, and opens
 * it. The old session keeps running.
 */
export async function startSessionInMode(input: {
  projectId: string;
  taskId: string;
  providerId: string;
  mode: SessionMode;
}): Promise<void> {
  const manager = conversationRegistry.get(input.taskId);
  if (!manager) return;
  const host = formatHostRef(hostRefFromConnectionId(getProjectSshConnectionId(input.projectId)));
  const type = input.mode === 'terminal' ? 'pty' : 'acp';
  const id = crypto.randomUUID();
  try {
    const settings = await readProviderSettings({ host, providerId: input.providerId });
    if (type === 'acp') setChatView(id, input.mode === 'emdash-chat' ? 'emdash' : 'oz');
    await manager.createConversation({
      projectId: input.projectId,
      taskId: input.taskId,
      id,
      provider: input.providerId as AgentProviderId,
      title: nextDefaultConversationTitle(
        input.providerId,
        Array.from(manager.conversations.values(), (conversation) => conversation.data)
      ),
      type,
      ...(type === 'acp'
        ? { options: settings.acp.options }
        : { autoApprove: settings.pty.autoApprove }),
    });
    getTaskComposition(input.projectId, input.taskId)?.paneLayout.open(
      type === 'acp' ? 'acp-chat' : 'conversation',
      { conversationId: id },
      { preview: false }
    );
  } catch (error) {
    toast.error('Could not start the new session', { description: String(error) });
  }
}

const MODE_LABEL: Record<SessionMode, string> = {
  'oz-chat': 'OZ chat',
  'emdash-chat': 'Emdash chat',
  terminal: 'terminal',
};

/** Tab menu items for a chat (ACP) tab. */
export function chatTabCommands(input: {
  projectId: string;
  taskId: string;
  conversationId: string;
  providerId: string;
}): TabCommand[] {
  const view = () => chatViewFor(input.conversationId, currentSessionMode());
  return [
    {
      id: 'ozdash:view-oz',
      label: 'Show as OZ chat',
      group: 'ozdash-mode',
      isAvailable: () => view() !== 'oz',
      run: () => setChatView(input.conversationId, 'oz'),
    },
    {
      id: 'ozdash:view-emdash',
      label: 'Show as Emdash chat',
      group: 'ozdash-mode',
      isAvailable: () => view() !== 'emdash',
      run: () => setChatView(input.conversationId, 'emdash'),
    },
    {
      id: 'ozdash:new-terminal',
      label: `New ${input.providerId} session in ${MODE_LABEL.terminal}`,
      group: 'ozdash-mode',
      run: () => startSessionInMode({ ...input, mode: 'terminal' }),
    },
  ];
}

/** Tab menu items for a terminal tab. */
export function terminalTabCommands(input: {
  projectId: string;
  taskId: string;
  providerId: string;
  supportsChat: boolean;
}): TabCommand[] {
  if (!input.supportsChat) return [];
  return (['oz-chat', 'emdash-chat'] as const).map((mode) => ({
    id: `ozdash:new-${mode}`,
    label: `New ${input.providerId} session in ${MODE_LABEL[mode]}`,
    group: 'ozdash-mode',
    run: () => startSessionInMode({ ...input, mode }),
  }));
}
