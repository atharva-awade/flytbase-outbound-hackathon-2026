import Link from "next/link";

import GlobeExplorer, { type ExplorerSite } from "@/components/GlobeExplorer";
import DroneModel from "@/components/DroneModel";
import { Footer, Nav, Panel, SectionHead, Stat, cx } from "@/components/ui";
import { fmtDateTime, fmtKm2, loadMeta, loadRun } from "@/lib/run";
import { VERTICAL_PACKS } from "@/lib/verticals";
import { osmUrl } from "@/lib/geo";

export const dynamic = "force-dynamic";

export default async function Home() {
  const run = await loadRun();
  const meta = await loadMeta();

  // Every dot on the globe is a measured feature, carrying enough context that
  // clicking it can open the operation without another round trip.
  const explorerSites: ExplorerSite[] = [];

  // The ranked list beside the globe. Ordered by measured footprint rather than by
  // score, because footprint is the thing the globe is showing and the two lists
  // agreeing is what makes the pairing readable.
  const rankedAccounts = (run?.accounts ?? [])
    .map((a) => ({
      slug: a.slug,
      displayName: a.displayName,
      areaKm2: a.sites.filter((s) => !s.excluded).reduce((t, s) => t + s.areaKm2, 0),
      contacts: a.contacts.filter((c) => c.tier !== "ROLE_TARGET_NO_NAME").length,
      tier: a.icp.tier,
    }))
    .sort((x, y) => y.areaKm2 - x.areaKm2)
    .slice(0, 8);

  if (run) {
    const maxArea = Math.max(...run.accounts.flatMap((a) => a.sites.map((s) => s.areaKm2)), 1);
    for (const account of run.accounts) {
      const topSignal = [...account.signals].sort((x, y) => y.urgency - x.urgency)[0];
      const active = account.sites.filter((s) => !s.excluded);
      // Cap per account so one heavily-mapped operator cannot swamp the globe.
      for (const site of [...active].sort((a, b) => b.areaKm2 - a.areaKm2).slice(0, 10)) {
        const owner = account.contacts.find((c) => c.siteOsmId === site.osmId);
        explorerSites.push({
          osmId: site.osmId,
          name: site.name ?? site.assetClass.replace(/_/g, " "),
          accountSlug: account.slug,
          accountName: account.displayName,
          countryName: account.countryName,
          lat: site.centroid.lat,
          lon: site.centroid.lon,
          areaKm2: site.areaKm2,
          perimeterKm: site.perimeterKm,
          assetClass: site.assetClass,
          attributionMethod: site.attributionMethod,
          tier: account.icp.tier,
          weight: Math.sqrt(site.areaKm2 / maxArea),
          signalHeadline: topSignal?.headline,
          signalUrgency: topSignal?.urgency,
          geometry: site,
          siblings: active.slice(0, 40),
          osmUrl: osmUrl(site.osmId),
          contactName: owner?.name,
          contactTitle: owner?.titleVerbatim,
        });
      }
    }
  }

  const anchor = run?.accounts.find((a) => a.isAnchor);
  const topNamed = run?.accounts
    .flatMap((a) => a.contacts.map((c) => ({ c, a })))
    .filter((x) => x.c.tier !== "ROLE_TARGET_NO_NAME" && x.c.siteOsmId)
    .slice(0, 3);

  return (
    <>
      <Nav current="/" />

      {/* ── Hero ───────────────────────────────────────────────────── */}
      <main className="wash grain relative overflow-hidden">
        {/* The one decorative element in the whole application, and it earns its
            place: the pitch is autonomous inspection of hazardous ground, so the
            page shows the thing that does the inspecting. Absolutely positioned so
            it cannot affect the layout, and the component removes itself entirely
            on a small screen, a metered connection, or reduced-motion. */}
        <div className="pointer-events-none absolute left-5 top-6 z-10 hidden lg:block">
          <DroneModel size={200} />
        </div>

        <div className="mx-auto grid max-w-[1340px] items-center gap-10 px-6 pt-16 pb-8 lg:grid-cols-[1.05fr_0.95fr] lg:pt-20">
          <div>
            <p className="t-label">Outbound account &amp; contact generation</p>
            <h1 className="t-display mt-3">
              Outreach grounded in
              <br />
              <span className="text-[var(--color-accent)]">measured ground.</span>
            </h1>
            <p className="t-body mt-6 max-w-xl text-[1.02rem]">
              Aerion takes a campaign brief and returns the account list, the buying committee and the
              outreach a human outbound rep would produce. The difference is what it stands on: every
              account is discovered by measuring real industrial sites, every claim links to the document it
              came from, and the gaps are shown rather than filled.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                href="/console"
                className="rounded-[9px] bg-[var(--color-ink)] px-4 py-2.5 text-[0.9rem] font-[520] text-white transition-opacity hover:opacity-88"
              >
                Open the console
              </Link>
              <Link
                href="/how-it-thinks"
                className="rounded-[9px] bg-[var(--color-panel)] px-4 py-2.5 text-[0.9rem] font-[520] shadow-[var(--shadow-hair)] transition-shadow hover:shadow-[var(--shadow-panel)]"
              >
                How it thinks
              </Link>
            </div>

            {run && (
              <p className="t-micro mt-5">
                Showing run <span className="font-[family-name:var(--font-mono)]">{run.id}</span>, executed{" "}
                {fmtDateTime(run.startedAt)} against live sources.
              </p>
            )}
          </div>

          {/* The globe carries its own legend in normal flow, so the caption is
              given its own row rather than being absolutely positioned into the
              same space, which is what made the two collide. */}
          <div className="flex flex-col items-center gap-1 lg:items-end">
            <GlobeExplorer sites={explorerSites} maptilerKey={process.env.MAPTILER_KEY} />
            {/* The ranked list, beside the globe rather than on it.
                Labelling every account on the sphere was tried and abandoned:
                when all of them sit inside one mining district, three chips do
                not fit sixty pixels, and staggering them turned an overlap into a
                stack. A globe is good at showing shape and scale, a list is good
                at showing names. So each does the job it is better at. */}
            <div className="mt-4 w-full max-w-md">
              <p className="t-label">Accounts, ranked by measured footprint</p>
              <div className="mt-2 space-y-1">
                {rankedAccounts.map((a, i) => (
                  <Link
                    key={a.slug}
                    href={`/console/account/${a.slug}`}
                    className="group flex items-baseline gap-2.5 rounded-[7px] px-1.5 py-1 transition-colors hover:bg-[var(--color-panel-sunk)]"
                  >
                    <span className="tnum t-micro w-4 shrink-0 text-right opacity-40">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate text-[0.86rem] font-[540]">{a.displayName}</span>
                    <span
                      className="tnum shrink-0 text-[0.78rem] font-[520]"
                      style={{ color: "var(--color-accent)" }}
                    >
                      {fmtKm2(a.areaKm2)}
                      <span className="t-micro ml-0.5 opacity-60">km²</span>
                    </span>
                    <span className="t-micro w-14 shrink-0 text-right opacity-70">
                      {a.contacts} named
                    </span>
                    <span className="t-micro w-6 shrink-0 text-right">{a.tier}</span>
                  </Link>
                ))}
              </div>
            </div>

            <p className="t-micro mt-3 max-w-md text-center leading-relaxed lg:text-right">
              {explorerSites.length} measured sites, each a real mapped feature. Hover holds the rotation ·
              click a site to open its satellite view and draw its link to Pune.
            </p>
          </div>
        </div>

        {/* ── Metrics strip ─────────────────────────────────────────── */}
        {run && (
          <div className="border-y border-[var(--color-hair)] bg-[rgba(255,255,255,0.5)]">
            <div className="mx-auto grid max-w-[1340px] grid-cols-2 gap-6 px-6 py-7 sm:grid-cols-3 lg:grid-cols-6">
              <Stat label="Sites measured" value={run.stats.sitesMeasured} sub="each individually citable" />
              <Stat label="Mapped footprint" value={fmtKm2(run.stats.totalAreaKm2)} unit="km²" sub="geodesic from geometry" />
              <Stat label="Evidence rows" value={run.stats.evidenceRows} sub="every fact, one source" />
              <Stat label="Named contacts" value={run.stats.namedContacts} sub="none invented" />
              <Stat label="Operators observed" value={run.stats.accountsConsidered} sub="read off the map" />
              <Stat label="Gaps recorded" value={run.nullResults.length} sub="failures shown" />
            </div>
          </div>
        )}
      </main>

      {/* ── The problem ────────────────────────────────────────────── */}
      <section className="mx-auto max-w-[1340px] px-6 py-16">
        <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr]">
          <div>
            <p className="t-label">The problem with AI prospecting</p>
            <h2 className="t-h1 mt-2.5 max-w-lg">
              Anything a model can write, a model can invent.
            </h2>
            <p className="t-body mt-5 max-w-lg">
              Ask a language model for mining companies in Latin America and you get a list that looks
              right. Some of it is right. You cannot tell which parts, and neither can the rep who sends the
              email. That is the failure this system is built to remove.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Feature
              tone="conflict"
              label="What most systems do"
              title="Ask a model, then trust it"
              body="The account list, the pain point and the number in the email all originate in the same place: a model's memory. Nothing can be checked, so nothing can be defended in the room."
            />
            <Feature
              tone="verified"
              label="What Aerion does"
              title="Measure first, write last"
              body="Accounts come from mapped geometry. Pain comes from the company's own filing. Names come from statutory disclosures. The model writes prose over facts that already exist and are already cited."
            />
          </div>
        </div>
      </section>

      {/* ── Differentiators ────────────────────────────────────────── */}
      <section className="mx-auto max-w-[1340px] px-6 pb-16">
        <SectionHead
          label="How it holds up"
          title="Six things that cannot be faked"
          note="Each of these is visible in the console on every account, not described in a document."
        />
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          <Card
            n="01"
            title="Accounts discovered from terrain"
            body="No model is asked to name companies. Every mapped extraction site in the target geographies is measured and the operator is read off the geometry, so an invented account is structurally impossible."
            proof={run ? `${run.stats.accountsConsidered} operators observed this way` : undefined}
          />
          <Card
            n="02"
            title="Footprint measured, not estimated"
            body="Area and perimeter are computed geodesically from each polygon's coordinates. Figures are labelled mapped footprint, because a digitised pit outline is not a lease boundary and claiming otherwise would be wrong."
            proof={run ? `${fmtKm2(run.stats.totalAreaKm2)} km² measured across ${run.stats.sitesMeasured} sites` : undefined}
          />
          <Card
            n="03"
            title="The angle in the prospect's own words"
            body="A deterministic scan of the company's annual filing counts and quotes its contractor and hazard language. The opening line of the outreach comes from the prospect's own risk disclosure."
            proof={anchor?.riskScan ? `${anchor.displayName}: ${(anchor.riskScan.termCounts.contractor ?? 0) + (anchor.riskScan.termCounts.contractors ?? 0)} contractor references in its own filing` : undefined}
          />
          <Card
            n="04"
            title="Scoring you can check by hand"
            body="Qualification is a pure function with published weights. Each dimension shows weight times signal equals contribution, and the contributions sum to the total on screen. No model opinion enters the score."
            proof="Ten weighted dimensions, per-signal contributions shown"
          />
          <Card
            n="05"
            title="Real names or none at all"
            body="A person appears only if their name and verbatim title were read from a page we fetched. Where nobody could be found, the role is targeted instead, with a documented way to find the human."
            proof={run ? `${run.stats.namedContacts} named, ${run.stats.roleTargets} honest role targets` : undefined}
          />
          <Card
            n="06"
            title="Failures on the record"
            body="Every unanswered question is logged with what was tried and what it returned. A pipeline that reports only its wins cannot be audited, and an auditor is exactly who should be reading this."
            proof={run ? `${run.nullResults.length} gaps recorded this run` : undefined}
          />
        </div>
      </section>

      {/* ── The pairing ────────────────────────────────────────────── */}
      {topNamed && topNamed.length > 0 && run && (
        <section className="border-y border-[var(--color-hair)] bg-[rgba(255,255,255,0.5)]">
          <div className="mx-auto max-w-[1340px] px-6 py-14">
            <SectionHead
              label="The artefact this produces"
              title="A named site leader, beside the measured extent of what they run"
              note="This pairing is the reason the outreach lands. It is also the reason it cannot be generated by a prompt: one half comes from a statutory disclosure, the other from geometry."
            />
            <div className="grid gap-3 md:grid-cols-3">
              {topNamed.map(({ c, a }) => {
                const site = a.sites.find((s) => s.osmId === c.siteOsmId);
                if (!site) return null;
                return (
                  <Panel key={c.id} className="p-4">
                    <p className="text-[0.95rem] font-[600]">{c.name}</p>
                    <p className="t-small mt-0.5 italic">{c.titleVerbatim}</p>
                    <p className="t-micro mt-0.5">{a.displayName}</p>
                    <div className="mt-3 border-t border-[var(--color-hair)] pt-3">
                      <p className="t-label">Runs</p>
                      <p className="mt-1 text-[0.88rem] font-[560]">{site.name ?? site.osmId}</p>
                      <div className="mt-2 flex gap-5">
                        <span className="tnum text-[1.1rem] font-[560]">
                          {site.areaKm2.toFixed(2)}
                          <span className="t-micro ml-1">km²</span>
                        </span>
                        <span className="tnum text-[1.1rem] font-[560]">
                          {site.perimeterKm.toFixed(1)}
                          <span className="t-micro ml-1">km boundary</span>
                        </span>
                      </div>
                      <p className="t-micro mt-2 font-[family-name:var(--font-mono)]">{site.osmId}</p>
                    </div>
                    <Link
                      href={`/console/account/${a.slug}`}
                      className="t-micro mt-3 inline-block text-[var(--color-accent)] hover:underline"
                    >
                      open the brief →
                    </Link>
                  </Panel>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* ── Vertical packs ─────────────────────────────────────────── */}
      <section className="mx-auto max-w-[1340px] px-6 py-16">
        <SectionHead
          label="Not a mining tool"
          title="One engine, any asset class FlytBase sells into"
          note="A vertical pack is data: the tag signatures that find the asset, the local job titles that find the people, the regulatory instruments that force the inspection, and the scoring weights that matter for that industry. The agent graph does not change."
        />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {VERTICAL_PACKS.map((p) => (
            <Panel key={p.id} className="p-4">
              <div className="flex items-center gap-2">
                <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: `var(${p.accentVar})` }} />
                <p className="text-[0.9rem] font-[560]">{p.label}</p>
              </div>
              <p className="t-micro mt-1.5">FlytBase industry · {p.flytbaseIndustry}</p>
              <p className="t-small mt-2.5">
                {p.osmSignatures.length} tag signature{p.osmSignatures.length === 1 ? "" : "s"} ·{" "}
                {p.personaTitles.es.length + p.personaTitles.en.length + p.personaTitles.pt.length} local job
                titles · {p.regulatoryRegimes.length} regulatory instrument
                {p.regulatoryRegimes.length === 1 ? "" : "s"}
              </p>
              <p className="t-micro mt-2.5 border-t border-[var(--color-hair)] pt-2.5 opacity-80">
                {p.coverageNote}
              </p>
            </Panel>
          ))}
        </div>
      </section>

      {/* ── Language ───────────────────────────────────────────────── */}
      <section className="border-t border-[var(--color-hair)]">
        <div className="mx-auto max-w-[1340px] px-6 py-14">
          <div className="grid gap-10 lg:grid-cols-[1fr_1fr]">
            <div>
              <p className="t-label">Multi-language by construction</p>
              <h2 className="t-h1 mt-2.5 max-w-md">The sources that matter are rarely in English.</h2>
              <p className="t-body mt-5 max-w-lg">
                A Chilean operator's officers are published in Spanish under a Chilean transparency statute. A
                Brazilian miner's safety obligations are written in Portuguese. Aerion reads them in the
                original, quotes them verbatim with a translation for the rep, and writes to the contact in
                the language they actually work in.
              </p>
              <p className="t-small mt-4 max-w-lg">
                Titles are handled as terms of art rather than words: a Chilean site lead is a{" "}
                <em>Gerente General de Faena</em>, maintenance is <em>mantención</em> rather than{" "}
                <em>mantenimiento</em>, and a Peruvian safety lead is a <em>Gerente de SSOMA</em>. Getting
                these wrong is how outreach announces itself as foreign and automated.
              </p>
            </div>
            <Panel className="p-5">
              <p className="t-label">Languages in this run</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {(run?.stats.languages ?? []).map((l) => (
                  <span key={l} className="chip chip-accent">
                    {l}
                  </span>
                ))}
              </div>
              <p className="t-label mt-5">Readability, scored correctly per language</p>
              <p className="t-small mt-1.5">
                Copy is gated on readability, and an English grade formula applied to Spanish produces a
                meaningless number. Spanish and Portuguese drafts are scored with the Fernández-Huerta
                adaptation instead, English with Flesch-Kincaid.
              </p>
              <p className="t-label mt-5">Never machine-translated</p>
              <p className="t-small mt-1.5">
                Drafts are generated natively in the target language. A translated English email keeps English
                sentence rhythm and reads exactly as what it is.
              </p>
            </Panel>
          </div>
        </div>
      </section>

      <Footer attribution={meta?.attribution} />
    </>
  );
}

function Feature({
  tone,
  label,
  title,
  body,
}: {
  tone: "verified" | "conflict";
  label: string;
  title: string;
  body: string;
}) {
  return (
    <div
      className={cx(
        "rounded-[14px] p-4 ring-1 ring-inset",
        tone === "verified"
          ? "bg-[var(--color-verified-wash)] ring-[rgba(15,123,79,0.16)]"
          : "bg-[var(--color-conflict-wash)] ring-[rgba(168,50,42,0.14)]",
      )}
    >
      <p className="t-label" style={{ color: tone === "verified" ? "var(--color-verified)" : "var(--color-conflict)" }}>
        {label}
      </p>
      <p
        className="mt-2 text-[0.98rem] font-[600]"
        style={{ color: tone === "verified" ? "var(--color-verified)" : "var(--color-conflict)" }}
      >
        {title}
      </p>
      <p
        className="mt-1.5 text-[0.85rem] leading-[1.6]"
        style={{ color: tone === "verified" ? "var(--color-verified)" : "var(--color-conflict)" }}
      >
        {body}
      </p>
    </div>
  );
}

function Card({ n, title, body, proof }: { n: string; title: string; body: string; proof?: string }) {
  return (
    <Panel className="p-4">
      <p className="t-label font-[family-name:var(--font-mono)]">{n}</p>
      <p className="mt-2 text-[0.98rem] font-[600] leading-[1.3]">{title}</p>
      <p className="t-small mt-2">{body}</p>
      {proof && (
        <p className="t-micro mt-3 border-t border-[var(--color-hair)] pt-2.5 font-[family-name:var(--font-mono)]">
          {proof}
        </p>
      )}
    </Panel>
  );
}
