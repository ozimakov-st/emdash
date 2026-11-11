// OZdash: fork-only UI state that survives restarts (see core/primitives/mementos).
import { defineVersionedSchema } from '@emdash/core/primitives/versioned-schema/api';
import { z } from 'zod';
import { conversationSubject } from '@core/features/conversations/contributions/subject';
import type { TicketPanelId } from '@core/features/ozdash/api/tickets';
import { days, defineMemento } from '@core/primitives/mementos/api';
import { appSubject } from '@core/primitives/subjects/api';

const ozdashSidebarV1Schema = z.object({
  version: z.literal('1'),
  /** True when the sidebar "More" group (Search, Automations, Settings) is open. */
  navOpen: z.boolean(),
});

export const ozdashSidebarSchema = defineVersionedSchema()
  .initial('1', ozdashSidebarV1Schema)
  .build();

export type OzdashSidebarState = typeof ozdashSidebarSchema.Type;

export const ozdashSidebarMemento = defineMemento({
  id: 'ozdash.sidebar',
  subject: appSubject,
  schema: ozdashSidebarSchema,
  // Collapsed by default: a calm sidebar.
  default: { version: '1' as const, navOpen: false },
  retention: { tier: 'persisted', maxAge: days(3650) },
});

export function toggleNavOpen(state: OzdashSidebarState): OzdashSidebarState {
  return { ...state, navOpen: !state.navOpen };
}

const ozdashTicketsBoardV1Schema = z.object({
  version: z.literal('1'),
  /** True when the Tickets board's Parked panel is open. */
  parkedOpen: z.boolean(),
  /** True when the Tickets board's Archive panel is open. */
  archiveOpen: z.boolean(),
});

export const ozdashTicketsBoardSchema = defineVersionedSchema()
  .initial('1', ozdashTicketsBoardV1Schema)
  .build();

export type OzdashTicketsBoardState = typeof ozdashTicketsBoardSchema.Type;

export const ozdashTicketsBoardMemento = defineMemento({
  id: 'ozdash.tickets-board',
  subject: appSubject,
  schema: ozdashTicketsBoardSchema,
  // New tickets land in Parked, so it starts open; the archive starts closed.
  default: { version: '1' as const, parkedOpen: true, archiveOpen: false },
  retention: { tier: 'persisted', maxAge: days(3650) },
});

export function isTicketPanelOpen(state: OzdashTicketsBoardState, panel: TicketPanelId): boolean {
  return panel === 'parked' ? state.parkedOpen : state.archiveOpen;
}

export function toggleTicketPanel(
  state: OzdashTicketsBoardState,
  panel: TicketPanelId
): OzdashTicketsBoardState {
  return panel === 'parked'
    ? { ...state, parkedOpen: !state.parkedOpen }
    : { ...state, archiveOpen: !state.archiveOpen };
}

const ozdashTicketSessionsV1Schema = z.object({
  version: z.literal('1'),
  /** True when the Ticket tab's Sessions list also shows archived tasks. */
  showArchived: z.boolean(),
});

export const ozdashTicketSessionsSchema = defineVersionedSchema()
  .initial('1', ozdashTicketSessionsV1Schema)
  .build();

export const ozdashTicketSessionsMemento = defineMemento({
  id: 'ozdash.ticket-sessions',
  subject: appSubject,
  schema: ozdashTicketSessionsSchema,
  // Archived tasks are hidden until "Show archived" is turned on.
  default: { version: '1' as const, showArchived: false },
  retention: { tier: 'persisted', maxAge: days(3650) },
});

const ozdashChatViewV1Schema = z.object({
  version: z.literal('1'),
  /** How this chat (ACP) conversation is shown; null = follow the global session mode. */
  view: z.enum(['oz', 'emdash']).nullable(),
});

export const ozdashChatViewSchema = defineVersionedSchema()
  .initial('1', ozdashChatViewV1Schema)
  .build();

/** Per chat conversation: OZ chat or Emdash chat (tab menu). */
export const ozdashChatViewMemento = defineMemento({
  id: 'ozdash.chat-view',
  subject: conversationSubject,
  schema: ozdashChatViewSchema,
  default: { version: '1' as const, view: null },
  retention: { tier: 'persisted', maxAge: days(365), maxEntries: 5_000 },
});
