import type { ApiKeyEnv, ApiKeyScope, ApiSpendKind, ApiSpendStatus } from "../../db/schema";
import type { MoneyAction } from "../../escrow/actor-log";
import type { FacilitatorSettlementCheck } from "../../escrow/fund-hash";
import type { X402SellerResult } from "../../escrow/x402-seller";
import type { IdempotencyRow } from "./policy";

export type ApiKeyRecord = {
  id: string;
  userId: string;
  name: string;
  env: ApiKeyEnv;
  prefix: string;
  keyHash: string;
  scopes: ApiKeyScope[];
  perTxCapUsdc: string;
  dailyCapUsdc: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  lastUsedIp: string | null;
  revokedAt: Date | null;
  expiresAt: Date | null;
};

export type PublicApiKey = Omit<ApiKeyRecord, "keyHash">;

export type RequestLogRow = {
  id: string;
  keyId: string;
  userId: string;
  route: string;
  status: number;
  bountyId: string | null;
  ip: string | null;
  createdAt: Date;
};

export type SpendRow = {
  id: string;
  keyId: string;
  bountyId: string;
  kind: ApiSpendKind;
  amountUsdc: string;
  txHash: string | null;
  status: ApiSpendStatus;
  createdAt: Date;
};

export type MeProfile = {
  id: string;
  displayName: string;
  email: string;
  walletAddress: string | null;
  githubLogin: string | null;
};

export type MyBountyRow = {
  id: string;
  title: string;
  status: string;
  amountUsdc: string;
  issueUrl: string;
  createdAt: Date;
  fundedAt: Date | null;
};

export type MyFundingRow = {
  bountyId: string;
  title: string;
  status: string;
  amountUsdc: string;
  contributionUsdc: string;
  txHash: string;
  createdAt: Date;
};

export type MoneyBounty = {
  id: string;
  posterUserId: string;
  status: string;
  amountUsdc: string;
  title: string;
  issueUrl: string;
};

export type MoneyGate = { wallet: boolean; github: boolean };

export type AccessDeps = {
  env: NodeJS.ProcessEnv;
  now: () => Date;
  findKeyByHash: (keyHash: string) => Promise<ApiKeyRecord | null>;
  insertKey: (row: ApiKeyRecord) => Promise<void>;
  listKeys: (userId: string) => Promise<ApiKeyRecord[]>;
  revokeKey: (userId: string, keyId: string, at: Date) => Promise<boolean>;
  touchKey: (keyId: string, at: Date, ip: string) => Promise<void>;
  insertRequest: (row: Omit<RequestLogRow, "id"> & { id?: string }) => Promise<string>;
  updateRequestStatus: (id: string, status: number) => Promise<void>;
  countRequests: (keyId: string, routePrefix: string, since: Date) => Promise<number>;
  sumOpenSpend: (keyId: string, since: Date) => Promise<string>;
  /** Newest reserved or recorded rows for this key only. Capped at 50. */
  listRecentSpend: (keyId: string, limit: number) => Promise<SpendRow[]>;
  insertSpend: (row: Omit<SpendRow, "id"> & { id?: string }) => Promise<string>;
  updateSpend: (id: string, patch: { status: ApiSpendStatus; txHash?: string | null }) => Promise<void>;
  findIdempotency: (keyId: string, idempotencyKey: string) => Promise<IdempotencyRow | null>;
  saveIdempotency: (row: IdempotencyRow) => Promise<void>;
  moneyGate: (userId: string) => Promise<MoneyGate>;
  loadMe: (userId: string) => Promise<MeProfile | null>;
  listMyBounties: (userId: string) => Promise<{ posted: MyBountyRow[]; funded: MyFundingRow[] }>;
  loadMoneyBounty: (bountyId: string) => Promise<MoneyBounty | null>;
  assertTopUpOpen: (bountyId: string) => Promise<void>;
  escrowPayTo: () => Promise<{ payTo: string; network: string; mode: string }>;
  liveSeller: (input: {
    bountyId: string;
    amountUsdc: string;
    payTo: string;
    network: string;
    paymentSignature: string;
    resourceUrl: string;
    description: string;
    actorUserId: string;
    moneyAction: Extract<MoneyAction, "lock" | "top_up">;
  }) => Promise<X402SellerResult>;
  recordInbound: (input: {
    bountyId: string;
    txHash: string;
    payer: string | null;
    payTo: string;
    resourceUrl: string;
  }) => Promise<void>;
  lockFunds: (input: {
    bountyId: string;
    actorUserId: string;
    fundTxHash: string;
    requestId: string;
  }) => Promise<{ fundTxHash: string; status: string }>;
  topUp: (input: {
    bountyId: string;
    actorUserId: string;
    amountUsdc: string;
    fundTxHash: string;
    payer: string | null;
    requestId: string;
    facilitatorSettlement?: FacilitatorSettlementCheck;
  }) => Promise<{ fundTxHash: string; faceUsdc: string; amountUsdc: string }>;
  createBounty: (input: {
    posterUserId: string;
    issueUrl: string;
    amountUsdc: string;
  }) => Promise<{ id: string; status: "pending_fund"; title: string; amountUsdc: string; url: string }>;
  signalWorking: (bountyId: string, userId: string) => Promise<{ id: string; bountyId: string; signaledAt: Date }>;
  clearSignal: (bountyId: string, userId: string) => Promise<{ cleared: number }>;
  cancelUnfunded: (bountyId: string, actorUserId: string, requestId: string) => Promise<{
    status: string;
    refundTxHash: string | null;
  }>;
};
