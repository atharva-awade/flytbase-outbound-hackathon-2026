import Link from "next/link";

import { Citations, Footer, Nav, NoRun, Panel, SectionHead, Stat, TierBadge } from "@/components/ui";
import { fmtDateTime, fmtKm2, loadMeta, loadRun, resolveEvidence } from "@/lib/run";
import { getPack, PRESET_BRIEFS } from "@/lib/verticals";

export const dynamic = "force-dynamic";

export default async function ConsolePage() {
  const run = await loadRun();
  const meta = await loadMeta();
  if (!run) {
    return (
      <>
        <Nav current="/console" />
        <NoRun />
      </>
    );
  }

  const pack = getPack(run.brief.verticalPackId);
  const namedTotal = run.stats.namedContacts;

  return (
    <>
      <Nav current="/console" />
      <main className="wash grain mx-auto max-w-[1340px] px-6 pt-10">
        {/* ── The brief, shown verbatim ─────────────────────────────── */}
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="max-w-2xl">
            <p className="t-label">Campaign brief · input</p>
            <h1 className="t-h1 mt-2">{run.brief.targetVertical}</h1>
            <dl className="mt-4 space-y-1.5">
              <Row k="Reference account" v={run.brief.referenceAccount} />
              <Row k="Target roles" v={run.brief.targetRoles.join(" · ")} />
              <Row k="Geographies" v={run.brief.geographies.join(", ")} />
              <Row k="Angle" v={run.brief.angle} />
            </dl>
          </div>

          <Panel className="min-w-[19rem] p-4">
            <p className="t-label">Run</p>
            <p className="mt-1.5 font-[family-name:var(--font-mono)] text-[0.78rem]">{run.id}</p>
            <div className="mt-3 space-y-1 border-t border-[var(--color-hair)] pt-3">
              <Meta k="Executed" v={fmtDateTime(run.startedAt)} />
              <Meta k="Sources fetched" v={String(run.stats.sourcesFetched)} />
              <Meta k="Evidence rows" v={String(run.stats.evidenceRows)} />
              <Meta k="Languages" v={run.stats.languages.join(", ")} />
              {meta?.osmDataTimestamps?.length ? (
                <Meta k="OSM data as of" v={meta.osmDataTimestamps.slice(0, 2).map((t) => t.slice(0, 10)).join(", ")} />
              ) : null}
            </div>
            <p className="t-micro mt-3 border-t border-[var(--color-hair)] pt-3">
              This is a recorded execution of the pipeline, replayed with its original fetch timestamps.
              Nothing on this page was written by hand.
            </p>
          </Panel>
        </div>

        {/* ── Headline metrics ──────────────────────────────────────── */}
        <div className="mt-10 grid grid-cols-2 gap-6 border-y border-[var(--color-hair)] py-6 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Operators observed" value={run.stats.accountsConsidered} sub="from mapped geometry" />
          <Stat label="Accounts resolved" value={run.accounts.length} sub={`${run.stats.accountsQualified} tier A or B`} />
          <Stat label="Sites measured" value={run.stats.sitesMeasured} sub="individually citable" />
          <Stat label="Mapped footprint" value={fmtKm2(run.stats.totalAreaKm2)} unit="km²" sub="geodesic, not estimated" />
          <Stat label="Named contacts" value={namedTotal} sub={`${run.stats.roleTargets} role targets`} />
          <Stat label="Gaps recorded" value={run.nullResults.length} sub="shown, not hidden" />
        </div>

        {/* ── How the universe was built ────────────────────────────── */}
        <div className="mt-8 rounded-[12px] bg-[var(--color-accent-wash)] p-4 ring-1 ring-inset ring-[rgba(27,79,216,0.14)]">
          <p className="t-label" style={{ color: "var(--color-accent-ink)" }}>
            How this account list was built
          </p>
          <p className="mt-1.5 max-w-4xl text-[0.87rem] text-[var(--color-accent-ink)]">
            No model was asked to name mining companies. Every mapped extraction site across{" "}
            {run.brief.geographies.join(", ")} was measured, and the operator was read off the geometry.
            {" "}
            {run.stats.accountsConsidered} distinct operators were observed this way; {run.accounts.length}{" "}
            resolved to a corporate identity and the remainder were left out rather than guessed at. An
            invented account is therefore not possible here — if a company appears below, someone mapped
            its pit and we measured it.
          </p>
        </div>

        {/* ── Accounts ──────────────────────────────────────────────── */}
        <section className="mt-12">
          <SectionHead
            label={`${pack.label} · ${run.accounts.length} accounts`}
            title="Ranked for the desk"
            note="Ordered by tier, then score, then how urgent the timing signal is. The reference account leads because its measured profile defines the target."
          />

          <div className="space-y-3">
            {run.accounts.map((a) => {
              const named = a.contacts.filter((c) => c.tier !== "ROLE_TARGET_NO_NAME");
              const topSignal = [...a.signals].sort((x, y) => y.urgency - x.urgency)[0];
              const area = a.sizing?.totalAreaKm2 ?? 0;
              return (
                // The card is a container, not a link. It used to be a <Link>
                // wrapping the whole body, which put the citation chips' own <a>
                // inside an <a> — invalid HTML, a hydration error, and a chip
                // click that also navigated the card. The overlay link below
                // keeps the whole card clickable while leaving the chips live.
                <div
                  key={a.id}
                  className="group relative rounded-[14px] bg-[var(--color-panel)] p-4 shadow-[var(--shadow-panel)] transition-shadow hover:shadow-[var(--shadow-lift)]"
                >
                  <Link
                    href={`/console/account/${a.slug}`}
                    aria-label={`Open the account brief for ${a.displayName}`}
                    className="absolute inset-0 z-0 rounded-[14px]"
                  />
                  <div className="pointer-events-none relative z-10 flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-[16rem] flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <TierBadge tier={a.icp.tier} score={a.icp.total} />
                        <h3 className="t-h3">{a.displayName}</h3>
                        {a.isAnchor && <span className="chip chip-accent">reference account</span>}
                        <span className="t-micro">{a.countryName}</span>
                        {a.ticker && <span className="chip chip-null">{a.ticker}</span>}
                      </div>
                      <p className="t-small mt-2 max-w-3xl">{a.anchorComparison.value}</p>
                      {topSignal && (
                        <p className="t-micro mt-2 max-w-3xl">
                          <span className="chip chip-verified mr-1.5">timing</span>
                          {topSignal.headline}
                          <Citations
                            rows={resolveEvidence(run, topSignal.evidenceIds)}
                            max={2}
                            className="pointer-events-auto relative z-20"
                          />
                        </p>
                      )}
                    </div>

                    <div className="grid shrink-0 grid-cols-4 gap-5 text-right">
                      <MiniStat k="sites" v={String(a.sites.filter((s) => !s.excluded).length)} />
                      <MiniStat k="km² mapped" v={fmtKm2(area)} />
                      <MiniStat k="named" v={String(named.length)} />
                      <MiniStat
                        k="docks"
                        v={a.sizing ? `${a.sizing.docksRequired.low}–${a.sizing.docksRequired.high}` : "—"}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* ── Generality ────────────────────────────────────────────── */}
        <section className="mt-14">
          <SectionHead
            label="The engine is not a mining script"
            title="Other briefs this same pipeline runs"
            note="A vertical pack is data: tag signatures, local job titles, regulatory instruments and scoring weights. Swapping the pack points the identical agent graph at a different asset class anywhere on earth."
          />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {PRESET_BRIEFS.map((b) => {
              const p = getPack(b.verticalPackId);
              const active = b.id === run.brief.id;
              return (
                <Panel key={b.id} className="p-4" sunk={!active}>
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ background: `var(${p.accentVar})` }}
                    />
                    <p className="t-label">{p.flytbaseIndustry}</p>
                  </div>
                  <p className="mt-2 text-[0.88rem] font-[560]">{b.label}</p>
                  <p className="t-micro mt-1.5">{b.targetVertical}</p>
                  <p className="t-micro mt-2 opacity-75">Anchor: {b.referenceAccount}</p>
                  {active && <p className="chip chip-accent mt-2">this run</p>}
                  <p className="t-micro mt-2 border-t border-[var(--color-hair)] pt-2 opacity-70">
                    {p.coverageNote.split(".")[0]}.
                  </p>
                </Panel>
              );
            })}
          </div>
        </section>
      </main>
      <Footer attribution={meta?.attribution} />
    </>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-3">
      <dt className="t-micro w-[9.5rem] shrink-0 pt-0.5">{k}</dt>
      <dd className="text-[0.88rem]">{v}</dd>
    </div>
  );
}

function Meta({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="t-micro">{k}</span>
      <span className="font-[family-name:var(--font-mono)] tnum text-[0.74rem]">{v}</span>
    </div>
  );
}

function MiniStat({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <p className="tnum text-[1.05rem] font-[560] leading-none">{v}</p>
      <p className="t-micro mt-1">{k}</p>
    </div>
  );
}
