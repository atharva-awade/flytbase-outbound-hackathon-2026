import type { Account, CadenceStep, Contact, EmailDraft, EvidenceRow } from "@/lib/types";
import type { MessageStrategy } from "@/lib/outreach";
import { Citations, EvidenceChip, Panel, cx } from "./ui";
import { BUYING_ROLE_LABEL } from "@/lib/format";

const CHANNEL_LABEL: Record<CadenceStep["channel"], string> = {
  email: "Email",
  linkedin: "LinkedIn",
  call: "Call",
};

/**
 * The outreach section.
 *
 * Two things are deliberately visible that most systems hide: the strategy that
 * constrained the writer, and every draft the critic threw away. The rejected
 * drafts are the evidence that a machine produced this and that something
 * adversarial checked it. A page showing only polished final copy is
 * indistinguishable from a page where a human wrote the copy.
 */
export function Outreach({
  account,
  cadence,
  draftsByContact,
  strategies,
  evidenceFor,
}: {
  account: Account;
  cadence: CadenceStep[];
  draftsByContact: Record<string, EmailDraft[]>;
  strategies: Record<string, MessageStrategy>;
  evidenceFor: (ids: string[]) => EvidenceRow[];
}) {
  const contactById = new Map(account.contacts.map((c) => [c.id, c]));
  const contactsWithWork = account.contacts.filter(
    (c) => draftsByContact[c.id]?.length || strategies[c.id],
  );

  return (
    <div className="space-y-8">
      {/* ── Cadence ─────────────────────────────────────────────── */}
      {cadence.length > 0 && (
        <div>
          <p className="t-label">Sequence · {cadence.length} touches, multi-threaded</p>
          <p className="t-small mt-1.5 max-w-3xl">
            Day offsets are chosen from published reply behaviour rather than habit, and each touch says why
            it exists. The sequence spreads across the buying committee instead of contacting one person five
            times.
          </p>
          <div className="mt-4 space-y-2">
            {cadence.map((step, i) => {
              const c = contactById.get(step.contactId);
              return (
                <div key={i} className="flex gap-3">
                  <div className="flex w-14 shrink-0 flex-col items-center">
                    <span className="tnum rounded-[7px] bg-[var(--color-ink)] px-2 py-1 text-[0.72rem] font-[560] text-white">
                      Day {step.dayOffset}
                    </span>
                    {i < cadence.length - 1 && (
                      <span className="mt-1 w-px flex-1 bg-[var(--color-hair-2)]" aria-hidden />
                    )}
                  </div>
                  <Panel className="mb-1 flex-1 p-3.5">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="chip chip-accent">{CHANNEL_LABEL[step.channel]}</span>
                        <span className="text-[0.86rem] font-[560]">
                          {c?.name ?? c?.targetRole ?? step.contactId}
                        </span>
                        {c && (
                          <span className="t-micro">
                            {c.titleVerbatim ?? BUYING_ROLE_LABEL[c.buyingRole]}
                          </span>
                        )}
                        {c?.tier === "ROLE_TARGET_NO_NAME" && (
                          <span className="chip chip-null">role only</span>
                        )}
                      </div>
                      {step.draft && (
                        <span className="chip chip-verified">copy ready · {step.draft.score}/100</span>
                      )}
                    </div>
                    <p className="t-small mt-1.5">{step.intent}</p>
                    <p className="t-micro mt-1.5 border-t border-[var(--color-hair)] pt-1.5">
                      <span className="t-label">Why · </span>
                      {step.rationale}
                    </p>
                    {step.script && (
                      <p className="t-micro mt-1.5 rounded-[7px] bg-[var(--color-panel-sunk)] p-2">
                        {step.script}
                      </p>
                    )}
                  </Panel>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Per-contact strategy and drafts ─────────────────────── */}
      {contactsWithWork.map((contact) => {
        const drafts = draftsByContact[contact.id] ?? [];
        const strategy = strategies[contact.id];
        const acceptedDraft = drafts.find((d) => d.accepted);
        const rejectedDrafts = drafts.filter((d) => !d.accepted);

        return (
          <div key={contact.id} className="border-t border-[var(--color-hair)] pt-6">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <div>
                <p className="text-[0.98rem] font-[600]">{contact.name ?? contact.targetRole}</p>
                <p className="t-small mt-0.5 italic">{contact.titleVerbatim ?? "role target, no individual sourced"}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="chip chip-null">{BUYING_ROLE_LABEL[contact.buyingRole]}</span>
                {strategy && <span className="chip chip-accent">{strategy.language}</span>}
              </div>
            </div>

            {/* Strategy, deterministic, produced without a model. */}
            {strategy && (
              <Panel className="mt-3 p-4" sunk>
                <div className="flex items-baseline justify-between">
                  <p className="t-label">Message strategy · computed, no model involved</p>
                  <span className="t-micro">{strategy.facts.length} sourced facts available</span>
                </div>
                <p className="t-small mt-2">{strategy.whyThisPerson}</p>
                <p className="t-small mt-1.5">
                  <span className="t-label">Angle · </span>
                  {strategy.angle}
                </p>

                <div className="mt-3">
                  <p className="t-label">The only facts the writer was given</p>
                  <ol className="mt-1.5 space-y-1.5">
                    {strategy.facts.map((f, i) => (
                      <li key={i} className="text-[0.83rem] leading-[1.5]">
                        <span className="t-micro mr-1.5 font-[family-name:var(--font-mono)] opacity-55">
                          {i + 1}
                        </span>
                        {f.text}
                        <Citations rows={evidenceFor([f.evidenceId])} max={1} />
                      </li>
                    ))}
                  </ol>
                  <p className="t-micro mt-2">
                    The writer receives nothing else. It cannot introduce a claim because it has no material
                    from which to invent one.
                  </p>
                </div>

                {strategy.proofPoint && (
                  <div className="mt-3 border-t border-[var(--color-hair)] pt-2.5">
                    <p className="t-label">Reference customer it may name</p>
                    <p className="t-small mt-1">
                      <strong>{strategy.proofPoint.customer}</strong>: {strategy.proofPoint.claim}
                    </p>
                    <a
                      href={strategy.proofPoint.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="chip chip-verified mt-1.5"
                    >
                      published case study
                    </a>
                  </div>
                )}

                {strategy.withheld.length > 0 && (
                  <div className="mt-3 border-t border-[var(--color-hair)] pt-2.5">
                    <p className="t-label" style={{ color: "var(--color-inferred)" }}>
                      Deliberately withheld from the copy
                    </p>
                    <ul className="mt-1.5 space-y-1">
                      {strategy.withheld.map((w, i) => (
                        <li key={i} className="t-micro" style={{ color: "var(--color-inferred)" }}>
                          {w}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </Panel>
            )}

            {/* Accepted copy. */}
            {acceptedDraft && (
              <div className="mt-3">
                <div className="flex items-baseline justify-between">
                  <p className="t-label" style={{ color: "var(--color-verified)" }}>
                    Passed the critic on iteration {acceptedDraft.iteration}
                  </p>
                  <span className="t-micro tnum">
                    {acceptedDraft.wordCount} words · {acceptedDraft.sentenceCount} sentences ·{" "}
                    {acceptedDraft.score}/100
                  </span>
                </div>
                <DraftCard draft={acceptedDraft} evidenceFor={evidenceFor} tone="accepted" />
              </div>
            )}

            {/* Rejected drafts, kept on purpose. */}
            {rejectedDrafts.length > 0 && (
              <div className="mt-4">
                <p className="t-label" style={{ color: "var(--color-conflict)" }}>
                  Rejected by the critic · {rejectedDrafts.length}{" "}
                  {rejectedDrafts.length === 1 ? "draft" : "drafts"}
                </p>
                <p className="t-micro mt-1 max-w-3xl">
                  Shown rather than discarded. These are the clearest evidence that the copy was machine
                  written and that something adversarial checked it before a prospect would have seen it.
                </p>
                <div className="mt-2.5 space-y-3">
                  {rejectedDrafts.map((d) => (
                    <DraftCard key={d.id} draft={d} evidenceFor={evidenceFor} tone="rejected" />
                  ))}
                </div>
              </div>
            )}

            {drafts.length === 0 && (
              <Panel className="mt-3 p-4">
                <p className="t-label" style={{ color: "var(--color-inferred)" }}>
                  No copy generated
                </p>
                <p className="t-small mt-1.5">
                  The strategy above was produced deterministically. Phrasing is the one step that needs a
                  language model, and it is left empty rather than filled in by hand, writing these ourselves
                  and presenting them as generated would misrepresent the system.
                </p>
              </Panel>
            )}
          </div>
        );
      })}
    </div>
  );
}

function DraftCard({
  draft,
  evidenceFor,
  tone,
}: {
  draft: EmailDraft;
  evidenceFor: (ids: string[]) => EvidenceRow[];
  tone: "accepted" | "rejected";
}) {
  const failed = draft.gates.filter((g) => !g.passed);
  return (
    <div
      className={cx(
        "rounded-[12px] p-4 ring-1 ring-inset",
        tone === "accepted"
          ? "bg-[var(--color-panel)] ring-[rgba(15,123,79,0.2)]"
          : "bg-[var(--color-panel-sunk)] ring-[rgba(168,50,42,0.14)]",
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[0.9rem] font-[600]">{draft.subject}</p>
        <span className="t-micro font-[family-name:var(--font-mono)]">
          iteration {draft.iteration} · {draft.model}
        </span>
      </div>

      <div className="mt-2.5 whitespace-pre-wrap text-[0.87rem] leading-[1.65] text-[var(--color-ink-2)]">
        {draft.body}
      </div>

      {draft.englishGloss && (
        <div className="mt-3 border-t border-[var(--color-hair)] pt-2.5">
          <p className="t-label">English, for the account executive</p>
          <p className="t-small mt-1 whitespace-pre-wrap">{draft.englishGloss}</p>
        </div>
      )}

      {/* Which facts it actually used. */}
      {draft.citedFacts.length > 0 && (
        <div className="mt-3 border-t border-[var(--color-hair)] pt-2.5">
          <p className="t-label">Facts asserted, each traceable</p>
          <ul className="mt-1.5 space-y-1">
            {draft.citedFacts.map((f, i) => (
              <li key={i} className="t-micro">
                {f.text}
                <Citations rows={evidenceFor([f.evidenceId])} max={1} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Gate results, every check, pass or fail. */}
      <div className="mt-3 border-t border-[var(--color-hair)] pt-2.5">
        <div className="flex items-baseline justify-between">
          <p className="t-label">Critic gates</p>
          <span className="t-micro tnum">
            {draft.gates.filter((g) => g.passed).length}/{draft.gates.length} passed
          </span>
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1">
          {draft.gates.map((g) => (
            <span
              key={g.gate}
              className={cx("chip chip-wrap", g.passed ? "chip-verified" : "chip-conflict")}
              title={g.detail}
            >
              {g.gate} {g.label}
            </span>
          ))}
        </div>
        {failed.length > 0 && (
          <ul className="mt-2 space-y-1">
            {failed.map((g) => (
              <li key={g.gate} className="t-micro" style={{ color: "var(--color-conflict)" }}>
                <strong>{g.gate}</strong>: {g.detail}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
