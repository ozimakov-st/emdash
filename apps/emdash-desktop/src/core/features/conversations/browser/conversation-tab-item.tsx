import { AgentStatus } from '@emdash/ui/react/components';
import { observer } from 'mobx-react-lite';
import { useAgentMetadata } from '@core/features/agents/api/browser/use-agent-metadata';
import { AgentIcon } from '@core/features/agents/contributions/browser/agent-icon';
import { formatConversationTitleForDisplay } from '@core/features/conversations/api/browser/conversation-title-utils';
import { terminalTabCommands } from '@core/features/ozdash/contributions/browser';
import { agentSupportsAcp } from '@core/primitives/agents/api';
import { MAX_CONVERSATION_TITLE_LENGTH } from '@core/primitives/conversations/api';
import type {
  TabBarItemProps,
  ResolvedTab,
} from '@core/primitives/workbench-shell/browser/tabs/core/tab-provider';
import {
  GenericTabDragPreview,
  GenericTabItem,
} from '@core/primitives/workbench-shell/browser/tabs/tab-bar/generic-tab-item';
import type { ConversationTabResource } from './conversation-tab-resource';

export const ConversationTabBarItem = observer(function ConversationTabBarItem({
  tab,
  host,
  ctx,
}: TabBarItemProps<ConversationTabResource>) {
  const store = tab.resource.store;
  const title = formatConversationTitleForDisplay(store.data.providerId, store.data.title);
  const rawTitle = store.data.title ?? '';
  // Fork (ozimakov-st): "New <agent> session in OZ chat / Emdash chat" in the tab menu.
  const { data: agents } = useAgentMetadata();
  const supportsChat = agentSupportsAcp(
    agents?.find((agent) => agent.id === store.data.providerId)?.capabilities
  );

  return (
    <GenericTabItem
      tab={tab}
      host={host}
      ctx={ctx}
      label={title}
      preSlot={<AgentIcon id={store.data.providerId} size={16} />}
      statusSlot={
        <span className="transition-opacity group-hover:opacity-0">
          <AgentStatus status={store.indicatorStatus} />
        </span>
      }
      kindCommands={[
        {
          id: 'conversation:rename',
          label: 'Rename',
          group: 'edit',
          shortcut: { commandId: 'workbench.tabRename' },
          run: () => host.requestRename(tab.tabId),
        },
        ...terminalTabCommands({
          projectId: store.data.projectId,
          taskId: store.data.taskId,
          providerId: store.data.providerId,
          supportsChat,
        }),
      ]}
      renameValue={rawTitle}
      renameMaxLength={MAX_CONVERSATION_TITLE_LENGTH}
    />
  );
});

export const ConversationTabBarItemDragPreview = observer(
  function ConversationTabBarItemDragPreview({
    tab,
  }: {
    tab: ResolvedTab<ConversationTabResource>;
  }) {
    const store = tab.resource.store;
    const label = formatConversationTitleForDisplay(store.data.providerId, store.data.title);
    return (
      <GenericTabDragPreview
        preSlot={
          store.data.providerId ? (
            <AgentIcon id={store.data.providerId} size={16} className="shrink-0" />
          ) : undefined
        }
        label={label}
      />
    );
  }
);
