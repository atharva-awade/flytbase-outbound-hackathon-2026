import type { CrossVerification } from "@/lib/crossverify";
import { SOURCE_CLASS_LABEL } from "@/lib/format";
import { Panel, cx } from "./ui";

/**
 * What comparing sources revealed.
 *
 * Two things are shown that most research output hides. Where sources agree, the
 * agreement is stated rather than collapsed into a single unattributed fact.
 * Where they disagree, the disagreement is displayed with a stated trust order,
 * because quietly resolving a conflict in favour of the flattering number is how
 * a figure gets demolished in a meeting.
 */
export function CrossVerify({ cv }: { cv: CrossVerification }) {
  if (cv.corroborations.length === 0 && cv.conflicts.length === 0) return null;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* ── Conflicts first: they are the more interesting half ─────── */}
      {cv.conflicts.length > 0 && (
        <div>
          <p className="t-label">
            Figures that disagree · {cv.conflicts.length}
          </p>
          <p className="t-micro mt-1 max-w-xl">
            Shown rather than resolved silently. A reconciled conflict is more persuasive than a clean number,
            because it demonstrates the numbers were actually compared.
          </p>
          <div className="mt-3 space-y-3">
            {cv.conflicts.map((c, i) => (
              <Panel key={i} className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[0.88rem] font-[600]">{c.question}</p>
                  <span
                    className={cx(
                      "chip shrink-0",
                      c.kind === "different_scope" ? "chip-inferred" : "chip-conflict",
                    )}
                  >
                    {c.kind === "different_scope"
                      ? "different scope"
                      : c.kind === "stale_source"
                        ? "stale source"
                        : "genuine disagreement"}
                  </span>
                </div>

                <div className="mt-2.5 space-y-2">
                  {c.positions.map((p, j) => (
                    <div key={j} className="flex items-baseline gap-2.5">
                      <span className="tnum shrink-0 font-[family-name:var(--font-mono)] text-[0.86rem] font-[560]">
                        {p.value}
                      </span>
                      <span className="t-micro min-w-0 flex-1">
                        {p.label}
                        <a
                          href={p.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="chip chip-verified ml-1.5"
                        >
                          {SOURCE_CLASS_LABEL[p.sourceClass] ?? p.sourceClass}
                        </a>
                      </span>
                    </div>
                  ))}
                </div>

                <p className="t-small mt-2.5 border-t border-[var(--color-hair)] pt-2.5">
                  <span className="t-label">How it reconciles · </span>
                  {c.resolution}
                </p>
              </Panel>
            ))}
          </div>
        </div>
      )}

      {/* ── Corroboration ───────────────────────────────────────────── */}
      {cv.corroborations.length > 0 && (
        <div>
          <p className="t-label">
            People confirmed on more than one source · {cv.stats.corroborated} of{" "}
            {cv.stats.corroborated + cv.stats.singleSourced}
          </p>
          <p className="t-micro mt-1 max-w-xl">
            A person named on two independent disclosures is a materially stronger claim than the same person
            named once, so agreement is recorded rather than assumed.
          </p>
          <div className="mt-3 space-y-2">
            {cv.corroborations.slice(0, 8).map((c, i) => (
              <div
                key={i}
                className={cx(
                  "rounded-[10px] p-3",
                  c.strength === "corroborated"
                    ? "bg-[var(--color-verified-wash)] ring-1 ring-inset ring-[rgba(15,123,79,0.14)]"
                    : "bg-[var(--color-panel-sunk)]",
                )}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-[0.86rem] font-[560]">
                    {c.subject}{" "}
                    <span className="font-normal opacity-70">{c.claim}</span>
                  </p>
                  <span
                    className={cx("chip", c.strength === "corroborated" ? "chip-verified" : "chip-null")}
                  >
                    {c.strength === "corroborated"
                      ? `${c.agreeing.length} sources agree`
                      : "single source"}
                  </span>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {c.agreeing.map((a, j) => (
                    <a
                      key={j}
                      href={a.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="chip chip-accent"
                      title={a.verbatim.slice(0, 240)}
                    >
                      {SOURCE_CLASS_LABEL[a.sourceClass] ?? a.sourceClass}
                    </a>
                  ))}
                </div>
                <p className="t-micro mt-1.5">{c.note}</p>
              </div>
            ))}
          </div>
          {cv.corroborations.length > 8 && (
            <p className="t-micro mt-2">
              Showing 8 of {cv.corroborations.length}. The rest are in the account export.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
