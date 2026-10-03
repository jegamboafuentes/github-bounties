import { requireAdminPageUser } from "@/admin/gate";
import {
  adminContactsOutOfRange,
  CONTACT_LIST_MAX_OFFSET,
  countMarketingContacts,
  listMarketingContacts,
  parseContactListQuery,
} from "@/contacts/query";
import { PublicApiError } from "@/api/public/errors";
import { MARKETING_CONTACT_SOURCES } from "@/db/schema";
import { getRuntimeDb } from "@/db/runtime";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

function hrefFor(input: {
  search: string;
  source: string;
  subscribed: string;
  utmCampaign: string;
  page?: number;
  exportCsv?: boolean;
}): string {
  const params = new URLSearchParams();
  if (input.search) params.set("q", input.search);
  if (input.source) params.set("source", input.source);
  if (input.subscribed) params.set("subscribed", input.subscribed);
  if (input.utmCampaign) params.set("utm_campaign", input.utmCampaign);
  if (input.page && input.page > 1) params.set("page", String(input.page));
  const query = params.toString();
  const path = input.exportCsv ? "/admin/contacts/export" : "/admin/contacts";
  return query ? `${path}?${query}` : path;
}

export default async function AdminContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; source?: string; subscribed?: string; utm_campaign?: string; page?: string }>;
}) {
  const admin = await requireAdminPageUser();
  const raw = await searchParams;
  const search = raw.q?.trim() ?? "";
  const source = raw.source?.trim() ?? "";
  const subscribed = raw.subscribed?.trim() ?? "";
  const utmCampaign = raw.utm_campaign?.trim() ?? "";
  const page = Math.max(1, Number.parseInt(raw.page ?? "1", 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;
  let error: string | null = null;
  let listed = { contacts: [] as Awaited<ReturnType<typeof listMarketingContacts>>["contacts"], total: 0 };
  const db = getRuntimeDb();
  const metrics = await countMarketingContacts(db);
  let outOfRange = offset > CONTACT_LIST_MAX_OFFSET;
  if (!outOfRange) {
    try {
      const query = parseContactListQuery({
        search,
        source,
        subscribed,
        utmCampaign,
        limit: PAGE_SIZE,
        offset,
      });
      listed = await listMarketingContacts(db, query);
      outOfRange = adminContactsOutOfRange(page, offset, listed.contacts.length);
    } catch (err) {
      if (err instanceof PublicApiError) error = err.message;
      else throw err;
    }
  }
  const pageCount = Math.max(1, Math.ceil(listed.total / PAGE_SIZE));
  const filters = { search, source, subscribed, utmCampaign };

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-10">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">Admin</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Contacts</h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{admin.email}</p>
        </div>
        <div className="flex gap-4 text-sm">
          <a className="underline" href="/admin">
            Dashboard
          </a>
          <a className="underline" href={hrefFor({ ...filters, exportCsv: true })}>
            Export CSV
          </a>
        </div>
      </header>

      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        {(
          [
            ["Total", metrics.total],
            ["Subscribed", metrics.subscribed],
            ["Unsubscribed", metrics.unsubscribed],
            ["GHB", metrics.bySource.ghb],
            ["LB1", metrics.bySource.lb1],
            ["Both", metrics.bySource.both],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
            <dt className="text-xs uppercase tracking-wide text-zinc-500">{label}</dt>
            <dd className="mt-1 font-mono text-lg">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="grid gap-4 sm:grid-cols-2">
        <section className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="text-xs uppercase tracking-wide text-zinc-500">By campaign</h2>
          {metrics.byCampaign.length === 0 ? (
            <p className="mt-2 text-sm text-zinc-500">No campaign tags yet.</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-1 text-sm">
              {metrics.byCampaign.map((row) => (
                <li key={row.value} className="flex items-center justify-between gap-3">
                  <a className="font-mono underline" href={hrefFor({ ...filters, utmCampaign: row.value })}>
                    {row.value}
                  </a>
                  <span className="font-mono">{row.total}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="text-xs uppercase tracking-wide text-zinc-500">By content</h2>
          {metrics.byContent.length === 0 ? (
            <p className="mt-2 text-sm text-zinc-500">No content tags yet.</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-1 text-sm">
              {metrics.byContent.map((row) => (
                <li key={row.value} className="flex items-center justify-between gap-3">
                  <span className="font-mono">{row.value}</span>
                  <span className="font-mono">{row.total}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <form className="flex flex-wrap items-end gap-2" method="get" action="/admin/contacts">
        <label className="flex flex-col gap-1 text-sm">
          Search
          <input
            className="rounded-md border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
            name="q"
            defaultValue={search}
            placeholder="Email, name, or GitHub username"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Source
          <select
            className="rounded-md border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
            name="source"
            defaultValue={source}
          >
            <option value="">Any</option>
            {MARKETING_CONTACT_SOURCES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Campaign
          <input
            className="rounded-md border border-zinc-300 bg-white px-3 py-2 font-mono dark:border-zinc-700 dark:bg-zinc-950"
            name="utm_campaign"
            defaultValue={utmCampaign}
            placeholder="utm_campaign"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Subscribed
          <select
            className="rounded-md border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
            name="subscribed"
            defaultValue={subscribed}
          >
            <option value="">Any</option>
            <option value="true">Subscribed</option>
            <option value="false">Unsubscribed</option>
          </select>
        </label>
        <button className="rounded-md bg-zinc-900 px-3 py-2 text-sm text-white dark:bg-zinc-100 dark:text-zinc-900" type="submit">
          Filter
        </button>
      </form>

      {error && !outOfRange ? <p className="text-sm text-red-700 dark:text-red-300">{error}</p> : null}

      <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <table className="min-w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">GitHub</th>
              <th className="px-3 py-2">Source</th>
              <th className="px-3 py-2">Campaign</th>
              <th className="px-3 py-2">Subscribed</th>
              <th className="px-3 py-2">Created at</th>
              <th className="px-3 py-2">Linked user</th>
            </tr>
          </thead>
          <tbody>
            {outOfRange ? (
              <tr>
                <td className="px-3 py-4 text-zinc-500" colSpan={8}>
                  No results on this page.{" "}
                  <a className="underline" href={hrefFor(filters)}>
                    Back to page 1
                  </a>
                </td>
              </tr>
            ) : listed.contacts.length === 0 ? (
              <tr>
                <td className="px-3 py-4 text-zinc-500" colSpan={8}>
                  No contacts match.
                </td>
              </tr>
            ) : (
              listed.contacts.map((row) => (
                <tr key={row.id} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="px-3 py-2 font-mono">{row.email}</td>
                  <td className="px-3 py-2">{[row.firstName, row.lastName].filter(Boolean).join(" ") || "—"}</td>
                  <td className="px-3 py-2 font-mono">{row.githubUsername ?? "—"}</td>
                  <td className="px-3 py-2">{row.source}</td>
                  <td className="px-3 py-2 font-mono">{row.utmCampaign ?? "—"}</td>
                  <td className="px-3 py-2">{row.subscribed ? "yes" : "no"}</td>
                  <td className="px-3 py-2 font-mono">{row.createdAt.slice(0, 16).replace("T", " ")} UTC</td>
                  <td className="px-3 py-2 font-mono">{row.userId ?? "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="flex items-center justify-between text-sm text-zinc-600 dark:text-zinc-400">
        <span>
          {outOfRange
            ? "No results on this page."
            : `${listed.total} matching · page ${Math.min(page, pageCount)} of ${pageCount}`}
        </span>
        <span className="flex gap-3">
          {outOfRange ? (
            <a className="underline" href={hrefFor(filters)}>
              Back to page 1
            </a>
          ) : (
            <>
              {page > 1 ? (
                <a className="underline" href={hrefFor({ ...filters, page: page - 1 })}>
                  Previous
                </a>
              ) : null}
              {page < pageCount ? (
                <a className="underline" href={hrefFor({ ...filters, page: page + 1 })}>
                  Next
                </a>
              ) : null}
            </>
          )}
        </span>
      </p>
    </main>
  );
}
