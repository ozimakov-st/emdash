// Fork (ozimakov-st): renderer side of the "OZ Tickets" issue source. It is not an
// integration plugin (no account), so the issue pickers add it by hand; the task
// creation path calls `prepareOzTicketTask` before and `linkOzTicketTask` after.
import { toast } from '@emdash/ui/react/primitives';
import type { IntegrationProviderDescriptor } from '@core/features/integrations/api/contract';
import { refreshTaskTickets } from '@core/features/mcp/api/browser/ozdash-task-tickets';
import type { LinkedIssue } from '@core/primitives/linked-issues/api';
import { log } from '@core/primitives/logging/browser/logger';
import type { TaskConfig } from '@core/primitives/tasks/api';
import {
  appendTicketPromptBlock,
  buildTicketPromptBlock,
  OZ_TICKETS_NAME,
  OZ_TICKETS_PROVIDER,
  ticketRefFromLinkedIssue,
  type LinkTicketTaskInput,
} from '../ticket-issues';
import type { OzdashTicketsBridge } from '../tickets';

const TICKET_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M13 5v2"/><path d="M13 17v2"/><path d="M13 11v2"/></svg>';

/** How the issue pickers name and draw OZ Tickets. */
export const OZ_TICKETS_INTEGRATION: IntegrationProviderDescriptor = {
  id: OZ_TICKETS_PROVIDER,
  name: OZ_TICKETS_NAME,
  description: "Oleg's tickets from the work vault",
  websiteUrl: '',
  features: ['issues'],
  issueCapabilities: { requiresRepositoryUrl: false, supportsIssueContext: true },
  auth: { methods: [{ kind: 'cli-import', cli: 'none' }] },
  icon: { kind: 'svg', alt: OZ_TICKETS_NAME, variants: [{ minSize: 0, light: TICKET_ICON_SVG }] },
};

export function isOzTicketsProvider(provider: string | null | undefined): boolean {
  return provider === OZ_TICKETS_PROVIDER;
}

/** Issue provider ids with OZ Tickets added at the end. */
export function withOzTicketsProvider<T extends string>(providers: T[]): Array<T | 'oz-tickets'> {
  return providers.includes(OZ_TICKETS_PROVIDER as T)
    ? providers
    : [...providers, OZ_TICKETS_PROVIDER];
}

type InitialConversation = NonNullable<TaskConfig['initialConversation']>;

/**
 * Before creating a task: when it is based on an OZ ticket, appends the ticket block to
 * its first prompt. Returns the `link` input to send once the task exists.
 */
export function prepareOzTicketTask(input: {
  linkedIssue: LinkedIssue | undefined;
  conversation: InitialConversation | undefined;
  initialPromptSupported: boolean;
  taskId: string;
  taskName: string;
  projectId: string;
  prompt: string;
}): { conversation: InitialConversation | undefined; link: LinkTicketTaskInput | null } {
  const ticket = ticketRefFromLinkedIssue(input.linkedIssue);
  if (!ticket) return { conversation: input.conversation, link: null };
  return {
    conversation: input.conversation
      ? appendTicketPromptBlock(input.conversation, buildTicketPromptBlock(ticket), {
          initialPromptSupported: input.initialPromptSupported,
        })
      : undefined,
    link: {
      ticketId: ticket.id,
      taskId: input.taskId,
      taskName: input.taskName,
      projectId: input.projectId,
      prompt: input.prompt,
    },
  };
}

function bridge(): Partial<OzdashTicketsBridge> | undefined {
  return (globalThis as { ozdash?: Partial<OzdashTicketsBridge> }).ozdash;
}

/**
 * After the task exists: marks it with the ticket, records it in the ticket file and
 * tells the PM session (main process). Problems show as a toast; they never undo the task.
 */
export async function linkOzTicketTask(link: LinkTicketTaskInput | null): Promise<void> {
  const api = bridge()?.linkTicketTask;
  if (!link || !api) return;
  try {
    const result = await api(link);
    refreshTaskTickets();
    if (!result.success) {
      toast.error(`Ticket #${link.ticketId} was not linked`, { description: result.error });
    } else if (result.warnings.length > 0) {
      toast.warning(`Ticket #${link.ticketId} linked with problems`, {
        description: result.warnings.join(' '),
      });
    }
  } catch (error) {
    log.error('ozdash: linking the task to its ticket failed', error);
    toast.error(`Ticket #${link.ticketId} was not linked`, { description: String(error) });
  }
}
