import { relations } from "drizzle-orm";
import {
  allocationLedger,
  apiIdempotencyKeys,
  apiKeys,
  apiRequestLog,
  apiSpendLedger,
  bounties,
  bountyContributions,
  bountyIntelligence,
  claimLocks,
  claims,
  escrows,
  feeLedger,
  emailOutbox,
  githubLinks,
  poolParticipants,
  repos,
  users,
  workSignals,
} from "./schema";

export const usersRelations = relations(users, ({ one, many }) => ({
  githubLink: one(githubLinks),
  connectedRepos: many(repos),
  postedBounties: many(bounties),
  claimLocks: many(claimLocks),
  claims: many(claims),
  poolParticipants: many(poolParticipants),
  workSignals: many(workSignals),
  emailOutbox: many(emailOutbox),
  bountyContributions: many(bountyContributions),
  apiKeys: many(apiKeys),
}));

export const emailOutboxRelations = relations(emailOutbox, ({ one }) => ({
  user: one(users, {
    fields: [emailOutbox.userId],
    references: [users.id],
  }),
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
  poolParticipants: many(poolParticipants),
  allocationLedger: many(allocationLedger),
  workSignals: many(workSignals),
  intelligence: one(bountyIntelligence),
  contributions: many(bountyContributions),
  apiSpends: many(apiSpendLedger),
}));

export const apiKeysRelations = relations(apiKeys, ({ one, many }) => ({
  user: one(users, { fields: [apiKeys.userId], references: [users.id] }),
  requests: many(apiRequestLog),
  spends: many(apiSpendLedger),
  idempotencyKeys: many(apiIdempotencyKeys),
}));

export const apiRequestLogRelations = relations(apiRequestLog, ({ one }) => ({
  key: one(apiKeys, { fields: [apiRequestLog.keyId], references: [apiKeys.id] }),
  user: one(users, { fields: [apiRequestLog.userId], references: [users.id] }),
}));

export const apiSpendLedgerRelations = relations(apiSpendLedger, ({ one }) => ({
  key: one(apiKeys, { fields: [apiSpendLedger.keyId], references: [apiKeys.id] }),
  bounty: one(bounties, { fields: [apiSpendLedger.bountyId], references: [bounties.id] }),
}));

export const apiIdempotencyKeysRelations = relations(apiIdempotencyKeys, ({ one }) => ({
  key: one(apiKeys, { fields: [apiIdempotencyKeys.keyId], references: [apiKeys.id] }),
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

export const poolParticipantsRelations = relations(
  poolParticipants,
  ({ one, many }) => ({
    bounty: one(bounties, {
      fields: [poolParticipants.bountyId],
      references: [bounties.id],
    }),
    user: one(users, {
      fields: [poolParticipants.userId],
      references: [users.id],
    }),
    allocations: many(allocationLedger),
  }),
);

export const allocationLedgerRelations = relations(allocationLedger, ({ one }) => ({
  bounty: one(bounties, {
    fields: [allocationLedger.bountyId],
    references: [bounties.id],
  }),
  participant: one(poolParticipants, {
    fields: [allocationLedger.participantId],
    references: [poolParticipants.id],
  }),
}));

export const workSignalsRelations = relations(workSignals, ({ one }) => ({
  bounty: one(bounties, {
    fields: [workSignals.bountyId],
    references: [bounties.id],
  }),
  user: one(users, {
    fields: [workSignals.userId],
    references: [users.id],
  }),
}));

export const bountyContributionsRelations = relations(bountyContributions, ({ one }) => ({
  bounty: one(bounties, {
    fields: [bountyContributions.bountyId],
    references: [bounties.id],
  }),
  funder: one(users, {
    fields: [bountyContributions.funderUserId],
    references: [users.id],
  }),
}));

export const bountyIntelligenceRelations = relations(bountyIntelligence, ({ one }) => ({
  bounty: one(bounties, {
    fields: [bountyIntelligence.bountyId],
    references: [bounties.id],
  }),
}));
