import { getBoardBounty, listBoardBountiesPage, readStoredIssueBody } from "../../bounties";
import type { Database } from "../../db/client";
import { getRuntimeDb } from "../../db/runtime";
import { getEscrowSnapshot, listBountyContributions } from "../../escrow";
import { isUndefinedTableError } from "../../intelligence/errors";
import { readCachedBountyIntelligence } from "../../intelligence/load";
import { getPoolRoster } from "../../bounties/roster";
import { getPlatformStats } from "../../stats";
import { PublicApiError } from "./errors";
import { confirmedTotalFor, loadConfirmedFundedTotals } from "./funded";
import {
  presentBountyDetail,
  presentCachedIntelligence,
  presentFunderList,
  presentPublicBounty,
} from "./present";
import { cursorFromPageItem, keysetFromCursor, type BoardCursor } from "./query";
import type { ListBountiesInput } from "./schemas";

export type ListBountiesQuery = ListBountiesInput & { cursorValue: BoardCursor | null };

async function requireBounty(id: string, db: Database) {
  const bounty = await getBoardBounty(id, db);
  if (!bounty) {
    throw new PublicApiError("not_found", "Bounty not found.", null);
  }
  return bounty;
}

export function createPublicReadApi(db?: Database) {
  const resolve = () => db ?? getRuntimeDb();

  return {
    async listBounties(input: ListBountiesQuery) {
      const page = await listBoardBountiesPage(
        resolve(),
        {
          repo: input.repo,
          status: input.status,
          complexity: input.complexity,
          language: input.language,
        },
        {
          limit: input.limit,
          sort: input.sort,
          cursor: input.cursorValue ? keysetFromCursor(input.cursorValue) : null,
          hasIntel: input.has_intel,
        },
      );
      const totals = await loadConfirmedFundedTotals(
        resolve(),
        page.bounties.map((bounty) => bounty.id),
      );
      const data = page.bounties.map((bounty) =>
        presentPublicBounty(bounty, confirmedTotalFor(totals, bounty.id)),
      );
      const last = data[data.length - 1];
      return {
        data,
        page: {
          limit: input.limit,
          sort: input.sort,
          nextCursor: page.hasMore && last ? cursorFromPageItem(last, input.sort) : null,
        },
      };
    },

    async getBounty(id: string) {
      const database = resolve();
      const bounty = await requireBounty(id, database);
      const [escrow, roster, issue, totals] = await Promise.all([
        getEscrowSnapshot(id, database),
        getPoolRoster(id, database),
        readStoredIssueBody(id, database),
        loadConfirmedFundedTotals(database, [id]),
      ]);
      if (!roster) {
        throw new PublicApiError("not_found", "Bounty not found.", null);
      }
      return presentBountyDetail({
        bounty,
        totalFundedUsdc: confirmedTotalFor(totals, id),
        issueBody: issue?.markdown ?? null,
        roster,
        escrow,
      });
    },

    async listFunders(id: string) {
      const database = resolve();
      await requireBounty(id, database);
      try {
        const rows = await listBountyContributions(id, database);
        return presentFunderList(id, rows);
      } catch (err) {
        if (!isUndefinedTableError(err)) throw err;
        return { bountyId: id, data: [] };
      }
    },

    async getIntelligence(id: string) {
      const database = resolve();
      await requireBounty(id, database);
      const intel = await readCachedBountyIntelligence({ bountyId: id, db: database });
      return presentCachedIntelligence(id, intel);
    },

    async getStats() {
      return getPlatformStats(resolve());
    },
  };
}

export type PublicReadApi = ReturnType<typeof createPublicReadApi>;

export const publicReadApi = createPublicReadApi();
