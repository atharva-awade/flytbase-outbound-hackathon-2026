import type { EvidenceRow, IcpScore } from "@/lib/types";
import { Citations, cx } from "./ui";

/**
 * The score, rendered as arithmetic.
 *
 * Each row shows weight × signal = contribution, and the contributions sum to
 * the total on screen. A reviewer can check the maths by hand, which is the
 * whole point: "the model gave it 92" is not a defensible qualification, and a
 * sales team should never be asked to trust one.
 */
export function IcpWaterfall({
  icp,
  evidenceFor,
}: {
  icp: IcpScore;
  evidenceFor: (ids: string[]) => EvidenceRow[];
}) {
  const max = Math.max(...icp.dimensions.map((d) => d.weight * 100), 1);

  return (
    <div>
      <div className="space-y-2.5">
        {icp.dimensions.map((d) => {
          const pct = (d.contribution / max) * 100;
          const ceiling = (d.weight * 100).toFixed(0);
          return (
            <div key={d.key}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[0.84rem]">
                  {d.label}
                  {d.unscored && (
                    <span
                      className="chip chip-null ml-1.5"
                      title="No public evidence was found for this dimension, so it contributed zero rather than an estimate."
                    >
                      no evidence
                    </span>
                  )}
                  <Citations rows={evidenceFor(d.evidenceIds)} max={2} />
                </span>
                <span className="t-micro shrink-0 font-[family-name:var(--font-mono)] tnum">
                  {d.weight.toFixed(2)} × {d.raw.toFixed(2)} ={" "}
                  <span className="text-[var(--color-ink)]">{d.contribution.toFixed(1)}</span>
                  <span className="opacity-45"> / {ceiling}</span>
                </span>
              </div>
              <div className="mt-1 h-[5px] overflow-hidden rounded-full bg-[var(--color-panel-sunk)]">
                <div
                  className={cx(
                    "h-full rounded-full transition-[width] duration-700",
                    d.unscored ? "bg-[var(--color-hair-2)]" : "bg-[var(--color-accent)]",
                  )}
                  style={{ width: `${Math.max(pct, d.contribution > 0 ? 2 : 0)}%` }}
                />
              </div>
              <p className="t-micro mt-1 max-w-2xl opacity-80">{d.rationale}</p>
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex items-baseline justify-between border-t border-[var(--color-hair)] pt-3">
        <span className="t-label">Sum of contributions</span>
        <span className="tnum font-[family-name:var(--font-mono)] text-[1.05rem] font-[560]">
          {icp.total.toFixed(1)} / 100
        </span>
      </div>

      {icp.disqualifiers.length > 0 && (
        <div className="mt-4 rounded-[10px] bg-[var(--color-conflict-wash)] p-3 ring-1 ring-inset ring-[rgba(168,50,42,0.16)]">
          <p className="t-label" style={{ color: "var(--color-conflict)" }}>
            Disqualified
          </p>
          <ul className="mt-1.5 space-y-1">
            {icp.disqualifiers.map((d) => (
              <li key={d} className="text-[0.84rem] text-[var(--color-conflict)]">
                {d}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
