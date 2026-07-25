import Link from "next/link";
import { notFound } from "next/navigation";

import { AeBriefPanel } from "@/components/AeBriefPanel";
import { CrossVerify } from "@/components/CrossVerify";
import { LiveRun } from "@/components/LiveRun";
import { IcpWaterfall } from "@/components/IcpWaterfall";
import { Outreach } from "@/components/Outreach";
import { ExportBar } from "@/components/ExportBar";
import SiteMapClient from "@/components/SiteMapClient";
import {
  Citations,
  EvidenceChip,
  Footer,
  Nav,
  Panel,
  RangeStat,
  SectionHead,
  Stat,
  TierBadge,
  Unsourced,
  cx,
} from "@/components/ui";
import {
  ASSET_CLASS_LABEL,
  ATTRIBUTION_LABEL,
  BUYING_ROLE_LABEL,
  daysAgo,
  fmtDate,
  fmtKm2,
  loadAccount,
  loadMeta,
  resolveEvidence,
} from "@/lib/run";
import { summariseSites } from "@/lib/geo";
import { crossVerify } from "@/lib/crossverify";
import { loadOutreach } from "@/lib/run";
import { getPack } from "@/lib/verticals";
import type { EvidenceRow } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function AccountPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const found = await loadAccount(slug);
  if (!found) notFound();
  const { run, account } = found;
  const meta = await loadMeta();
  const outreach = await loadOutreach();
  const pack = getPack(account.verticalPackId);

  const ev = (ids: string[] | undefined): EvidenceRow[] => resolveEvidence(run, ids);
  const summary = summariseSites(account.sites);
  const activeSites = account.sites.filter((s) => !s.excluded);
  const phase1 = [...activeSites].sort((a, b) => b.areaKm2 - a.areaKm2)[0];
  const accountNulls = run.nullResults.filter(
    (n) => n.subject === account.displayName || n.subject === account.legalName,
  );
  const cv = crossVerify({ account, evidence: run.evidence });
  const named = account.contacts.filter((c) => c.tier !== "ROLE_TARGET_NO_NAME");
  const roleTargets = account.contacts.filter((c) => c.tier === "ROLE_TARGET_NO_NAME");

  return (
    <>
      <Nav current="/console" />
      <main className="wash grain mx-auto max-w-[1340px] px-6 pt-8">
        <Link href="/console" className="t-micro hover:text-[var(--color-ink)]">
          ← all accounts
        </Link>

        {/* ── Header ───────────────────────────────────────────────── */}
        <div className="mt-4 flex flex-wrap items-start justify-between gap-6">
          <div className="max-w-2xl">
            <div className="flex flex-wrap items-center gap-2">
              <TierBadge tier={account.icp.tier} score={account.icp.total} />
              {account.isAnchor && <span className="chip chip-accent">reference account</span>}
              <span className="t-micro">{account.countryName}</span>
              <span className="t-micro">· working language {account.workingLanguage}</span>
            </div>
            <h1 className="t-h1 mt-2.5">{account.displayName}</h1>
            <p className="t-micro mt-1 font-[family-name:var(--font-mono)]">{account.legalName}</p>
            <p className="t-body mt-4">{account.anchorComparison.value}</p>
            <div className="mt-2">
              <Citations rows={ev(account.anchorComparison.evidenceIds)} max={6} />
            </div>
          </div>

          <Panel className="min-w-[17rem] p-4">
            <p className="t-label">Identifiers</p>
            <div className="mt-2 space-y-1.5">
              {account.ticker && <Meta k="Listing" v={account.ticker} />}
              {account.secCik && <Meta k="SEC CIK" v={account.secCik} />}
              {account.domain && <Meta k="Domain" v={account.domain} />}
              <Meta k="Commodities" v={account.commodities.join(", ") || "not tagged"} />
            </div>
            {account.mailInfrastructure && (
              <div className="mt-3 border-t border-[var(--color-hair)] pt-3">
                <p className="t-label">Mail infrastructure</p>
                <p className="mt-1 text-[0.8rem]">
                  {account.mailInfrastructure.value}
                  <Citations rows={ev(account.mailInfrastructure.evidenceIds)} max={1} />
                </p>
                <p className="t-micro mt-1.5">
                  Read from live MX records. Gateways of this kind answer for the gateway rather than the
                  mailbox, so address verification is not attempted here.
                </p>
              </div>
            )}
          </Panel>
        </div>

        {/* ── Live proof, before anything asks to be believed ──────── */}
        <section className="mt-8">
          <LiveRun slug={account.slug} displayName={account.displayName} />
        </section>

        {/* ── The hand-off, above the analysis that justifies it ───── */}
        {run.briefs[account.id] && (
          <section className="mt-10">
            <AeBriefPanel brief={run.briefs[account.id]} account={account} evidenceFor={ev} />
          </section>
        )}

        {/* ── Terrain ──────────────────────────────────────────────── */}
        <section className="mt-12">
          <SectionHead
            label="Terrain · measured, not estimated"
            title="Where the work actually is"
            note="Each polygon is a real OpenStreetMap feature. Area and perimeter are computed geodesically from its geometry, and every figure links to the feature so it can be opened and checked."
            aside={
              <div className="flex gap-6">
                <Stat label="Sites" value={summary.siteCount} sub={summary.excludedCount ? `${summary.excludedCount} excluded` : undefined} />
                <Stat label="Mapped footprint" value={fmtKm2(summary.totalAreaKm2)} unit="km²" />
                <Stat label="Boundary" value={fmtKm2(summary.totalPerimeterKm)} unit="km" />
              </div>
            }
          />

          {/* Honest split between strong and weak attribution. */}
          {summary.clusteredSiteCount > 0 && (
            <div className="mb-4 rounded-[10px] bg-[var(--color-inferred-wash)] p-3 ring-1 ring-inset ring-[rgba(154,98,18,0.16)]">
              <p className="t-label" style={{ color: "var(--color-inferred)" }}>
                Attribution split
              </p>
              <p className="mt-1.5 text-[0.85rem]" style={{ color: "var(--color-inferred)" }}>
                <strong className="tnum">{fmtKm2(summary.attributedAreaKm2)} km²</strong> across{" "}
                {summary.attributedSiteCount} features carries an explicit operator or name match — the
                strong claim. A further{" "}
                <strong className="tnum">{fmtKm2(summary.clusteredAreaKm2)} km²</strong> across{" "}
                {summary.clusteredSiteCount} untagged adjacent features is attributed by proximity only, and
                is drawn dashed on the map. Treat the smaller figure as the defensible one in a first
                conversation.
              </p>
            </div>
          )}

          {activeSites.length > 0 ? (
            <>
              <Panel className="overflow-hidden p-1.5">
                <SiteMapClient
                  sites={account.sites}
                  focusOsmId={phase1?.osmId}
                  height={430}
                  maptilerKey={process.env.MAPTILER_KEY}
                />
              </Panel>

              <div className="x-scroll slim-scroll mt-4">
                <table className="w-full min-w-[46rem] border-collapse text-[0.83rem]">
                  <thead>
                    <tr className="border-b border-[var(--color-hair-2)] text-left">
                      <Th>Feature</Th>
                      <Th>Asset class</Th>
                      <Th right>Area km²</Th>
                      <Th right>Perimeter km</Th>
                      <Th>Coordinates</Th>
                      <Th>Attribution</Th>
                      <Th>Source</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...account.sites]
                      .sort((a, b) => b.areaKm2 - a.areaKm2)
                      .slice(0, 16)
                      .map((s) => (
                        <tr
                          key={s.osmId}
                          className={cx(
                            "border-b border-[var(--color-hair)]",
                            s.excluded && "opacity-50",
                          )}
                        >
                          <Td>
                            {s.name ?? <span className="opacity-60">unnamed</span>}
                            {s.osmId === phase1?.osmId && (
                              <span className="chip chip-accent ml-1.5">phase one</span>
                            )}
                            {s.excluded && (
                              <span className="chip chip-null ml-1.5" title={s.exclusionReason}>
                                excluded
                              </span>
                            )}
                          </Td>
                          <Td>{ASSET_CLASS_LABEL[s.assetClass] ?? s.assetClass}</Td>
                          <Td right mono>
                            {s.areaKm2.toFixed(3)}
                          </Td>
                          <Td right mono>
                            {s.perimeterKm.toFixed(2)}
                          </Td>
                          <Td mono>
                            {s.centroid.lat.toFixed(4)}, {s.centroid.lon.toFixed(4)}
                          </Td>
                          <Td>
                            <span
                              className={cx(
                                "chip",
                                s.attributionMethod === "proximity_cluster" ? "chip-inferred" : "chip-verified",
                              )}
                            >
                              {ATTRIBUTION_LABEL[s.attributionMethod] ?? s.attributionMethod}
                            </span>
                          </Td>
                          <Td>
                            {ev(s.evidenceIds).map((r) => (
                              <EvidenceChip key={r.id} row={r} compact />
                            ))}
                          </Td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              {account.sites.length > 16 && (
                <p className="t-micro mt-2">
                  Showing the 16 largest of {account.sites.length} measured features. The full set is in the
                  run artifact.
                </p>
              )}
            </>
          ) : (
            <Panel className="p-6">
              <Unsourced what="any mapped site geometry for this operator" />
              <p className="t-small mt-2">
                No mapped feature could be attributed to this operator in the sampled regions, so no
                footprint is claimed and the account cannot be sized.
              </p>
            </Panel>
          )}
        </section>

        {/* ── Opportunity sizing ───────────────────────────────────── */}
        {account.sizing && activeSites.length > 0 && (
          <section className="mt-14">
            <SectionHead
              label="Opportunity · derived from geometry"
              title="What a programme here looks like"
              note="Measured area and boundary, combined with an inspection cadence and published coverage behaviour, give a programme size. Ranges rather than single numbers, because every operational input is an assumption until a discovery call replaces it."
            />

            <div className="grid gap-6 lg:grid-cols-[1.15fr_1fr]">
              <div>
                <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
                  <RangeStat
                    label="Docks for full coverage"
                    low={account.sizing.docksRequired.low}
                    high={account.sizing.docksRequired.high}
                    unit="docks"
                  />
                  <RangeStat
                    label="Missions / month"
                    low={account.sizing.missionsPerMonth.low}
                    high={account.sizing.missionsPerMonth.high}
                    unit="missions"
                  />
                  <RangeStat
                    label="Flight hours / month"
                    low={account.sizing.flightHoursPerMonth.low}
                    high={account.sizing.flightHoursPerMonth.high}
                    unit="hrs"
                  />
                  <RangeStat
                    label="Crew-days displaced"
                    low={account.sizing.contractorCrewDaysDisplacedPerMonth.low}
                    high={account.sizing.contractorCrewDaysDisplacedPerMonth.high}
                    unit="/ month"
                  />
                </div>

                <Panel className="mt-5 p-4">
                  <p className="t-label">How that was derived</p>
                  <ol className="mt-2 space-y-2">
                    {account.sizing.derivation.map((line, i) => (
                      <li key={i} className="flex gap-2.5 text-[0.85rem] leading-[1.55]">
                        <span className="t-micro mt-0.5 shrink-0 font-[family-name:var(--font-mono)]">
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <span>{line}</span>
                      </li>
                    ))}
                  </ol>
                </Panel>

                <Panel className="mt-4 p-4" sunk>
                  <p className="t-label">What would make this wrong</p>
                  <ul className="mt-2 space-y-1.5">
                    {account.sizing.caveats.map((c) => (
                      <li key={c} className="t-small">
                        {c}
                      </li>
                    ))}
                  </ul>
                </Panel>
              </div>

              <Panel className="p-4">
                <p className="t-label">Assumptions · every input, stated</p>
                <div className="mt-2 divide-y divide-[var(--color-hair)]">
                  {account.sizing.assumptions.map((a) => (
                    <div key={a.key} className="py-2.5">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-[0.84rem]">{a.label}</span>
                        <span className="shrink-0 font-[family-name:var(--font-mono)] tnum text-[0.82rem]">
                          {a.value} {a.unit}
                        </span>
                      </div>
                      <p className="t-micro mt-1">
                        {a.basis}
                        <Citations rows={ev(a.evidenceIds)} max={2} />
                      </p>
                    </div>
                  ))}
                </div>
              </Panel>
            </div>
          </section>
        )}

        {/* ── Qualification ────────────────────────────────────────── */}
        <section className="mt-14">
          <SectionHead
            label="Qualification · deterministic"
            title="Why this account scores what it scores"
            note="A pure function with published weights, not a model's opinion. The contributions below sum to the total, so the arithmetic can be checked by hand."
          />
          <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
            <Panel className="p-5">
              <IcpWaterfall icp={account.icp} evidenceFor={ev} />
            </Panel>
            <Panel className="p-5" sunk>
              <p className="t-label">Read-out</p>
              <p className="t-body mt-2">{account.icp.tierRationale}</p>
              <p className="t-label mt-5">Anchor calibration</p>
              <p className="t-small mt-1.5">
                Every dimension is scored relative to {run.brief.referenceAccount}, whose own measured
                footprint and disclosed contractor dependency define parity. Scoring against the reference
                account rather than an abstract ideal is what makes the comparison meaningful.
              </p>
            </Panel>
          </div>
        </section>

        {/* ── Cross-verification ───────────────────────────────────── */}
        {(cv.corroborations.length > 0 || cv.conflicts.length > 0) && (
          <section className="mt-14">
            <SectionHead
              label="Cross-verification"
              title="What comparing the sources revealed"
              note="Facts here were not read in isolation. Where independent sources agree, the agreement is recorded; where they disagree, the disagreement is shown with a stated trust order rather than resolved quietly in favour of the more flattering number."
              aside={
                <div className="flex gap-6">
                  <Stat label="Corroborated" value={cv.stats.corroborated} sub="two or more sources" />
                  <Stat label="Single-sourced" value={cv.stats.singleSourced} sub="confirm before use" />
                  <Stat label="Conflicts" value={cv.stats.conflicts} sub="reconciled on screen" />
                </div>
              }
            />
            <CrossVerify cv={cv} />
          </section>
        )}

        {/* ── Risk-factor mining ───────────────────────────────────── */}
        {account.riskScan && (
          <section className="mt-14">
            <SectionHead
              label="Primary filing · risk-factor mining"
              title="The angle, in the prospect's own words"
              note="A deterministic scan of the company's own annual filing. Counting and quoting rather than summarising, so the language is theirs and the numbers are reproducible."
              aside={
                <a
                  href={account.riskScan.documentUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="chip chip-verified"
                >
                  {account.riskScan.documentLabel}
                </a>
              }
            />
            <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
              <Panel className="p-4">
                <p className="t-label">Term frequency in the filing</p>
                <div className="mt-2 space-y-1">
                  {Object.entries(account.riskScan.termCounts)
                    .filter(([, n]) => n > 0)
                    .sort((a, b) => b[1] - a[1])
                    .map(([term, n]) => (
                      <div key={term} className="flex items-baseline gap-2">
                        <span className="w-[10.5rem] shrink-0 truncate text-[0.82rem]">{term}</span>
                        <div className="h-[4px] flex-1 overflow-hidden rounded-full bg-[var(--color-panel-sunk)]">
                          <div
                            className="h-full rounded-full bg-[var(--color-accent)]"
                            style={{
                              width: `${Math.min(100, (n / Math.max(...Object.values(account.riskScan!.termCounts))) * 100)}%`,
                            }}
                          />
                        </div>
                        <span className="tnum w-7 shrink-0 text-right font-[family-name:var(--font-mono)] text-[0.78rem]">
                          {n}
                        </span>
                      </div>
                    ))}
                </div>

                {account.riskScan.absentTerms.length > 0 && (
                  <div className="mt-4 border-t border-[var(--color-hair)] pt-3">
                    <p className="t-label">Searched, found zero times</p>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {account.riskScan.absentTerms.map((t) => (
                        <span key={t} className="chip chip-null">
                          {t}
                        </span>
                      ))}
                    </div>
                    <p className="t-micro mt-2">
                      Absence is a signal in both directions: it says nothing about what the company does,
                      only about what it disclosed. Treated as an opening question, not a conclusion.
                    </p>
                  </div>
                )}
              </Panel>

              <div className="space-y-3">
                <Panel className="p-4" sunk>
                  <p className="t-label">Interpretation</p>
                  <p className="t-body mt-1.5">{account.riskScan.interpretation}</p>
                </Panel>
                {account.riskScan.passages.slice(0, 4).map((p, i) => {
                  const row = run.evidence[p.evidenceId];
                  return (
                    <Panel key={i} className="p-4">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="chip chip-accent">{p.term}</span>
                        {row && <EvidenceChip row={row} />}
                      </div>
                      <blockquote className="mt-2 border-l-2 border-[var(--color-hair-2)] pl-3 text-[0.85rem] leading-[1.6] text-[var(--color-ink-2)]">
                        “{p.verbatim}”
                      </blockquote>
                    </Panel>
                  );
                })}
              </div>
            </div>
          </section>
        )}

        {/* ── Signals ──────────────────────────────────────────────── */}
        {account.signals.length > 0 && (
          <section className="mt-14">
            <SectionHead
              label={`Timing · ${account.signals.length} signal${account.signals.length === 1 ? "" : "s"}`}
              title="Why now, and not last quarter"
              note="Dated, cited events that change whether this outreach is welcome. Each carries a read on what it means rather than the fact alone."
            />
            <div className="space-y-3">
              {[...account.signals]
                .sort((a, b) => b.urgency - a.urgency)
                .map((s) => {
                  const age = daysAgo(s.occurredAt);
                  return (
                    <Panel key={s.id} className="p-4">
                      <div className="flex flex-wrap items-baseline justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="chip chip-accent">{s.kind.replace(/_/g, " ")}</span>
                          {age !== null && (
                            <span className={cx("chip", age <= 45 ? "chip-verified" : "chip-null")}>
                              {age} days ago
                            </span>
                          )}
                          {s.occurredAt && <span className="t-micro">{fmtDate(s.occurredAt)}</span>}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="t-micro">urgency</span>
                          <div className="h-[4px] w-16 overflow-hidden rounded-full bg-[var(--color-panel-sunk)]">
                            <div
                              className="h-full rounded-full bg-[var(--color-accent)]"
                              style={{ width: `${s.urgency * 100}%` }}
                            />
                          </div>
                          <Citations rows={ev(s.evidenceIds)} max={2} />
                        </div>
                      </div>
                      <p className="mt-2 text-[0.9rem] font-[560]">{s.headline}</p>
                      <p className="t-small mt-1.5 max-w-4xl">{s.soWhat}</p>
                    </Panel>
                  );
                })}
            </div>
          </section>
        )}

        {/* ── Stakeholders ─────────────────────────────────────────── */}
        <section className="mt-14">
          <SectionHead
            label={`Buying committee · ${named.length} named, ${roleTargets.length} role target${roleTargets.length === 1 ? "" : "s"}`}
            title="Who to reach, and how we know they exist"
            note="A name only appears here if it was read from a page we fetched, with the verbatim title and a link to that page. Where no individual could be found we state the role and how to find them rather than inventing anyone."
          />

          <div className="grid gap-3 md:grid-cols-2">
            {named.map((c) => {
              const site = c.siteOsmId ? account.sites.find((s) => s.osmId === c.siteOsmId) : undefined;
              return (
                <Panel key={c.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[0.95rem] font-[600]">{c.name}</p>
                      <p className="t-small mt-0.5 italic">{c.titleVerbatim}</p>
                      {c.titleEnglish && c.titleEnglish !== c.titleVerbatim && (
                        <p className="t-micro mt-0.5">{c.titleEnglish}</p>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className="chip chip-verified">named · sourced</span>
                      <span className="chip chip-null">{BUYING_ROLE_LABEL[c.buyingRole]}</span>
                    </div>
                  </div>

                  {site && (
                    <div className="mt-2.5 rounded-[8px] bg-[var(--color-accent-wash)] px-2.5 py-2">
                      <p className="text-[0.8rem] text-[var(--color-accent-ink)]">
                        Runs <strong>{site.name ?? site.osmId}</strong> —{" "}
                        <span className="tnum">{site.areaKm2.toFixed(2)} km²</span> of mapped footprint,{" "}
                        <span className="tnum">{site.perimeterKm.toFixed(1)} km</span> of boundary.
                      </p>
                      <p className="t-micro mt-0.5" style={{ color: "var(--color-accent-ink)" }}>
                        This is the pairing that makes the outreach specific: a named leader beside the
                        measured extent of the operation they own.
                      </p>
                    </div>
                  )}

                  {c.findingPlaybook?.length ? (
                    <ul className="mt-2.5 space-y-1">
                      {c.findingPlaybook.map((p, i) => (
                        <li key={i} className="t-micro">
                          {p}
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  <div className="mt-2.5 flex items-center gap-2 border-t border-[var(--color-hair)] pt-2">
                    <Citations rows={ev(c.evidenceIds)} max={3} />
                    {c.email ? (
                      <span className={cx("chip", c.email.status === "OBSERVED" ? "chip-verified" : "chip-inferred")}>
                        {c.email.status === "OBSERVED" ? c.email.address : "address inferred — not sendable"}
                      </span>
                    ) : (
                      <span className="chip chip-null">no address sourced</span>
                    )}
                  </div>
                </Panel>
              );
            })}
          </div>

          {roleTargets.length > 0 && (
            <div className="mt-4">
              <p className="t-label">Role targets — no individual found</p>
              <p className="t-small mt-1.5 max-w-3xl">
                These are deliberately nameless. The role is right and the buying position is unchanged, but
                no public source named the holder during this run. A plausible-looking invented name would
                score better and be worthless.
              </p>
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                {roleTargets.map((c) => (
                  <Panel key={c.id} className="p-4" sunk>
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-[0.88rem] font-[560]">{c.targetRole}</p>
                      <span className="chip chip-null">no name</span>
                    </div>
                    <p className="t-micro mt-1">{BUYING_ROLE_LABEL[c.buyingRole]}</p>
                    {c.findingPlaybook?.length ? (
                      <ol className="mt-2 space-y-1">
                        {c.findingPlaybook.map((p, i) => (
                          <li key={i} className="t-micro flex gap-1.5">
                            <span className="opacity-50">{i + 1}.</span>
                            <span>{p}</span>
                          </li>
                        ))}
                      </ol>
                    ) : null}
                  </Panel>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* ── Regulatory context ───────────────────────────────────── */}
        {pack.regulatoryRegimes.filter((r) => r.country === account.country).length > 0 && (
          <section className="mt-14">
            <SectionHead
              label="Regulatory context"
              title="What forces the inspection to happen"
              note="Naming the instrument an HSE lead answers to is the highest-signal specificity available — and a wrong decree number is worse than none, so an instrument is only quoted in generated copy once its text has been fetched."
            />
            <div className="grid gap-3 md:grid-cols-2">
              {pack.regulatoryRegimes
                .filter((r) => r.country === account.country)
                .map((r) => (
                  <Panel key={r.instrument} className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-[0.88rem] font-[560]">{r.instrument}</p>
                      {r.sourceUrl ? (
                        <a href={r.sourceUrl} target="_blank" rel="noopener noreferrer" className="chip chip-verified">
                          text fetched
                        </a>
                      ) : (
                        <span
                          className="chip chip-inferred"
                          title="Held back from generated copy until the instrument's text has been fetched and cited."
                        >
                          not yet sourced
                        </span>
                      )}
                    </div>
                    <p className="t-small mt-1.5">{r.obligation}</p>
                  </Panel>
                ))}
            </div>
          </section>
        )}

        {/* ── Outreach ─────────────────────────────────────────────── */}
        <section className="mt-14">
          <SectionHead
            label="Outreach · generated, then adversarially checked"
            title="The messages, and everything the critic threw away"
            note="A deterministic strategist chooses which of the account's own facts to lead with; a model phrases it; a critic then tries to reject the result against mechanical gates. Rejected drafts are shown because they are the proof that a machine wrote this and that something checked it."
            aside={
              <div className="flex gap-6">
                <Stat label="Passed" value={run.stats.emailsAccepted} sub="score 85 or above" />
                <Stat label="Rejected" value={run.stats.emailsRejected} sub="kept on the record" />
              </div>
            }
          />
          <Outreach
            account={account}
            cadence={run.cadences[account.id] ?? []}
            draftsByContact={outreach?.drafts ?? {}}
            strategies={outreach?.strategies ?? {}}
            evidenceFor={ev}
          />
        </section>

        {/* ── Handoff ──────────────────────────────────────────────── */}
        <section className="mt-14">
          <SectionHead
            label="Handoff"
            title="Take it into the tools you already use"
            note="Exports are CRM-shaped. Any address that was only inferred is excluded from the sendable column rather than quietly included."
          />
          <ExportBar slug={account.slug} displayName={account.displayName} />
        </section>

        {/* ── Gaps ─────────────────────────────────────────────────── */}
        {accountNulls.length > 0 && (
          <section className="mt-14">
            <SectionHead
              label={`Gaps · ${accountNulls.length}`}
              title="What the pipeline could not establish"
              note="Recorded rather than papered over. A system that reports only its successes cannot be audited."
            />
            <div className="space-y-3">
              {accountNulls.map((n) => (
                <Panel key={n.id} className="p-4" sunk>
                  <p className="text-[0.88rem] font-[560]">{n.question}</p>
                  <div className="mt-2 space-y-1">
                    {n.attempts.map((a, i) => (
                      <p key={i} className="t-micro font-[family-name:var(--font-mono)]">
                        {a.source}
                        {a.url ? ` · ${a.url}` : ""} → {a.outcome}
                      </p>
                    ))}
                  </div>
                  <p className="t-small mt-2">{n.interpretation}</p>
                  <p className="t-small mt-1.5">
                    <span className="t-label">Fix · </span>
                    {n.remediation}
                  </p>
                </Panel>
              ))}
            </div>
          </section>
        )}
      </main>
      <Footer attribution={meta?.attribution} />
    </>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th className={cx("t-label pb-2 pr-3 font-normal", right && "text-right")}>{children}</th>
  );
}

function Td({
  children,
  right,
  mono,
}: {
  children: React.ReactNode;
  right?: boolean;
  mono?: boolean;
}) {
  return (
    <td
      className={cx(
        "py-2 pr-3 align-top",
        right && "text-right",
        mono && "font-[family-name:var(--font-mono)] tnum text-[0.78rem]",
      )}
    >
      {children}
    </td>
  );
}

function Meta({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="t-micro">{k}</span>
      <span className="font-[family-name:var(--font-mono)] text-[0.76rem]">{v}</span>
    </div>
  );
}
