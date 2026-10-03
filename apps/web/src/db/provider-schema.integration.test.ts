import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createPublicReadApi } from "../api/public/service";
import { createDb } from "./client";
import { loadDatabaseUrl } from "./env";
import { loadDotenvFiles } from "./load-dotenv";
import { bounties, repos, users } from "./schema";

loadDotenvFiles();

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), "../../drizzle");

type Journal = { entries: { tag: string }[] };

function pgCode(err: unknown): string {
  if (err && typeof err === "object" && "code" in err && typeof err.code === "string") return err.code;
  return "";
}

async function applyTags(sql: ReturnType<typeof createDb>["sql"], tags: string[]): Promise<void> {
  const journal = JSON.parse(readFileSync(join(migrationsFolder, "meta/_journal.json"), "utf8")) as Journal;
  const known = new Set(journal.entries.map((entry) => entry.tag));
  for (const tag of tags) {
    if (!known.has(tag)) throw new Error(`migration ${tag} was not in the journal`);
    const raw = readFileSync(join(migrationsFolder, `${tag}.sql`), "utf8");
    for (const part of raw.split("--> statement-breakpoint")) {
      const statement = part.trim();
      if (!statement) continue;
      await sql.unsafe(statement);
    }
  }
}

describe("0016_hf_provider on a seeded database", () => {
  it("keeps GitHub rows valid, defaults provider, and filters REST lists", async () => {
    const admin = createDb();
    const dbName = `gb_hf_${randomUUID().slice(0, 8)}`;
    const baseUrl = new URL(loadDatabaseUrl());
    baseUrl.pathname = `/${dbName}`;
    const url = baseUrl.toString();
    const suffix = randomUUID().slice(0, 8);
    const userId = randomUUID();
    const repoId = randomUUID();
    const bountyId = randomUUID();
    const hfBountyId = randomUUID();
    const deliveryId = `del-${suffix}`;

    try {
      await admin.sql.unsafe(`create database ${dbName}`);
      const seeded = createDb(url);
      try {
        const journal = JSON.parse(readFileSync(join(migrationsFolder, "meta/_journal.json"), "utf8")) as Journal;
        const afterProvider = new Set(["0016_hf_provider", "0018_hf_submission_author"]);
        const beforeHf = journal.entries.map((entry) => entry.tag).filter((tag) => !afterProvider.has(tag));
        await applyTags(seeded.sql, beforeHf);
        await seeded.sql`
          insert into users (id, google_sub, email, display_name)
          values (${userId}::uuid, ${`prov-${suffix}`}, ${`prov-${suffix}@example.com`}, 'Provider Seed')
        `;
        await seeded.sql`
          insert into repos (
            id, github_repo_id, full_name, installation_id, connection_kind, connected_by_user_id
          ) values (
            ${repoId}::uuid, ${9001}, ${`seed/repo-${suffix}`}, ${42}, 'app_install', ${userId}::uuid
          )
        `;
        await seeded.sql`
          insert into bounties (
            id, repo_id, github_issue_number, url, poster_user_id, amount_usdc, status, title
          ) values (
            ${bountyId}::uuid,
            ${repoId}::uuid,
            7,
            ${`https://github.com/seed/repo-${suffix}/issues/7`},
            ${userId}::uuid,
            '10.000000',
            'funded',
            'seeded github bounty'
          )
        `;
        await seeded.sql`
          insert into webhook_deliveries (delivery_id, event)
          values (${deliveryId}, 'pull_request')
        `;

        const before = await seeded.sql<{ github_repo_id: string; github_issue_number: number }[]>`
          select r.github_repo_id::text as github_repo_id, b.github_issue_number
          from bounties b
          join repos r on r.id = b.repo_id
          where b.id = ${bountyId}::uuid
        `;
        assert.equal(before[0]?.github_repo_id, "9001");
        assert.equal(before[0]?.github_issue_number, 7);

        await applyTags(seeded.sql, ["0016_hf_provider"]);

        const after = await seeded.sql<
          {
            bounty_provider: string;
            repo_provider: string;
            github_repo_id: string;
            webhook_provider: string;
            hf_links: number;
            submissions: number;
          }[]
        >`
          select
            b.provider as bounty_provider,
            r.provider as repo_provider,
            r.github_repo_id::text as github_repo_id,
            w.provider as webhook_provider,
            (select count(*)::int from hf_links) as hf_links,
            (select count(*)::int from bounty_submissions) as submissions
          from bounties b
          join repos r on r.id = b.repo_id
          join webhook_deliveries w on w.delivery_id = ${deliveryId}
          where b.id = ${bountyId}::uuid
        `;
        assert.equal(after[0]?.bounty_provider, "github");
        assert.equal(after[0]?.repo_provider, "github");
        assert.equal(after[0]?.github_repo_id, "9001");
        assert.equal(after[0]?.webhook_provider, "github");
        assert.equal(after[0]?.hf_links, 0);
        assert.equal(after[0]?.submissions, 0);

        const [inserted] = await seeded.db
          .insert(bounties)
          .values({
            repoId,
            githubIssueNumber: 8,
            url: `https://github.com/seed/repo-${suffix}/issues/8`,
            posterUserId: userId,
            amountUsdc: "3.000000",
            status: "pending_fund",
            title: "default provider",
          })
          .returning({ id: bounties.id, provider: bounties.provider });
        assert.equal(inserted?.provider, "github");

        await assert.rejects(
          () =>
            seeded.sql`
              insert into repos (full_name, connection_kind, connected_by_user_id, provider)
              values (${`seed/missing-${suffix}`}, 'public_reference', ${userId}::uuid, 'github')
            `,
          (err: unknown) => pgCode(err) === "23514",
        );

        const [hfRepo] = await seeded.db
          .insert(repos)
          .values({
            fullName: `hf/model-${suffix}`,
            connectionKind: "public_reference",
            connectedByUserId: userId,
            provider: "huggingface",
            providerRepoId: `hf-${suffix}`,
            hfRepoType: "model",
          })
          .returning({ id: repos.id, githubRepoId: repos.githubRepoId, provider: repos.provider });
        assert.equal(hfRepo?.provider, "huggingface");
        assert.equal(hfRepo?.githubRepoId, null);

        await seeded.sql`
          insert into bounties (
            id, repo_id, provider, github_issue_number, url, poster_user_id, amount_usdc, status, title
          ) values (
            ${hfBountyId}::uuid,
            ${hfRepo?.id}::uuid,
            'huggingface',
            3,
            ${`https://huggingface.co/hf/model-${suffix}/discussions/3`},
            ${userId}::uuid,
            '4.000000',
            'funded',
            'hf discussion'
          )
        `;

        await assert.rejects(
          () =>
            seeded.sql`
              insert into hf_links (user_id, hf_sub, hf_username)
              values (${userId}::uuid, ${`sub-${suffix}`}, 'hunter')
            `.then(() =>
              seeded.sql`
                insert into hf_links (user_id, hf_sub, hf_username)
                values (${userId}::uuid, ${`sub-${suffix}-2`}, 'other')
              `,
            ),
          (err: unknown) => pgCode(err) === "23505",
        );

        await seeded.sql`
          insert into bounty_submissions (bounty_id, user_id, provider, pr_number, pr_url, status)
          values (
            ${hfBountyId}::uuid,
            ${userId}::uuid,
            'huggingface',
            9,
            ${`https://huggingface.co/hf/model-${suffix}/discussions/9`},
            'submitted'
          )
        `;
        await assert.rejects(
          () =>
            seeded.sql`
              insert into bounty_submissions (bounty_id, user_id, provider, pr_number, pr_url)
              values (
                ${hfBountyId}::uuid,
                ${userId}::uuid,
                'huggingface',
                9,
                ${`https://huggingface.co/hf/model-${suffix}/discussions/9`}
              )
            `,
          (err: unknown) => pgCode(err) === "23505",
        );

        await applyTags(seeded.sql, ["0018_hf_submission_author"]);
        const authorColumn = await seeded.sql<{ column_name: string }[]>`
          select column_name
          from information_schema.columns
          where table_schema = 'public'
            and table_name = 'bounty_submissions'
            and column_name = 'hf_author'
        `;
        assert.equal(authorColumn[0]?.column_name, "hf_author");
        await assert.rejects(
          () =>
            seeded.sql`
              insert into bounty_submissions (bounty_id, user_id, provider, pr_number, pr_url, hf_author, status)
              values (
                ${hfBountyId}::uuid,
                ${userId}::uuid,
                'huggingface',
                10,
                ${`https://huggingface.co/hf/model-${suffix}/discussions/10`},
                'hunter',
                'submitted'
              )
            `,
          (err: unknown) => pgCode(err) === "23505",
        );

        const api = createPublicReadApi(seeded.db);
        const huggingface = await api.listBounties({
          provider: "huggingface",
          limit: 20,
          sort: "newest",
          cursorValue: null,
        });
        assert.deepEqual(
          huggingface.data.map((row) => row.id),
          [hfBountyId],
        );
        assert.equal(huggingface.data[0]?.provider, "huggingface");

        const github = await api.listBounties({
          provider: "github",
          limit: 20,
          sort: "newest",
          cursorValue: null,
        });
        assert.equal(github.data.every((row) => row.provider === "github"), true);
        assert.deepEqual(
          new Set(github.data.map((row) => row.id)),
          new Set([bountyId, inserted?.id]),
        );

        const detail = await api.getBounty(bountyId);
        assert.equal(detail.bounty.provider, "github");
      } finally {
        await seeded.sql.end({ timeout: 5 });
      }
    } finally {
      await admin.sql.unsafe(`drop database if exists ${dbName}`);
      await admin.sql.end({ timeout: 5 });
    }
  });

  it("applies the journal through 0018 on an empty database", async () => {
    const admin = createDb();
    const dbName = `gb_hf_up_${randomUUID().slice(0, 8)}`;
    const baseUrl = new URL(loadDatabaseUrl());
    baseUrl.pathname = `/${dbName}`;
    try {
      await admin.sql.unsafe(`create database ${dbName}`);
      const empty = createDb(baseUrl.toString());
      try {
        await migrate(empty.db, { migrationsFolder });
        const applied = await empty.sql<{ created_at: string }[]>`
          select created_at::text as created_at
          from drizzle.__drizzle_migrations
          order by created_at desc
          limit 1
        `;
        assert.equal(applied[0]?.created_at, "1791200000000");
        const columns = await empty.sql<{ column_name: string; column_default: string | null }[]>`
          select column_name, column_default
          from information_schema.columns
          where table_schema = 'public'
            and (
              (table_name = 'bounties' and column_name = 'provider')
              or (table_name = 'webhook_deliveries' and column_name = 'provider')
            )
        `;
        assert.equal(columns.length, 2);
        for (const column of columns) {
          assert.match(column.column_default ?? "", /github/);
        }
        const tables = await empty.sql<{ table_name: string }[]>`
          select table_name
          from information_schema.tables
          where table_schema = 'public'
            and table_name in ('hf_links', 'bounty_submissions')
        `;
        assert.deepEqual(tables.map((row) => row.table_name).sort(), ["bounty_submissions", "hf_links"]);
        const authorColumn = await empty.sql<{ column_name: string }[]>`
          select column_name
          from information_schema.columns
          where table_schema = 'public'
            and table_name = 'bounty_submissions'
            and column_name = 'hf_author'
        `;
        assert.equal(authorColumn[0]?.column_name, "hf_author");
        const contacts = await empty.sql<{ table_name: string }[]>`
          select table_name
          from information_schema.tables
          where table_schema = 'public' and table_name = 'marketing_contacts'
        `;
        assert.equal(contacts[0]?.table_name, "marketing_contacts");

        const suffix = randomUUID().slice(0, 8);
        const userId = randomUUID();
        await empty.db.insert(users).values({
          id: userId,
          googleSub: `up-${suffix}`,
          email: `up-${suffix}@example.com`,
          displayName: "Up",
        });
        const [repo] = await empty.db
          .insert(repos)
          .values({
            githubRepoId: BigInt(9100),
            fullName: `up/repo-${suffix}`,
            installationId: BigInt(7),
            connectedByUserId: userId,
          })
          .returning({ provider: repos.provider, githubRepoId: repos.githubRepoId });
        assert.equal(repo?.provider, "github");
        assert.equal(repo?.githubRepoId, BigInt(9100));
      } finally {
        await empty.sql.end({ timeout: 5 });
      }
    } finally {
      await admin.sql.unsafe(`drop database if exists ${dbName}`);
      await admin.sql.end({ timeout: 5 });
    }
  });
});
