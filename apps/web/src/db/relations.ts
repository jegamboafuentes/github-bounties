import { relations } from "drizzle-orm";
import {
  bounties,
  claimLocks,
  claims,
  escrows,
  feeLedger,
  githubLinks,
  repos,
  users,
} from "./schema";

export const usersRelations = relations(users, ({ one, many }) => ({
  githubLink: one(githubLinks),
  connectedRepos: many(repos),
  postedBounties: many(bounties),
  claimLocks: many(claimLocks),
  claims: many(claims),
}));

export const githubLinksRelations = relations(githubLinks, ({ one }) => ({
  user: one(users, {
    fields: [githubLinks.userId],
    references: [users.id],
  }),
}));

export const reposRelations = relations(repos, ({ one, many }) => ({
  connectedBy: one(users, {
    fields: [repos.connectedByUserId],
    references: [users.id],
  }),
  bounties: many(bounties),
}));

export const bountiesRelations = relations(bounties, ({ one, many }) => ({
  repo: one(repos, {
    fields: [bounties.repoId],
    references: [repos.id],
  }),
  poster: one(users, {
    fields: [bounties.posterUserId],
    references: [users.id],
  }),
  escrow: one(escrows),
  feeLedger: one(feeLedger),
  claimLocks: many(claimLocks),
  claims: many(claims),
}));

export const claimLocksRelations = relations(claimLocks, ({ one }) => ({
  bounty: one(bounties, {
    fields: [claimLocks.bountyId],
    references: [bounties.id],
  }),
  hunter: one(users, {
    fields: [claimLocks.hunterUserId],
    references: [users.id],
  }),
}));

export const escrowsRelations = relations(escrows, ({ one }) => ({
  bounty: one(bounties, {
    fields: [escrows.bountyId],
    references: [bounties.id],
  }),
}));

export const claimsRelations = relations(claims, ({ one }) => ({
  bounty: one(bounties, {
    fields: [claims.bountyId],
    references: [bounties.id],
  }),
  hunter: one(users, {
    fields: [claims.hunterUserId],
    references: [users.id],
  }),
}));

export const feeLedgerRelations = relations(feeLedger, ({ one }) => ({
  bounty: one(bounties, {
    fields: [feeLedger.bountyId],
    references: [bounties.id],
  }),
}));
