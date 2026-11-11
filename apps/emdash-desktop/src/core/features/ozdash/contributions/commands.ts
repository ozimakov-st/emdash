// Fork (ozimakov-st): Cmd+1…9, Cmd+0 open the first 10 sidebar task rows
// (rule: ozdash/api/quick-switch.ts). They take Cmd+1…9 from the tab commands
// (workbench.tab1…9) and Cmd+0 from the View > Actual Size menu item.
import { defineCommand } from '@core/primitives/commands/api';
import { keybinding } from '@core/primitives/keybindings/api';

function defineQuickSwitchCommand<const TSlot extends number>(slot: TSlot) {
  return defineCommand({
    id: `ozdash.quickSwitch${slot}` as const,
    title: `Open Sidebar Task ${slot}`,
    description: `Open the task in row ${slot} of the sidebar`,
    category: 'Navigation',
    keybinding: keybinding.fixed(`Mod+${slot % 10}`),
  });
}

export const OZDASH_COMMAND_DEFS = [
  defineQuickSwitchCommand(1),
  defineQuickSwitchCommand(2),
  defineQuickSwitchCommand(3),
  defineQuickSwitchCommand(4),
  defineQuickSwitchCommand(5),
  defineQuickSwitchCommand(6),
  defineQuickSwitchCommand(7),
  defineQuickSwitchCommand(8),
  defineQuickSwitchCommand(9),
  defineQuickSwitchCommand(10),
] as const;
