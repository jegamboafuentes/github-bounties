import type { ReactNode } from "react";
import Link from "next/link";
import type { FundChainDisplayName } from "@/bounties/display";
import { FEE_BPS, POOL_BPS_OF_POST_FEE, POOL_MAX_PAID } from "@/lib/constants";
import { storyChainCaption, STORY_HEADING, STORY_LEDE, STORY_STEPS, type StoryStepId } from "@/home/story";

const feePct = FEE_BPS / 100;
const poolPct = POOL_BPS_OF_POST_FEE / 100;
const winnerPct = 100 - poolPct;

function FigureChrome({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col justify-center">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">{label}</p>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function StoryFigure({ id, chainName }: { id: StoryStepId; chainName: FundChainDisplayName }) {
  if (id === "paste") {
    return (
      <FigureChrome label="Issue URL">
        <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2 font-mono text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200">
          github.com/org/repo/issues/N
        </div>
        <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-300">
          One URL. The board and the bounty page both point at that issue.
        </p>
      </FigureChrome>
    );
  }

  if (id === "escrow") {
    return (
      <FigureChrome label="gb-escrow">
        <dl className="space-y-2 text-sm">
          <div className="flex items-center justify-between gap-3">
            <dt className="text-zinc-500">Face</dt>
            <dd className="font-medium">USDC locked</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-zinc-500">Fee</dt>
            <dd className="font-medium">{feePct}% at settlement</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-zinc-500">Refund</dt>
            <dd className="font-medium">Full face</dd>
          </div>
        </dl>
      </FigureChrome>
    );
  }

  if (id === "intelligence") {
    return (
      <FigureChrome label="AI estimate">
        <p className="text-sm text-zinc-600 dark:text-zinc-300">Repo about · language stack</p>
        <div className="mt-3 flex gap-2">
          {(["S", "M", "L"] as const).map((mark) => (
            <span
              key={mark}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 text-sm font-semibold dark:border-zinc-700"
            >
              {mark}
            </span>
          ))}
        </div>
        <p className="mt-3 text-xs text-zinc-500">Not a price. Not a payout.</p>
      </FigureChrome>
    );
  }

  if (id === "split") {
    return (
      <FigureChrome label="Of post-fee">
        <div className="flex h-3 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
          <div className="bg-emerald-500" style={{ width: `${winnerPct}%` }} />
          <div className="bg-cyan-400" style={{ width: `${poolPct}%` }} />
        </div>
        <p className="mt-3 text-sm text-zinc-700 dark:text-zinc-200">
          <span className="font-medium text-emerald-700 dark:text-emerald-400">{winnerPct}% winner</span>
          <span className="mx-1.5 text-zinc-400">·</span>
          <span className="font-medium text-cyan-700 dark:text-cyan-300">
            {poolPct}% pool
          </span>
        </p>
        <p className="mt-1 text-xs text-zinc-500">
          Equal split, up to {POOL_MAX_PAID} hunters. Empty pool: winner gets all of post-fee.
        </p>
      </FigureChrome>
    );
  }

  if (id === "merge") {
    return (
      <FigureChrome label="Merge is truth">
        <ol className="space-y-2 text-sm text-zinc-700 dark:text-zinc-200">
          <li>Merged pull request closes #N</li>
          <li>Winner claims their share</li>
          <li>Pool members claim their own</li>
        </ol>
        <p className="mt-3 text-xs text-zinc-500">Working on this is not a payout.</p>
      </FigureChrome>
    );
  }

  return (
    <FigureChrome label="Base">
      <p className="text-2xl font-semibold tracking-tight">USDC</p>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
        {storyChainCaption(chainName)}
      </p>
    </FigureChrome>
  );
}

export function HomeStory({ chainName }: { chainName: FundChainDisplayName }) {
  return (
    <section id="story" className="home-section-story flex flex-col gap-4" aria-labelledby="home-story-heading">
      <div className="home-section-heading home-reveal-item">
        <h2
          id="home-story-heading"
          className="text-sm font-semibold uppercase tracking-wide text-zinc-500"
        >
          {STORY_HEADING}
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-zinc-500">{STORY_LEDE}</p>
      </div>
      <div className="home-story-layout">
        <div className="home-story-stage" aria-hidden="true">
          <div className="home-story-stage-frame">
            {STORY_STEPS.map((step) => (
              <div key={step.id} className="home-story-panel" data-story-panel={step.id}>
                <StoryFigure id={step.id} chainName={chainName} />
              </div>
            ))}
          </div>
        </div>
        <div className="home-story-steps">
          <div className="home-story-rail" aria-hidden="true">
            <div className="home-story-rail-fill" />
          </div>
          <ol className="flex flex-col gap-3">
            {STORY_STEPS.map((step, index) => (
              <li
                key={step.id}
                className="home-story-step home-reveal-item"
                data-story-step={index}
              >
                <article className="home-story-card w-full rounded-xl border border-zinc-200 bg-white p-4 sm:p-5 dark:border-zinc-800 dark:bg-zinc-900">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700 dark:text-emerald-400">
                    {step.kicker}
                  </p>
                  <h3 className="mt-2 text-xl font-semibold tracking-tight">{step.title}</h3>
                  {step.detail ? (
                    <p className="mt-1 text-sm text-zinc-500">{step.detail}</p>
                  ) : null}
                  <p className="mt-3 text-sm leading-6 text-zinc-600 dark:text-zinc-400">{step.body}</p>
                  {step.id === "paste" ? (
                    <p className="mt-3">
                      <Link
                        href="/bounties/new"
                        className="text-sm font-medium text-zinc-900 underline underline-offset-4 dark:text-zinc-100"
                      >
                        Post a bounty
                      </Link>
                    </p>
                  ) : null}
                  <div
                    className="home-story-inline mt-4 rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950"
                    aria-hidden="true"
                  >
                    <StoryFigure id={step.id} chainName={chainName} />
                  </div>
                </article>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
