// Fork (ozimakov-st): picks the view of the active chat (ACP) tab: OZ chat, or the stock
// Emdash chat panel passed in as `fallback`.
import { observer } from 'mobx-react-lite';
import type { ReactNode } from 'react';
import type { OzChatStore } from './chat-store';
import { chatViewFor } from './chat-view';
import { OzChatPanel } from './oz-chat-panel';
import { useSessionMode } from './session-mode-settings';

export const OzChatHost = observer(function OzChatHost({
  store,
  fallback,
}: {
  store: OzChatStore | null;
  fallback: ReactNode;
}) {
  const mode = useSessionMode();
  if (!store || chatViewFor(store.conversationId, mode) !== 'oz') return fallback;
  return <OzChatPanel key={store.conversationId} store={store} />;
});
