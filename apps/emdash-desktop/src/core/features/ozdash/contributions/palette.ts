// Fork (ozimakov-st): OZdash commands in the ⌘K command list.
import { defineCommandPaletteItem } from '@core/primitives/palette/api';
import { openTicketsBoardCommand, toggleTicketPanelCommand } from './commands';

export const OZDASH_COMMAND_PALETTE_ITEMS = [
  defineCommandPaletteItem({
    command: openTicketsBoardCommand,
    aliases: ['tickets', 'board', 'kanban', 'pm'],
  }),
  defineCommandPaletteItem({ command: toggleTicketPanelCommand, aliases: ['ticket'] }),
] as const;
