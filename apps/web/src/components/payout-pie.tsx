import { formatUsdc } from "@/bounties/display";
import {
  describePayoutPie,
  pieSliceArcs,
  type PayoutPie,
  type PayoutPieKey,
} from "@/bounties/payout-pie";

const CX = 16;
const CY = 16;
const R = 15;

const SLICE_VISUAL: Record<
  PayoutPieKey,
  {
    fillClass: string;
    swatchClass: string;
    pattern: "solid" | "hatch" | "dots";
    patternName: string;
  }
> = {
  fee: {
    fillClass: "fill-zinc-500 dark:fill-zinc-400",
    swatchClass: "bg-zinc-500 dark:bg-zinc-400",
    pattern: "hatch",
    patternName: "hatched",
  },
  winner: {
    fillClass: "fill-emerald-700 dark:fill-emerald-400",
    swatchClass: "bg-emerald-700 dark:bg-emerald-400",
    pattern: "solid",
    patternName: "solid",
  },
  pool: {
    fillClass: "fill-cyan-800 dark:fill-cyan-300",
    swatchClass: "bg-cyan-800 dark:bg-cyan-300",
    pattern: "dots",
    patternName: "dotted",
  },
};

function polar(angleDeg: number): { x: number; y: number } {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: CX + R * Math.cos(rad), y: CY + R * Math.sin(rad) };
}

function slicePath(startDeg: number, sweepDeg: number): string {
  if (sweepDeg >= 359.999) {
    return `M ${CX} ${CY - R} A ${R} ${R} 0 1 1 ${CX} ${CY + R} A ${R} ${R} 0 1 1 ${CX} ${CY - R} Z`;
  }
  const start = polar(startDeg);
  const end = polar(startDeg + sweepDeg);
  const large = sweepDeg > 180 ? 1 : 0;
  return `M ${CX} ${CY} L ${start.x} ${start.y} A ${R} ${R} 0 ${large} 1 ${end.x} ${end.y} Z`;
}

function PatternDefs({ prefix }: { prefix: string }) {
  return (
    <defs>
      <pattern
        id={`${prefix}-hatch`}
        width="3"
        height="3"
        patternUnits="userSpaceOnUse"
        patternTransform="rotate(45)"
      >
        <rect width="3" height="3" className="fill-zinc-500 dark:fill-zinc-400" />
        <path
          d="M0 0 H3"
          className="stroke-white dark:stroke-zinc-950"
          strokeWidth="1.1"
        />
      </pattern>
      <pattern id={`${prefix}-dots`} width="3" height="3" patternUnits="userSpaceOnUse">
        <rect width="3" height="3" className="fill-cyan-800 dark:fill-cyan-300" />
        <circle cx="1.2" cy="1.2" r="0.55" className="fill-white dark:fill-zinc-950" />
      </pattern>
    </defs>
  );
}

function sliceFill(prefix: string, key: PayoutPieKey): string | undefined {
  const visual = SLICE_VISUAL[key];
  if (visual.pattern === "hatch") return `url(#${prefix}-hatch)`;
  if (visual.pattern === "dots") return `url(#${prefix}-dots)`;
  return undefined;
}

export function TinyPayoutPie({ pie }: { pie: PayoutPie }) {
  const arcs = pieSliceArcs(pie);
  const titleId = `payout-pie-${pie.id}-title`;
  const prefix = `payout-pie-${pie.id}`;

  return (
    <figure className="flex items-center gap-2">
      <svg
        width="40"
        height="40"
        viewBox="0 0 32 32"
        role="img"
        aria-labelledby={titleId}
        className="shrink-0"
      >
        <title id={titleId}>{describePayoutPie(pie)}</title>
        <PatternDefs prefix={prefix} />
        {arcs.map((arc) => {
          const patternFill = sliceFill(prefix, arc.key);
          return (
            <path
              key={arc.key}
              d={slicePath(arc.startDeg, arc.sweepDeg)}
              className={`${patternFill ? "" : SLICE_VISUAL[arc.key].fillClass} stroke-white dark:stroke-zinc-900`}
              fill={patternFill}
              strokeWidth="0.7"
            />
          );
        })}
      </svg>
      <figcaption className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
          {pie.caption}
        </p>
        <ul className="mt-0.5 space-y-0.5 text-[11px] leading-4 text-zinc-600 dark:text-zinc-400">
          {pie.slices.map((slice) => (
            <li key={slice.key} className="flex items-center gap-1.5">
              <span
                aria-hidden
                className={`inline-block h-2 w-2 shrink-0 rounded-[2px] ring-1 ring-zinc-300 dark:ring-zinc-600 ${SLICE_VISUAL[slice.key].swatchClass} ${
                  slice.key === "fee"
                    ? "bg-[repeating-linear-gradient(45deg,transparent,transparent_1px,rgb(255_255_255/0.85)_1px,rgb(255_255_255/0.85)_2px)] dark:bg-[repeating-linear-gradient(45deg,transparent,transparent_1px,rgb(9_9_11/0.85)_1px,rgb(9_9_11/0.85)_2px)]"
                    : slice.key === "pool"
                      ? "bg-[radial-gradient(circle_at_30%_30%,rgb(255_255_255/0.9)_0.6px,transparent_0.7px)] dark:bg-[radial-gradient(circle_at_30%_30%,rgb(9_9_11/0.9)_0.6px,transparent_0.7px)]"
                      : ""
                }`}
              />
              <span>
                {slice.label}
                <span className="sr-only">
                  {`, ${SLICE_VISUAL[slice.key].patternName}`}
                </span>
                <span className="text-zinc-500"> · {formatUsdc(slice.amountUsdc)}</span>
              </span>
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  );
}

export function PayoutPieCharts({
  face,
  postFee,
}: {
  face: PayoutPie;
  postFee: PayoutPie;
}) {
  return (
    <div
      className="flex flex-row flex-wrap items-start gap-x-4 gap-y-3 sm:w-44 sm:flex-col sm:shrink-0"
      data-testid="payout-pies"
    >
      <TinyPayoutPie pie={face} />
      <TinyPayoutPie pie={postFee} />
    </div>
  );
}
