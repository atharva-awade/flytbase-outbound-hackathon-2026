import { EvidenceChip, Footer, Nav, NoRun, Panel, SectionHead, Stat, cx } from "@/components/ui";
import { AGENTS } from "@/lib/agents";
import { SOURCE_CLASS_LABEL, fmtDate, fmtDateTime, loadMeta, loadRun } from "@/lib/run";
import { SOURCE_CLASS_TRUST } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function EvidencePage() {
  const run = await loadRun();
  const meta = await loadMeta();
  if (!run) {
    return (
      <>
        <Nav current="/evidence" />
        <NoRun />
      </>
    );
  }

  const rows = Object.values(run.evidence);
  const byClass = new Map<string, number>();
  const byLang = new Map<string, number>();
  for (const r of rows) {
    byClass.set(r.sourceClass, (byClass.get(r.sourceClass) ?? 0) + 1);
    byLang.set(r.language, (byLang.get(r.language) ?? 0) + 1);
  }

  const uniqueDomains = new Set(
    rows.map((r) => {
      try {
        return new URL(r.sourceUrl).hostname;
      } catch {
        return r.sourceUrl;
      }
    }),
  );

  const nonEnglish = rows.filter((r) => r.language !== "en");

  return (
    <>
      <Nav current="/evidence" />
      <main className="wash grain mx-auto max-w-[1340px] px-6 pt-12">
        <div className="max-w-3xl">
          <p className="t-label">Evidence ledger</p>
          <h1 className="t-h1 mt-2.5">Every fact in this system, and where it came from.</h1>
          <p className="t-body mt-5">
            A claim cannot reach the interface unless it is carried by a row in this table. Each row stores the
            source it was read from, the exact text it was read from, when it was fetched, and how much
            confidence that source class earns. Nothing here was typed by hand.
          </p>
        </div>

        <div className="mt-9 grid grid-cols-2 gap-6 border-y border-[var(--color-hair)] py-6 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Evidence rows" value={rows.length} />
          <Stat label="Distinct sources" value={uniqueDomains.size} sub="unique hostnames" />
          <Stat label="Source classes" value={byClass.size} />
          <Stat label="Non-English rows" value={nonEnglish.length} sub="quoted in the original" />
          <Stat label="Gaps recorded" value={run.nullResults.length} sub="questions left open" />
          <Stat label="Sources fetched" value={run.stats.sourcesFetched} sub="network calls made" />
        </div>

        {/* ── Trust ordering ───────────────────────────────────────── */}
        <section className="mt-12">
          <SectionHead
            label="Source hierarchy"
            title="Not all sources are equal, and the order is declared"
            note="When two sources disagree, the one higher in this list wins and the disagreement is shown rather than hidden. Publishing the order is what makes that reconciliation auditable instead of arbitrary."
          />
          <div className="x-scroll slim-scroll">
            <div className="flex min-w-[50rem] gap-2">
              {SOURCE_CLASS_TRUST.map((cls, i) => {
                const n = byClass.get(cls) ?? 0;
                return (
                  <div
                    key={cls}
                    className={cx(
                      "flex-1 rounded-[10px] p-3",
                      n > 0
                        ? "bg-[var(--color-panel)] shadow-[var(--shadow-hair)]"
                        : "bg-[var(--color-panel-sunk)] opacity-60",
                    )}
                  >
                    <p className="t-micro font-[family-name:var(--font-mono)] opacity-55 [overflow-wrap:anywhere]">
                      {String(i + 1).padStart(2, "0")}
                    </p>
                    <p className="mt-1 text-[0.8rem] font-[560] leading-tight">
                      {SOURCE_CLASS_LABEL[cls] ?? cls}
                    </p>
                    <p className="tnum mt-1.5 text-[1.05rem] font-[560]">{n}</p>
                    <p className="t-micro">rows</p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* ── Non-English ──────────────────────────────────────────── */}
        {nonEnglish.length > 0 && (
          <section className="mt-12">
            <SectionHead
              label="Read in the original"
              title={`${nonEnglish.length} rows quoted from non-English sources`}
              note="The disclosures that matter for this campaign are published in Spanish under Chilean law. Reading them in the original, and quoting them verbatim, is the difference between researching a market and searching it in English."
            />
            <div className="grid gap-3 md:grid-cols-2">
              {nonEnglish.slice(0, 6).map((r) => (
                <Panel key={r.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-[0.86rem] font-[560]">{r.claim}</p>
                    <EvidenceChip row={r} />
                  </div>
                  <blockquote className="mt-2 border-l-2 border-[var(--color-hair-2)] pl-3 text-[0.83rem] leading-[1.55] text-[var(--color-ink-2)]">
                    “{r.verbatim}”
                  </blockquote>
                  {r.translation && <p className="t-micro mt-1.5">EN: {r.translation}</p>}
                  <p className="t-micro mt-2 opacity-70">{r.sourceTitle}</p>
                </Panel>
              ))}
            </div>
          </section>
        )}

        {/* ── Gaps ────────────────────────────────────────────────── */}
        {run.nullResults.length > 0 && (
          <section className="mt-12">
            <SectionHead
              label={`Null-result register · ${run.nullResults.length}`}
              title="The questions this run could not answer"
              note="The brief asks to be shown where the pipeline hits a wall. This is that record: what was asked, what was tried, exactly what came back, and what would fix it."
            />
            <div className="space-y-3">
              {run.nullResults.map((n) => (
                <Panel key={n.id} className="p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-[0.9rem] font-[560]">{n.question}</p>
                    <span className="t-micro">
                      {n.subject} · {AGENTS.find((a) => a.id === n.producedBy)?.title ?? n.producedBy}
                    </span>
                  </div>
                  <div className="mt-2.5 space-y-1 rounded-[8px] bg-[var(--color-panel-sunk)] p-2.5">
                    {n.attempts.map((a, i) => (
                      <p key={i} className="t-micro font-[family-name:var(--font-mono)] break-all">
                        <span className="opacity-55">tried </span>
                        {a.source}
                        {a.url ? ` · ${a.url}` : ""}
                        <span className="opacity-55"> → </span>
                        {a.outcome}
                      </p>
                    ))}
                  </div>
                  <p className="t-small mt-2.5">{n.interpretation}</p>
                  <p className="t-small mt-1.5">
                    <span className="t-label">Fix · </span>
                    {n.remediation}
                  </p>
                </Panel>
              ))}
            </div>
          </section>
        )}

        {/* ── Full ledger ──────────────────────────────────────────── */}
        <section className="mt-12">
          <SectionHead
            label={`Full ledger · ${rows.length} rows`}
            title="Every row, openable"
            note="Hover any chip to read the verbatim snippet the claim was taken from. Click it to open the source."
          />
          <div className="x-scroll slim-scroll">
            <table className="w-full min-w-[58rem] border-collapse text-[0.82rem]">
              <thead>
                <tr className="border-b border-[var(--color-hair-2)] text-left">
                  <th className="t-label pb-2 pr-3 font-normal">Claim</th>
                  <th className="t-label pb-2 pr-3 font-normal">Source class</th>
                  <th className="t-label pb-2 pr-3 font-normal">Lang</th>
                  <th className="t-label pb-2 pr-3 font-normal">Fetched</th>
                  <th className="t-label pb-2 pr-3 font-normal">Produced by</th>
                  <th className="t-label pb-2 font-normal">Open</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 140).map((r) => (
                  <tr key={r.id} className="border-b border-[var(--color-hair)]">
                    <td className="max-w-[30rem] py-2 pr-3 align-top">{r.claim}</td>
                    <td className="py-2 pr-3 align-top whitespace-nowrap">
                      {SOURCE_CLASS_LABEL[r.sourceClass] ?? r.sourceClass}
                    </td>
                    <td className="py-2 pr-3 align-top font-[family-name:var(--font-mono)] text-[0.76rem]">
                      {r.language}
                    </td>
                    <td className="py-2 pr-3 align-top whitespace-nowrap font-[family-name:var(--font-mono)] text-[0.74rem]">
                      {fmtDate(r.fetchedAt)}
                    </td>
                    <td className="py-2 pr-3 align-top whitespace-nowrap t-micro">
                      {AGENTS.find((a) => a.id === r.producedBy)?.title ?? r.producedBy}
                    </td>
                    <td className="py-2 align-top">
                      <EvidenceChip row={r} compact />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > 140 && (
            <p className="t-micro mt-2">
              Showing the first 140 of {rows.length} rows. The complete ledger ships in the run artifact.
            </p>
          )}
        </section>

        <p className="t-micro mt-10">
          Run {run.id} · executed {fmtDateTime(run.startedAt)}
        </p>
      </main>
      <Footer attribution={meta?.attribution} />
    </>
  );
}
