// Fork (ozimakov-st): "Tickets" button on the PM project row; opens the Tickets board.
import { Tooltip } from '@emdash/ui/react/primitives';
import { KanbanSquare } from 'lucide-react';
import { ticketsStore } from '@core/features/ozdash/api/browser/tickets-store';
import { projectViewDef } from '@core/features/projects/contributions/views';
import { useNavigate } from '@core/primitives/navigation/browser/navigation-hooks';
import { SidebarItemMiniButton } from './sidebar-primitives';

export function OzdashTicketsButton({ projectId }: { projectId: string }) {
  const { navigate } = useNavigate();
  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        className="h-6"
        render={
          <SidebarItemMiniButton
            type="button"
            aria-label="Tickets"
            className="opacity-0 transition-opacity duration-150 group-hover/row:opacity-100"
            onClick={(event) => {
              event.stopPropagation();
              ticketsStore.setBoardSelected(true);
              navigate(projectViewDef({ projectId }));
            }}
          >
            <KanbanSquare className="h-4 w-4" />
          </SidebarItemMiniButton>
        }
      />
      <Tooltip.Content>Tickets</Tooltip.Content>
    </Tooltip.Root>
  );
}
