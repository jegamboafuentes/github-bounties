import { getBoardBounty, listBoardBountiesPage, readStoredIssueBody } from "../../bounties";
import type { Database } from "../../db/client";
import { getRuntimeDb } from "../../db/runtime";
import { getEscrowSnapshot, listBountyContributions } from "../../escrow";
import { isUndefinedTableError } from "../../intelligence/errors";
import { readCachedBountyIntelligence } from "../../intelligence/load";
import { getPoolRoster } from "../../bounties/roster";
import { getPlatformStats } from "../../stats";
import { PublicApiError } from "./errors";
import {
  presentBountyDetail,
  presentCachedIntelligence,
  presentFunderContribution,
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
      const data = page.bounties.map(presentPublicBounty);
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
      const [escrow, roster, issue] = await Promise.all([
        getEscrowSnapshot(id, database),
        getPoolRoster(id, database),
        readStoredIssueBody(id, database),
      ]);
      if (!roster) {
        throw new PublicApiError("not_found", "Bounty not found.", null);
      }
      return presentBountyDetail({
        bounty,
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
        return {
          bountyId: id,
          data: rows.map(presentFunderContribution),
        };
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
