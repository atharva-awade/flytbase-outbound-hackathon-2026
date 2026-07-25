import type { AeBrief, Account, EvidenceRow } from "@/lib/types";
import { BUYING_ROLE_LABEL } from "@/lib/format";
import { Citations, Panel, cx } from "./ui";

/**
 * The hand-off.
 *
 * This is the screen the whole system exists to produce, so it sits above the
 * analysis rather than below it. A rep should be able to read this alone and
 * start working, and everything under it is the audit trail for anyone who wants
 * to check why it says what it says.
 */
export function AeBriefPanel({
  brief,
  account,
  evidenceFor,
}: {
  brief: AeBrief;
  account: Account;
  evidenceFor: (ids: string[]) => EvidenceRow[];
}) {
  const contactById = new Map(account.contacts.map((c) => [c.id, c]));

  return (
    <div className="rounded-[16px] bg-[var(--color-panel)] p-5 shadow-[var(--shadow-lift)]">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="t-label">Account executive hand-off</p>
        <span className="t-micro">generated from this account&apos;s own evidence</span>
      </div>

      <h2 className="t-h2 mt-2 max-w-4xl">{brief.headline}</h2>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-[11px] bg-[var(--color-accent-wash)] p-3.5 ring-1 ring-inset ring-[rgba(27,79,216,0.13)]">
          <p className="t-label" style={{ color: "var(--color-accent-ink)" }}>
            Say this
          </p>
          <p className="mt-1.5 text-[0.9rem] leading-[1.6]" style={{ color: "var(--color-accent-ink)" }}>
            {brief.positioning}
          </p>
        </div>
        <div className="rounded-[11px] bg-[var(--color-panel-sunk)] p-3.5">
          <p className="t-label">Why now</p>
          <p className="t-small mt-1.5">{brief.whyNow}</p>
        </div>
      </div>

      {/* Next action, the single most important line on the page. */}
      <div className="mt-4 flex items-start gap-3 rounded-[11px] bg-[var(--color-ink)] p-3.5">
        <span className="mt-0.5 shrink-0 rounded-[6px] bg-[rgba(255,255,255,0.14)] px-1.5 py-0.5 font-[family-name:var(--font-mono)] text-[0.62rem] uppercase tracking-[0.12em] text-white">
          do next
        </span>
        <p className="text-[0.9rem] leading-[1.55] text-white">{brief.nextAction}</p>
      </div>

      {/* Stakeholder map */}
      <div className="mt-6">
        <p className="t-label">Who to work, in order</p>
        <div className="mt-2 space-y-2">
          {brief.stakeholderMap.map((s, i) => {
            const c = contactById.get(s.contactId);
            if (!c) return null;
            return (
              <div key={s.contactId} className="flex gap-3">
                <span className="t-micro mt-1 w-4 shrink-0 font-[family-name:var(--font-mono)] tnum opacity-50">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1 border-l-2 border-[var(--color-hair)] pl-3">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-[0.88rem] font-[600]">
                      {c.name ?? c.targetRole}
                    </span>
                    <span className="chip chip-null">{BUYING_ROLE_LABEL[s.role]}</span>
                    {c.tier === "ROLE_TARGET_NO_NAME" && <span className="chip chip-inferred">no name found</span>}
                    {c.titleVerbatim && <span className="t-micro italic">{c.titleVerbatim}</span>}
                  </div>
                  <p className="t-small mt-1">{s.approach}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Discovery questions */}
      <div className="mt-6">
        <p className="t-label">Ask these · {brief.discoveryQuestions.length}</p>
        <p className="t-micro mt-1 max-w-3xl">
          Each one is tied to something specific about this operator, so it cannot be answered with a
          generality. The reason it lands is stated, because a question you do not understand the purpose of
          is a question you will not ask well.
        </p>
        <ol className="mt-3 space-y-3">
          {brief.discoveryQuestions.map((q, i) => (
            <li key={i} className="rounded-[10px] bg-[var(--color-panel-sunk)] p-3">
              <p className="text-[0.89rem] font-[520] leading-[1.5]">
                <span className="t-micro mr-1.5 font-[family-name:var(--font-mono)] opacity-55">
                  {String(i + 1).padStart(2, "0")}
                </span>
                &ldquo;{q.question}&rdquo;
              </p>
              <p className="t-micro mt-1.5">
                {q.whyItLands}
                <Citations rows={evidenceFor(q.evidenceIds)} max={2} />
              </p>
            </li>
          ))}
        </ol>
      </div>

      {/* Objections */}
      <div className="mt-6">
        <p className="t-label">They will push back with · {brief.objections.length}</p>
        <div className="mt-2 grid gap-2.5 lg:grid-cols-2">
          {brief.objections.map((o, i) => (
            <div key={i} className="rounded-[10px] p-3 ring-1 ring-inset ring-[var(--color-hair)]">
              <p className="text-[0.86rem] font-[600] text-[var(--color-conflict)]">
                &ldquo;{o.objection}&rdquo;
              </p>
              <p className="t-small mt-1.5">
                {o.response}
                <Citations rows={evidenceFor(o.evidenceIds)} max={2} />
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Reference */}
      <div className="mt-6 border-t border-[var(--color-hair)] pt-4">
        <p className="t-label">Reference to reach for</p>
        <p className="t-small mt-1.5 max-w-4xl">
          {brief.referenceCase.value}
          <Citations rows={evidenceFor(brief.referenceCase.evidenceIds)} max={2} />
        </p>
      </div>
    </div>
  );
}

/** Compact variant for the console list. */
export function BriefTeaser({ brief }: { brief: AeBrief }) {
  return (
    <div className={cx("rounded-[10px] bg-[var(--color-panel-sunk)] p-2.5")}>
      <p className="t-label">do next</p>
      <p className="t-small mt-1">{brief.nextAction}</p>
    </div>
  );
}
