// Fork (ozimakov-st): window-scope handlers for the ticket shortcuts (see window-scope.tsx).
// ⌥⌘B opens the Tickets board from anywhere; ⌥⌘T toggles the open task's Ticket tab
// (only in a task with a ticket). Rules: ozdash/api/ticket-shortcuts.ts.
import { taskTicketMarkers } from '@core/features/mcp/api/browser/ozdash-task-tickets';
import { isPmProjectInWindow } from '@core/features/ozdash/api/browser/ozdash-pm';
import { ticketsStore } from '@core/features/ozdash/api/browser/tickets-store';
import { pmProjectIdIn, ticketPanelTarget } from '@core/features/ozdash/api/ticket-shortcuts';
import { getProjectManagerStore } from '@core/features/projects/api/browser/stores/project-selectors';
import { projectViewDef } from '@core/features/projects/contributions/views';
import { getTaskComposition } from '@core/features/workbench/api/browser/task-composition-selectors';
import { getNavigation } from '@core/primitives/navigation/browser/navigation-selectors';
import { enabled, hidden } from '@core/primitives/view-scopes/api';

/** The PM project's id in this window, or null. */
function boardProjectId(): string | null {
  return pmProjectIdIn(getProjectManagerStore().projects.entries(), isPmProjectInWindow);
}

/** The open task when it has a ticket, or null. */
function ticketTarget() {
  ticketsStore.ensureStarted();
  return ticketPanelTarget(
    getNavigation().currentRef,
    ticketsStore.tickets,
    (taskId) => taskTicketMarkers().get(taskId)?.ticket.id ?? null
  );
}

/** Opens the PM project on its Tickets board (the sidebar Tickets button does the same). */
export function openTicketsBoard(): void {
  const projectId = boardProjectId();
  if (!projectId) return;
  ticketsStore.setBoardSelected(true);
  getNavigation().navigate(projectViewDef({ projectId }));
}

/** Window-scope handlers for `ozdash.openTicketsBoard` and `ozdash.toggleTicketPanel`. */
export function ozdashTicketShortcutsImpl() {
  return {
    'ozdash.openTicketsBoard': () => ({
      availability: () => (boardProjectId() ? enabled : hidden),
      execute: () => openTicketsBoard(),
    }),
    'ozdash.toggleTicketPanel': () => ({
      availability: () => (ticketTarget() ? enabled : hidden),
      // Same as the titlebar Ticket button: open the tab, or close the sidebar when it shows.
      execute: () => {
        const target = ticketTarget();
        if (!target) return;
        getTaskComposition(target.projectId, target.taskId)?.chrome.commands.toggleSidebarTab(
          'ticket'
        );
      },
    }),
  } as const;
}
