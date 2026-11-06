import { getPillTabId, PillTabs, type PillTab } from '@emdash/ui/react/patterns';
import {
  GitPullRequest,
  KanbanSquare,
  ListTodo,
  PanelsTopLeft,
  Settings as SettingsIcon,
} from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { isPmProjectInWindow } from '@core/features/ozdash/api/browser/ozdash-pm';
import { ticketsStore } from '@core/features/ozdash/api/browser/tickets-store';
import { TicketsBoard } from '@core/features/ozdash/contributions/browser';
import {
  asAvailableProject,
  getProjectStore,
  getProjectViewStore,
} from '@core/features/projects/api/browser/stores/project-selectors';
import { PullRequestView } from '@core/features/projects/browser/components/pr-view/pr-view';
import { SettingsPanel } from '@core/features/projects/browser/components/settings-view/settings-panel';
import { TaskList } from '@core/features/projects/browser/components/task-view/task-list';
import { ProjectWorkspacesView } from '@core/features/projects/browser/components/workspaces-view/project-workspaces-view';
import type { ProjectView } from '@core/features/projects/browser/stores/project-view';
import { projectViewDef } from '@core/features/projects/contributions/views';
import { getGitRepositoryStore } from '@core/features/source-control/api/browser/stores/source-control-selectors';
import { useCurrentViewParams } from '@core/primitives/navigation/browser/navigation-hooks';
import { cn } from '@core/primitives/styling/browser/cn';

const PROJECT_SECTION_PANEL_ID = 'project-section-panel';

const projectViewItems: readonly PillTab<ProjectView>[] = [
  { value: 'tasks', label: 'Tasks', icon: <ListTodo className="size-3.5" /> },
  {
    value: 'pull-request',
    label: 'Pull Requests',
    icon: <GitPullRequest className="size-3.5" />,
  },
  {
    value: 'workspaces',
    label: 'Workspaces',
    icon: <PanelsTopLeft className="size-3.5" />,
  },
  { value: 'settings', label: 'Settings', icon: <SettingsIcon className="size-3.5" /> },
];

export const ActiveProject = observer(function ActiveProject() {
  const {
    params: { projectId },
  } = useCurrentViewParams(projectViewDef);
  const context = asAvailableProject(getProjectStore(projectId));
  const view = getProjectViewStore(projectId);

  if (!context || !view) return null;

  const provider = getGitRepositoryStore(projectId)?.providerRepository?.provider;
  const baseItems =
    provider === 'gitlab'
      ? projectViewItems.map((item) =>
          item.value === 'pull-request' ? { ...item, label: 'Merge Requests' } : item
        )
      : projectViewItems;
  // Fork (ozimakov-st): the PM project gets a Tickets tab first, selected by default.
  const isPm = isPmProjectInWindow(getProjectStore(projectId));
  const activeView: ProjectView | 'tickets' =
    isPm && ticketsStore.boardSelected ? 'tickets' : view.activeView;
  const items: readonly PillTab<ProjectView | 'tickets'>[] = isPm
    ? [
        { value: 'tickets', label: 'Tickets', icon: <KanbanSquare className="size-3.5" /> },
        ...baseItems,
      ]
    : baseItems;
  return (
    <div className="flex min-h-0 w-full flex-col gap-6">
      <PillTabs
        items={items}
        value={activeView}
        onValueChange={(nextView) => {
          ticketsStore.setBoardSelected(nextView === 'tickets');
          if (nextView !== 'tickets') view.setProjectView(nextView);
        }}
        ariaLabel="Project sections"
        panelId={PROJECT_SECTION_PANEL_ID}
      />
      <section
        role="tabpanel"
        id={PROJECT_SECTION_PANEL_ID}
        aria-labelledby={getPillTabId(PROJECT_SECTION_PANEL_ID, activeView)}
        className={cn(
          'flex w-full flex-col px-1',
          activeView === 'workspaces' && 'min-h-[calc(100vh-16rem)]',
          (activeView === 'tasks' || activeView === 'pull-request' || activeView === 'tickets') &&
            'h-[calc(100vh-16rem)] min-h-96',
          // Settings scrolls internally with a pinned footer, so its floor must
          // fit the smallest supported window (500px − 16rem chrome = 244px);
          // a larger floor would nest the section scroll inside the page scroll
          // and strand the footer while the header and tabs scroll away.
          activeView === 'settings' && 'h-[calc(100vh-16rem)] min-h-60'
        )}
      >
        {activeView === 'tickets' && <TicketsBoard projectId={projectId} />}
        {activeView === 'tasks' && <TaskList />}
        {activeView === 'pull-request' && <PullRequestView />}
        {activeView === 'workspaces' && <ProjectWorkspacesView projectId={projectId} />}
        {activeView === 'settings' && (
          <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
            <SettingsPanel />
          </div>
        )}
      </section>
    </div>
  );
});
