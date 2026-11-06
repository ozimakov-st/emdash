// Fork (ozimakov-st): "OZ Tickets", an issue provider that reads Oleg's vault tickets
// (no account needed). List = open tickets; search also finds archived ones.
import { err, ok, type Result } from '@emdash/shared';
import type { IssueProvider } from '@core/features/issues/api/node/issue-provider';
import type {
  IssueListError,
  IssueListResult,
  IssueQueryOpts,
} from '@core/primitives/issue-providers/api';
import { readTickets } from '../../node/tickets-service';
import {
  compareTicketsForIssues,
  OZ_TICKETS_NAME,
  OZ_TICKETS_PROVIDER,
  ticketIdFromIdentifier,
  ticketToLinkedIssue,
} from '../ticket-issues';
import { isArchived, ticketMatchesQuery, type TicketList } from '../tickets';

const DEFAULT_LIST_LIMIT = 50;
const DEFAULT_SEARCH_LIMIT = 20;
const MAX_LIMIT = 500;

function clampLimit(limit: number | undefined, fallback: number): number {
  const value = Number.isFinite(limit) ? (limit as number) : fallback;
  return Math.max(1, Math.min(value, MAX_LIMIT));
}

export type OzTicketsIssueProviderOptions = {
  vaultPath: string;
  /** Reads the vault; injected in tests. */
  read?: (vaultPath: string) => Promise<TicketList>;
};

export function createOzTicketsIssueProvider(
  options: OzTicketsIssueProviderOptions
): IssueProvider {
  const { vaultPath } = options;
  const read = options.read ?? readTickets;

  async function load(): Promise<Result<TicketList, IssueListError>> {
    try {
      const list = await read(vaultPath);
      if (list.error) return err({ type: 'generic', message: list.error });
      return ok(list);
    } catch (error) {
      return err({ type: 'generic', message: `Could not read the vault: ${String(error)}` });
    }
  }

  async function query(opts: IssueQueryOpts, searchTerm: string | null): Promise<IssueListResult> {
    const loaded = await load();
    if (!loaded.success) return loaded;
    const list = loaded.data;
    const matches =
      searchTerm === null
        ? list.tickets.filter((ticket) => !isArchived(ticket))
        : list.tickets.filter((ticket) => ticketMatchesQuery(ticket, searchTerm));
    const limit = clampLimit(
      opts.limit,
      searchTerm === null ? DEFAULT_LIST_LIMIT : DEFAULT_SEARCH_LIMIT
    );
    const fetchedAt = new Date().toISOString();
    return ok(
      [...matches]
        .sort(compareTicketsForIssues)
        .slice(0, limit)
        .map((ticket) => ticketToLinkedIssue(ticket, list.vaultPath, fetchedAt))
    );
  }

  return {
    type: OZ_TICKETS_PROVIDER,
    capabilities: { requiresRepositoryUrl: false, supportsIssueContext: true },

    async checkConnection() {
      return {
        connected: true,
        displayName: OZ_TICKETS_NAME,
        displayDetail: vaultPath,
        capabilities: { requiresRepositoryUrl: false, supportsIssueContext: true },
      };
    },

    listIssues: (opts) => query(opts, null),

    searchIssues(opts) {
      const term = String(opts.searchTerm || '').trim();
      return term ? query(opts, term) : Promise.resolve(ok([]));
    },

    async getIssueContext(opts) {
      const loaded = await load();
      if (!loaded.success) return loaded;
      const id = ticketIdFromIdentifier(opts.identifier);
      const ticket = loaded.data.tickets.find((candidate) => candidate.id === id);
      if (!ticket) {
        return err({
          type: 'not_found_or_no_access',
          message: `Ticket #${id} is not in the vault`,
        });
      }
      return ok(ticketToLinkedIssue(ticket, loaded.data.vaultPath));
    },
  };
}
