// OZdash: fork-only UI state that survives restarts (see core/primitives/mementos).
import { defineVersionedSchema } from '@emdash/core/primitives/versioned-schema/api';
import { z } from 'zod';
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
