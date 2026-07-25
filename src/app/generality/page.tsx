import Link from "next/link";

import { Footer, Nav, NoRun, Panel, SectionHead, Stat, TierBadge, cx } from "@/components/ui";
import { availablePackRuns, fmtDateTime, fmtKm2, loadRun } from "@/lib/run";
import { getPack, VERTICAL_PACKS } from "@/lib/verticals";
import type { Run } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function GeneralityPage() {
  const graded = await loadRun();
  const packRuns = await availablePackRuns();
  if (!graded) {
    return (
      <>
        <Nav current="/generality" />
        <NoRun />
      </>
    );
  }

  const runs = [
    { run: graded, graded: true },
    ...packRuns.map((p) => ({ run: p.run, graded: false })),
  ];

  return (
    <>
      <Nav current="/generality" />
      <main className="wash grain mx-auto max-w-[1340px] px-6 pt-12">
        <div className="max-w-3xl">
          <p className="t-label">Generality, demonstrated</p>
          <h1 className="t-h1 mt-2.5">The same pipeline, pointed somewhere else.</h1>
          <p className="t-body mt-5">
            It is easy to claim an engine is vertical-agnostic and hard to prove it, so rather than assert it
            here are complete runs produced by the identical agent graph, differing only in which vertical pack
            was loaded. Nothing in the code changed between them — not the scorer, not the contact finder, not
            the critic.
          </p>
          <p className="t-body mt-4">
            A pack is data: the tag signatures that find the asset in the physical world, the local job titles
            that find the people, the regulatory instruments that force the inspection, and the weights that
            matter for that industry. Swapping it changes what the system looks for, not how it thinks.
          </p>
        </div>

        <div className="mt-10 grid gap-4 lg:grid-cols-2">
          {runs.map(({ run, graded: isGraded }) => (
            <RunCard key={run.id} run={run} graded={isGraded} />
          ))}
        </div>

        <section className="mt-14">
          <SectionHead
            label="What the pack changed"
            title="Only the inputs"
            note="Each row below is data in a pack definition rather than a branch in the code."
          />
          <div className="x-scroll slim-scroll">
            <table className="w-full min-w-[46rem] border-collapse text-[0.84rem]">
              <thead>
                <tr className="border-b border-[var(--color-hair-2)] text-left">
                  <th className="t-label pb-2 pr-4 font-normal">Pack input</th>
                  {runs.map(({ run }) => (
                    <th key={run.id} className="t-label pb-2 pr-4 font-normal">
                      {getPack(run.brief.verticalPackId).label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-[var(--color-hair)]">
                  <Th>Asset signatures searched</Th>
                  {runs.map(({ run }) => (
                    <Cell key={run.id}>
                      {getPack(run.brief.verticalPackId).osmSignatures.map((s) => (
                        <span key={s.assetClass} className="chip chip-null mr-1 mb-1 inline-block">
                          {s.assetClass.replace(/_/g, " ")}
                        </span>
                      ))}
                    </Cell>
                  ))}
                </tr>
                <tr className="border-b border-[var(--color-hair)]">
                  <Th>What actually gets inspected</Th>
                  {runs.map(({ run }) => (
                    <Cell key={run.id}>
                      {getPack(run.brief.verticalPackId).osmSignatures[0]?.inspectionSubject}
                    </Cell>
                  ))}
                </tr>
                <tr className="border-b border-[var(--color-hair)]">
                  <Th>Local job titles used</Th>
                  {runs.map(({ run }) => {
                    const p = getPack(run.brief.verticalPackId);
                    const extra = p.personaTitles.es.length - 3;
                    return (
                      <Cell key={run.id}>
                        {p.personaTitles.es.slice(0, 3).join(" · ")}
                        {extra > 0 ? ` · plus ${extra} more` : ""}
                      </Cell>
                    );
                  })}
                </tr>
                <tr className="border-b border-[var(--color-hair)]">
                  <Th>Reference account</Th>
                  {runs.map(({ run }) => (
                    <Cell key={run.id}>{run.brief.referenceAccount}</Cell>
                  ))}
                </tr>
                <tr className="border-b border-[var(--color-hair)]">
                  <Th>Heaviest scoring weight</Th>
                  {runs.map(({ run }) => {
                    const w = getPack(run.brief.verticalPackId).icpWeights;
                    const top = Object.entries(w).sort((a, b) => b[1] - a[1])[0];
                    return (
                      <Cell key={run.id} mono>
                        {top[0].replace(/_/g, " ")} {top[1].toFixed(2)}
                      </Cell>
                    );
                  })}
                </tr>
                <tr className="border-b border-[var(--color-hair)]">
                  <Th>Coverage actually observed</Th>
                  {runs.map(({ run }) => (
                    <Cell key={run.id}>{getPack(run.brief.verticalPackId).coverageNote}</Cell>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-12">
          <SectionHead label="The honest read" title="What the second run also shows" />
          <div className="grid gap-3 md:grid-cols-3">
            <Panel className="p-4">
              <p className="text-[0.92rem] font-[600]">Coverage varies by industry, not by ambition</p>
              <p className="t-small mt-2">
                Chilean solar carries operator tags on the large majority of mapped plants, which is richer than
                mining. The same query shape in another region returns almost no operator tags at all, so
                attribution falls back to proximity and is labelled that way rather than presented as certain.
              </p>
            </Panel>
            <Panel className="p-4">
              <p className="text-[0.92rem] font-[600]">Asset granularity changes what a site means</p>
              <p className="t-small mt-2">
                A pit is one polygon. A photovoltaic plant is often hundreds of small array blocks, so the site
                count in the solar run is large while the footprint stays modest. The sizing model reads
                footprint and boundary rather than counting features, which is why it survives that difference.
              </p>
            </Panel>
            <Panel className="p-4">
              <p className="text-[0.92rem] font-[600]">Fewer accounts qualified, and that is correct</p>
              <p className="t-small mt-2">
                Solar operators sit under lighter inspection mandates and file less contractor-risk language
                than mining majors, so they score lower against the same weighted model. A scorer that
                flattered every vertical equally would not be measuring anything.
              </p>
            </Panel>
          </div>
        </section>

        <section className="mt-12">
          <SectionHead
            label="Defined but not yet run"
            title="The rest of the taxonomy"
            note="These packs are complete definitions whose tag signatures were probed against live data. They are listed as defined rather than demonstrated, because a pack that has not been executed is a claim and not a result."
          />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {VERTICAL_PACKS.filter(
              (p) => !runs.some((r) => r.run.brief.verticalPackId === p.id),
            ).map((p) => (
              <Panel key={p.id} className="p-4" sunk>
                <div className="flex items-center gap-2">
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ background: `var(${p.accentVar})` }}
                  />
                  <p className="text-[0.88rem] font-[560]">{p.label}</p>
                </div>
                <p className="t-micro mt-1.5">{p.flytbaseIndustry}</p>
                <p className="t-micro mt-2 opacity-80">{p.coverageNote.split(".")[0]}.</p>
              </Panel>
            ))}
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}

function RunCard({ run, graded }: { run: Run; graded: boolean }) {
  const pack = getPack(run.brief.verticalPackId);
  const top = run.accounts[0];
  return (
    <Panel className="p-5">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="inline-block h-2.5 w-2.5 rounded-full"
          style={{ background: `var(${pack.accentVar})` }}
        />
        <p className="text-[0.95rem] font-[600]">{pack.label}</p>
        {graded ? (
          <span className="chip chip-accent">the assigned brief</span>
        ) : (
          <span className="chip chip-verified">generality run</span>
        )}
      </div>
      <p className="t-small mt-2">{run.brief.targetVertical}</p>
      <p className="t-micro mt-1">
        anchor {run.brief.referenceAccount} · executed {fmtDateTime(run.startedAt)}
      </p>

      <div className="mt-4 grid grid-cols-3 gap-4 border-y border-[var(--color-hair)] py-3.5">
        <Stat label="Operators seen" value={run.stats.accountsConsidered} />
        <Stat label="Accounts" value={run.accounts.length} />
        <Stat label="Sites" value={run.stats.sitesMeasured} />
        <Stat label="Footprint" value={fmtKm2(run.stats.totalAreaKm2)} unit="km²" />
        <Stat label="Evidence" value={run.stats.evidenceRows} />
        <Stat label="Named" value={run.stats.namedContacts} />
      </div>

      {top && (
        <div className="mt-3">
          <p className="t-label">Leading account</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <TierBadge tier={top.icp.tier} score={top.icp.total} />
            {graded ? (
              <Link href={`/console/account/${top.slug}`} className="text-[0.9rem] font-[560] hover:underline">
                {top.displayName}
              </Link>
            ) : (
              <span className="text-[0.9rem] font-[560]">{top.displayName}</span>
            )}
            <span className="t-micro">
              {top.sites.filter((s) => !s.excluded).length} sites · {fmtKm2(top.sizing?.totalAreaKm2 ?? 0)} km²
            </span>
          </div>
        </div>
      )}

      <p className="t-micro mt-3">
        {run.stats.languages.join(", ")} · {run.nullResults.length} gap
        {run.nullResults.length === 1 ? "" : "s"} recorded · {run.stats.sourcesFetched} sources fetched
      </p>
    </Panel>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <td className="py-2.5 pr-4 align-top">
      <span className="t-micro">{children}</span>
    </td>
  );
}

function Cell({ children, mono }: { children: React.ReactNode; mono?: boolean }) {
  return (
    <td
      className={cx(
        "py-2.5 pr-4 align-top",
        mono && "font-[family-name:var(--font-mono)] text-[0.78rem]",
      )}
    >
      {children}
    </td>
  );
}
