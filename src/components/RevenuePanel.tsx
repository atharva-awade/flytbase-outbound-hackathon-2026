import type { RevenueCase } from "@/lib/revenue";
import { cx } from "./ui";

/**
 * The money case, on the account brief.
 *
 * Programme sizing tells an engineer how many docks. This tells a rep what to
 * say to somebody whose bonus depends on production and whose licence depends on
 * incident rate. The layout is built around one rule: a reader can see, without
 * clicking anything, which numbers somebody published, which are arithmetic on
 * measured ground, and which are the reader's own to supply.
 *
 * The third category is the honest part. A contracted inspection day rate and
 * the value of an hour of unplanned downtime are not published by any operator,
 * so they arrive as wide bands marked as the reader's figure, they are excluded
 * from anything generated copy may assert, and the caveats say plainly what
 * would make the whole thing wrong. A number a prospect can correct starts a
 * conversation. A number they cannot check ends one.
 */
export function RevenuePanel({ revenue, accountName }: { revenue: RevenueCase; accountName: string }) {
  const r = revenue;
  return (
    <div className="space-y-4">
      <div className="panel p-4">
        <p className="t-label">The case, in one sentence</p>
        <p className="t-body mt-1.5">{r.headline}</p>

        {/* The middle of each band, not its edges. Quoting the extremes of
            several independent bands at once produced "minus 652 thousand to 147
            million", which is arithmetically true and says nothing. The span is
            still shown, below, labelled as a span. */}
        <div className="mt-4 grid grid-cols-2 gap-4 border-t border-[var(--color-hair)] pt-4 sm:grid-cols-4">
          <Money
            k="Payback"
            v={`about ${r.central.paybackMonths} months`}
            note="on displaced inspection spend alone"
          />
          <Money
            k="Programme"
            v={`$${short(r.central.programmeInvestment)}`}
            note="scaled from the one published deployment"
          />
          <Money
            k="Three year net"
            v={`$${short(r.central.netThreeYear)}`}
            note={`${r.central.returnMultiple} times the investment`}
          />
          <Money
            k="Person-days out of hazard"
            v={r.central.hazardPersonDaysPerYear.toLocaleString("en-GB")}
            note="each year, derived from geometry alone"
          />
        </div>

        <p className="t-micro mt-3 border-t border-[var(--color-hair)] pt-3">
          Those are the middle of each input band. Across the full span of the bands, three year net runs from
          ${short(r.netThreeYear.low)} to ${short(r.netThreeYear.high)} and payback from {r.paybackLabel}.{" "}
          {r.paysBackInWorstCase
            ? "Even the unfavourable end recovers the cost inside three years."
            : "The unfavourable end does not recover the cost inside three years, and that end requires the lowest cadence, the lowest day rate and the highest dock count all at once."}{" "}
          The span is wide because the inspection cadence alone varies thirtyfold, so quoting either edge would
          report an accident of the input ranges rather than a finding.
        </p>
      </div>

      <div className="panel p-4">
        <p className="t-label">Inspection coverage on the same ground</p>
        <div className="mt-2 space-y-2">
          <Bar
            label="on foot, contracted"
            value={`${r.coverage.manualPassesPerYear.low} to ${r.coverage.manualPassesPerYear.high} passes a year`}
            fraction={0.22}
            tone="muted"
          />
          <Bar
            label="flown, automated"
            value={`${r.coverage.automatedPassesPerYear.low} to ${r.coverage.automatedPassesPerYear.high} passes a year`}
            fraction={1}
            tone="accent"
          />
        </div>
        <p className="t-micro mt-2.5">
          The reference deployment did not simply make inspection cheaper. It doubled how often the ground was
          looked at, which is why the argument to an operations lead is coverage rather than cost.
        </p>
      </div>

      <div className="panel p-4">
        <p className="t-label">Where every figure comes from</p>
        <div className="mt-2 space-y-2.5">
          {r.inputs.map((i) => (
            <div key={i.key}>
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span
                  className={cx(
                    "chip",
                    i.inputClass === "published"
                      ? "chip-verified"
                      : i.inputClass === "derived"
                        ? "chip-accent"
                        : "chip-inferred",
                  )}
                >
                  {i.inputClass === "published"
                    ? "published, with a source"
                    : i.inputClass === "derived"
                      ? "computed from measured ground"
                      : "your figure, not sourced"}
                </span>
                <span className="t-small font-[540]">{i.label}</span>
                <span className="tnum t-small">
                  {i.low.toLocaleString("en-GB")} to {i.high.toLocaleString("en-GB")} {i.unit}
                </span>
              </div>
              <p className="t-micro mt-0.5 [overflow-wrap:anywhere]">
                {i.basis}
                {i.sourceUrl && (
                  <a
                    href={i.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="chip chip-verified ml-1.5"
                  >
                    source
                  </a>
                )}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="panel p-4">
        <p className="t-label">The arithmetic, line by line</p>
        <ol className="mt-2 space-y-1.5">
          {r.derivation.map((d, i) => (
            <li key={i} className="t-small flex gap-2.5">
              <span className="tnum shrink-0 opacity-40">{i + 1}</span>
              <span className="[overflow-wrap:anywhere]">{d}</span>
            </li>
          ))}
        </ol>
      </div>

      <div className="rounded-[12px] bg-[var(--color-null-wash)] p-4">
        <p className="t-label" style={{ color: "var(--color-null-ink)" }}>
          What would make this wrong
        </p>
        <ul className="mt-2 space-y-1.5">
          {r.caveats.map((c, i) => (
            <li key={i} className="t-small" style={{ color: "var(--color-null-ink)" }}>
              {c}
            </li>
          ))}
        </ul>
        <p className="t-micro mt-2.5" style={{ color: "var(--color-null-ink)" }}>
          {r.downtimeExposure.note} On the figures above, compressing one outage from a manual detection cycle to
          the published detection window is worth ${short(r.downtimeExposure.valuePerIncident.low)} to $
          {short(r.downtimeExposure.valuePerIncident.high)} at {accountName}, and that single figure rests entirely
          on an hourly production value only they can supply.
        </p>
      </div>
    </div>
  );
}

function Money({ k, v, note }: { k: string; v: string; note: string }) {
  return (
    <div>
      <p className="t-label">{k}</p>
      <p className="tnum mt-1 text-[1.02rem] font-[570] leading-tight tracking-[-0.02em]">{v}</p>
      <p className="t-micro mt-0.5">{note}</p>
    </div>
  );
}

function Bar({
  label,
  value,
  fraction,
  tone,
}: {
  label: string;
  value: string;
  fraction: number;
  tone: "accent" | "muted";
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="t-small font-[540]">{label}</span>
        <span className="tnum t-small">{value}</span>
      </div>
      <div className="mt-1 h-[6px] overflow-hidden rounded-full bg-[var(--color-panel-sunk)]">
        <div
          className="h-full rounded-full"
          style={{
            width: `${Math.max(4, fraction * 100)}%`,
            background: tone === "accent" ? "var(--color-accent)" : "var(--color-hair-2)",
          }}
        />
      </div>
    </div>
  );
}

function short(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(Math.abs(n) >= 10_000_000 ? 0 : 1)}M`;
  if (Math.abs(n) >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(Math.round(n));
}
