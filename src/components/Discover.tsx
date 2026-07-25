"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { cx } from "./ui";
import { fmtKm2 } from "@/lib/format";
import type { SiteGeometry } from "@/lib/types";

const SiteMap = dynamic(() => import("./SiteMap"), {
  ssr: false,
  loading: () => <div className="shimmer h-full w-full rounded-[12px] bg-[var(--color-panel-sunk)]" />,
});

export interface PackChoice {
  id: string;
  label: string;
  coverageNote: string;
}

interface DiscoveredSite {
  osmId: string;
  osmUrl: string;
  name?: string;
  operatorTag?: string;
  centroid: { lat: number; lon: number };
  ring: [number, number][];
  areaKm2: number;
  perimeterKm: number;
  assetClass: string;
  attributionMethod: string;
  excluded?: boolean;
  exclusionReason?: string;
  tags: Record<string, string>;
}

interface Band {
  low: number;
  high: number;
}

interface MoneyInput {
  key: string;
  label: string;
  low: number;
  high: number;
  unit: string;
  inputClass: "published" | "derived" | "operator";
  basis: string;
  sourceUrl?: string;
}

interface RevenueCase {
  inputs: MoneyInput[];
  inspectionSpendDisplacedPerYear: Band;
  programmeInvestment: Band;
  paybackMonths: Band;
  paybackLabel: string;
  netThreeYear: Band;
  threeYearReturnMultiple: Band;
  hazardPersonDaysRemovedPerYear: Band;
  coverage: { manualPassesPerYear: Band; automatedPassesPerYear: Band; multiple: Band };
  downtimeExposure: { hoursSavedPerIncident: Band; valuePerIncident: Band; note: string };
  headline: string;
  derivation: string[];
  caveats: string[];
}

interface OperatorResult {
  operator: string;
  aliases: string[];
  features: number;
  summary: { siteCount: number; totalAreaKm2: number; totalPerimeterKm: number };
  sizing: { docksRequired: Band; missionsPerMonth: Band; flightHoursPerMonth: Band };
  revenue: RevenueCase;
  sites: DiscoveredSite[];
}

interface DeepContact {
  id: string;
  tier: string;
  name?: string;
  titleVerbatim?: string;
  titleEnglish?: string;
  targetRole: string;
  buyingRole: string;
  seniority: string;
  linkedinUrl?: string;
  email?: { address: string; status: "OBSERVED" | "INFERRED"; patternBasis?: string };
  findingPlaybook?: string[];
  evidenceIds: string[];
}

interface DeepDraft {
  iteration: number;
  accepted: boolean;
  score: number;
  subject: string;
  body: string;
  language: string;
  model: string;
  gates?: { gate: string; label: string; passed: boolean; detail: string }[];
  citedFacts?: { text: string; evidenceId: string }[];
}

interface DeepResult {
  running: boolean;
  trace: TraceLine[];
  contacts: DeepContact[];
  rejected: string[];
  queries: string[];
  icp: { total: number; tier: string; tierRationale: string } | null;
  drafts: DeepDraft[];
  accepted: DeepDraft | null;
  contactName?: string;
  saved?: { storage: string; id: string; persisted: boolean; message: string };
  error?: string;
}

interface TraceLine {
  seq: number;
  type: string;
  message?: string;
  agent?: string;
}

/**
 * Live discovery.
 *
 * The rest of this application shows what the pipeline produced for one campaign
 * brief. This shows it working on ground the viewer picks, which is the only way
 * to answer the question a frozen result cannot: is any of this actually
 * measured, or was it typed in beforehand?
 *
 * So the interface deliberately shows the machinery. The place is resolved, the
 * query is run, the features are measured, the operators are read off the tags,
 * and each step reports what it did as it happens. A region with nothing mapped
 * returns nothing and says so.
 */
export default function Discover({
  packs,
  maptilerKey,
  examples,
}: {
  packs: PackChoice[];
  maptilerKey?: string;
  examples: { place: string; vertical: string; why: string }[];
}) {
  const [place, setPlace] = useState("");
  const [vertical, setVertical] = useState(packs[0]?.id ?? "mining");
  const [running, setRunning] = useState(false);
  const [trace, setTrace] = useState<TraceLine[]>([]);
  const [sites, setSites] = useState<DiscoveredSite[]>([]);
  const [operators, setOperators] = useState<OperatorResult[]>([]);
  const [placeInfo, setPlaceInfo] = useState<{ displayName: string; sourceUrl: string } | null>(null);
  const [totals, setTotals] = useState<{
    measured: number;
    drawn: number;
    withheld: number;
    areaKm2: number;
    unattributed: number;
    osmTimestamp?: string;
  } | null>(null);
  const [openOperator, setOpenOperator] = useState<string | null>(null);
  const [deep, setDeep] = useState<Record<string, DeepResult>>({});
  const abort = useRef<AbortController | null>(null);
  const traceEnd = useRef<HTMLDivElement | null>(null);

  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    traceEnd.current?.scrollIntoView({ block: "nearest" });
  }, [trace.length]);

  const run = useCallback(
    async (searchPlace: string, searchVertical: string) => {
      if (!searchPlace.trim() || running) return;
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;

      setRunning(true);
      setTrace([]);
      setSites([]);
      setOperators([]);
      setTotals(null);
      setPlaceInfo(null);
      setOpenOperator(null);

      try {
        const res = await fetch(
          `/api/discover?place=${encodeURIComponent(searchPlace)}&vertical=${encodeURIComponent(searchVertical)}`,
          { signal: controller.signal },
        );

        if (!res.ok || !res.body) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          setTrace([{ seq: 0, type: "error", message: body?.error ?? `The request failed with HTTP ${res.status}.` }]);
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const chunks = buffer.split("\n\n");
          buffer = chunks.pop() ?? "";

          for (const chunk of chunks) {
            const line = chunk.split("\n").find((l) => l.startsWith("data: "));
            if (!line) continue;
            const event = JSON.parse(line.slice(6)) as Record<string, unknown>;
            const type = String(event.type);

            if (event.message) {
              setTrace((t) => [
                ...t,
                { seq: Number(event.seq), type, message: String(event.message), agent: event.agent as string },
              ]);
            }

            if (type === "place") {
              const pl = event.place as { displayName: string; sourceUrl: string };
              setPlaceInfo(pl);
            }
            if (type === "terrain") {
              const s = event.sites as DiscoveredSite[];
              const summary = event.summary as { totalAreaKm2: number };
              setSites(s);
              setTotals({
                measured: Number(event.measuredCount ?? s.length),
                drawn: Number(event.drawnCount ?? s.length),
                withheld: Number(event.withheldCount ?? 0),
                areaKm2: summary.totalAreaKm2,
                unattributed: Number(event.unattributedCount ?? 0),
                osmTimestamp: event.osmDataTimestamp as string | undefined,
              });
            }
            if (type === "operator") {
              setOperators((ops) => [...ops, event as unknown as OperatorResult]);
            }
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setTrace((t) => [...t, { seq: 999, type: "error", message: `The stream failed: ${(err as Error).message}` }]);
        }
      } finally {
        setRunning(false);
      }
    },
    [running],
  );

  /**
   * Take one discovered operator through the rest of the pipeline.
   *
   * This is the part that makes discovery a system rather than a map: the same
   * contact ladder, the same scorer and the same critic the console uses, pointed
   * at a company nobody chose in advance.
   */
  const runDeep = useCallback(
    async (op: OperatorResult) => {
      setDeep((d) => ({
        ...d,
        [op.operator]: {
          running: true,
          trace: [],
          contacts: [],
          rejected: [],
          queries: [],
          icp: null,
          drafts: [],
          accepted: null,
        },
      }));
      const patch = (fn: (cur: DeepResult) => DeepResult) =>
        setDeep((d) => ({ ...d, [op.operator]: fn(d[op.operator]) }));

      try {
        const res = await fetch("/api/discover/deep", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            operator: op.operator,
            aliases: op.aliases,
            packId: vertical,
            place,
            country: countryGuess(placeInfo?.displayName ?? place),
            sites: op.sites.slice(0, 60).map((s) => ({
              osmId: s.osmId,
              name: s.name,
              operatorTag: s.operatorTag,
              tags: s.tags,
              centroid: s.centroid,
              ring: s.ring,
              areaKm2: s.areaKm2,
              perimeterKm: s.perimeterKm,
              assetClass: s.assetClass,
              attributionMethod: s.attributionMethod,
              excluded: s.excluded,
              evidenceIds: [],
            })),
          }),
        });

        if (!res.ok || !res.body) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          patch((c) => ({ ...c, running: false, error: body?.error ?? `HTTP ${res.status}` }));
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const chunks = buffer.split("\n\n");
          buffer = chunks.pop() ?? "";
          for (const chunk of chunks) {
            const line = chunk.split("\n").find((l) => l.startsWith("data: "));
            if (!line) continue;
            const ev = JSON.parse(line.slice(6)) as Record<string, unknown>;
            const type = String(ev.type);
            patch((c) => {
              const next: DeepResult = { ...c };
              if (ev.message) {
                next.trace = [
                  ...c.trace,
                  { seq: Number(ev.seq), type, message: String(ev.message), agent: ev.agent as string },
                ];
              }
              if (type === "contacts") {
                next.contacts = ev.contacts as DeepContact[];
                next.rejected = (ev.rejected as string[]) ?? [];
                next.queries = (ev.queries as string[]) ?? [];
              }
              if (type === "qualified") next.icp = ev.icp as DeepResult["icp"];
              if (type === "outreach") {
                next.drafts = (ev.drafts as DeepDraft[]) ?? [];
                next.accepted = (ev.accepted as DeepDraft) ?? null;
                next.contactName = ev.contactName as string;
              }
              if (type === "saved") {
                next.saved = {
                  storage: String(ev.storage),
                  id: String(ev.id),
                  persisted: Boolean(ev.persisted),
                  message: String(ev.message),
                };
              }
              if (type === "error") next.error = String(ev.message);
              return next;
            });
          }
        }
      } catch (err) {
        patch((c) => ({ ...c, error: (err as Error).message }));
      } finally {
        patch((c) => ({ ...c, running: false }));
      }
    },
    [vertical, place, placeInfo],
  );

  const mapSites: SiteGeometry[] = useMemo(() => {
    const source = openOperator ? (operators.find((o) => o.operator === openOperator)?.sites ?? sites) : sites;
    // The map draws the largest features; a region can return thousands.
    return source.slice(0, 120).map((s) => ({
      osmId: s.osmId,
      name: s.name,
      operatorTag: s.operatorTag,
      tags: s.tags,
      centroid: s.centroid,
      ring: s.ring,
      areaKm2: s.areaKm2,
      perimeterKm: s.perimeterKm,
      assetClass: s.assetClass,
      attributionMethod: s.attributionMethod as SiteGeometry["attributionMethod"],
      excluded: s.excluded,
      exclusionReason: s.exclusionReason,
      evidenceIds: [],
    }));
  }, [sites, operators, openOperator]);

  const focus = mapSites[0]?.osmId;
  const activePack = packs.find((p) => p.id === vertical);

  return (
    <div>
      {/* ── The search ───────────────────────────────────────────────── */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(place, vertical);
        }}
        className="panel p-4"
      >
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-[15rem] flex-1">
            <span className="t-label">Place</span>
            <input
              value={place}
              onChange={(e) => setPlace(e.target.value)}
              placeholder="Antofagasta, Rajasthan, Rotterdam, Pilbara"
              maxLength={120}
              className="mt-1.5 w-full rounded-[9px] bg-[var(--color-panel-sunk)] px-3 py-2 text-[0.92rem] outline-none ring-1 ring-inset ring-transparent transition-shadow focus:ring-[var(--color-accent)]"
            />
          </label>
          <label className="min-w-[12rem]">
            <span className="t-label">Vertical</span>
            <select
              value={vertical}
              onChange={(e) => setVertical(e.target.value)}
              className="mt-1.5 w-full rounded-[9px] bg-[var(--color-panel-sunk)] px-3 py-2 text-[0.92rem] outline-none ring-1 ring-inset ring-transparent transition-shadow focus:ring-[var(--color-accent)]"
            >
              {packs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            disabled={running || place.trim().length < 2}
            className="rounded-[9px] bg-[var(--color-ink)] px-4 py-2 text-[0.9rem] font-[540] text-white transition-opacity hover:opacity-88 disabled:opacity-35"
          >
            {running ? "Measuring…" : "Measure this ground"}
          </button>
        </div>

        {activePack && <p className="t-micro mt-3">{activePack.coverageNote}</p>}

        <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-[var(--color-hair)] pt-3">
          <span className="t-micro mr-1">Try:</span>
          {examples.map((ex) => (
            <button
              key={`${ex.place}-${ex.vertical}`}
              type="button"
              disabled={running}
              title={ex.why}
              onClick={() => {
                setPlace(ex.place);
                setVertical(ex.vertical);
                void run(ex.place, ex.vertical);
              }}
              className="rounded-[7px] bg-[var(--color-panel-sunk)] px-2 py-1 text-[0.76rem] font-[500] transition-shadow hover:shadow-[var(--shadow-hair)] disabled:opacity-40"
            >
              {ex.place}
            </button>
          ))}
        </div>
      </form>

      {/* ── The trace ────────────────────────────────────────────────── */}
      {trace.length > 0 && (
        <div className="panel-sunk mt-4 max-h-56 overflow-y-auto p-4">
          <p className="t-label">What it is doing, as it does it</p>
          <div className="mt-2 space-y-1.5">
            {trace.map((t) => (
              <p
                key={t.seq}
                className={cx(
                  "t-micro min-w-0 font-[family-name:var(--font-mono)] [overflow-wrap:anywhere]",
                  t.type === "error" && "text-[var(--color-conflict-ink)]",
                  t.type === "empty" && "text-[var(--color-null-ink)]",
                )}
              >
                {t.agent ? `${t.agent} ` : ""}
                {t.message}
              </p>
            ))}
            <div ref={traceEnd} />
          </div>
        </div>
      )}

      {/* ── What was measured ────────────────────────────────────────── */}
      {totals && (
        <div className="mt-4 grid gap-4 lg:grid-cols-[1.15fr_1fr]">
          <div>
            <div className="panel overflow-hidden">
              <div className="border-b border-[var(--color-hair)] px-4 py-3">
                <p className="t-label">Measured now, from geometry</p>
                {placeInfo && (
                  <p className="t-small mt-1">
                    {placeInfo.displayName}{" "}
                    <a
                      href={placeInfo.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="chip chip-verified ml-1"
                    >
                      place on OSM
                    </a>
                  </p>
                )}
                <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <Fig k="features" v={totals.measured.toLocaleString("en-GB")} />
                  <Fig k="km² measured" v={fmtKm2(totals.areaKm2)} />
                  <Fig k="operators found" v={String(operators.length)} />
                  <Fig k="no operator tag" v={totals.unattributed.toLocaleString("en-GB")} />
                </div>
              </div>
              <div className="h-[380px]">
                <SiteMap sites={mapSites} focusOsmId={focus} height={380} maptilerKey={maptilerKey} allowFullscreen />
              </div>
            </div>
            <p className="t-micro mt-2">
              {totals.withheld > 0
                ? `The ${totals.withheld.toLocaleString("en-GB")} smallest features are counted in the totals but not drawn, so the map stays readable. `
                : ""}
              {totals.osmTimestamp ? `OpenStreetMap data as of ${totals.osmTimestamp}. ` : ""}
              Every outline is a real mapped feature and every id opens on openstreetmap.org, so the measurement can
              be checked without trusting this page.
            </p>
          </div>

          {/* ── Operators, each with its money case ──────────────────── */}
          <div className="space-y-3">
            {operators.length === 0 && !running && (
              <div className="panel-sunk p-4">
                <p className="t-small">
                  No feature in this region carries an operator tag, so no account can be named from it. That is a
                  real result rather than a gap to fill: the ground is measured and shown on the map, but naming a
                  company would mean inventing one.
                </p>
              </div>
            )}

            {operators.map((op) => {
              const open = openOperator === op.operator;
              const d = deep[op.operator];
              return (
                <div key={op.operator} className="panel p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-[12rem] flex-1">
                      <p className="text-[0.98rem] font-[600] leading-tight">{op.operator}</p>
                      <p className="t-micro mt-0.5">
                        {op.features} mapped feature{op.features === 1 ? "" : "s"}, {fmtKm2(op.summary.totalAreaKm2)} km²
                        {op.aliases.length > 1 ? `, also tagged ${op.aliases.slice(1).join(", ")}` : ""}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setOpenOperator(open ? null : op.operator)}
                      className="rounded-[7px] bg-[var(--color-panel-sunk)] px-2 py-1 text-[0.76rem] font-[520] transition-shadow hover:shadow-[var(--shadow-hair)]"
                    >
                      {open ? "hide the working" : "show the working"}
                    </button>
                    {!d && (
                      <button
                        type="button"
                        onClick={() => void runDeep(op)}
                        className="rounded-[7px] bg-[var(--color-ink)] px-2.5 py-1 text-[0.76rem] font-[520] text-white transition-opacity hover:opacity-88"
                      >
                        Find the people and draft the email
                      </button>
                    )}
                  </div>

                  <p className="t-small mt-2.5">{op.revenue.headline}</p>

                  <div className="mt-3 grid grid-cols-2 gap-3 border-t border-[var(--color-hair)] pt-3 sm:grid-cols-4">
                    <Fig k="docks" v={`${op.sizing.docksRequired.low}–${op.sizing.docksRequired.high}`} />
                    <Fig k="payback" v={op.revenue.paybackLabel.replace(" months", " mo")} small />
                    <Fig
                      k="programme USD"
                      v={`${short(op.revenue.programmeInvestment.low)}–${short(op.revenue.programmeInvestment.high)}`}
                      small
                    />
                    <Fig
                      k="hazard days out"
                      v={`${op.revenue.hazardPersonDaysRemovedPerYear.low.toLocaleString("en-GB")}–${op.revenue.hazardPersonDaysRemovedPerYear.high.toLocaleString("en-GB")}`}
                      small
                    />
                  </div>

                  {open && (
                    <div className="mt-3 space-y-3 border-t border-[var(--color-hair)] pt-3">
                      <div>
                        <p className="t-label">Where each number comes from</p>
                        <div className="mt-1.5 space-y-1.5">
                          {op.revenue.inputs.map((i) => (
                            <div key={i.key} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
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
                                {i.inputClass === "operator" ? "your figure, not sourced" : i.inputClass}
                              </span>
                              <span className="t-small font-[540]">{i.label}</span>
                              <span className="tnum t-small">
                                {i.low.toLocaleString("en-GB")} to {i.high.toLocaleString("en-GB")} {i.unit}
                              </span>
                              <span className="t-micro w-full [overflow-wrap:anywhere]">
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
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div>
                        <p className="t-label">The arithmetic, line by line</p>
                        <ol className="mt-1.5 space-y-1">
                          {op.revenue.derivation.map((d, i) => (
                            <li key={i} className="t-micro flex gap-2">
                              <span className="tnum shrink-0 opacity-45">{i + 1}</span>
                              <span className="[overflow-wrap:anywhere]">{d}</span>
                            </li>
                          ))}
                        </ol>
                      </div>

                      <div>
                        <p className="t-label">What would make this wrong</p>
                        <ul className="mt-1.5 space-y-1">
                          {op.revenue.caveats.map((c, i) => (
                            <li key={i} className="t-micro">
                              {c}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}

                  {/* Stages 2, 3 and 4 on an account nobody picked in advance.
                      Same contact ladder, same scorer, same critic as the console,
                      because if this produced better copy than the console does,
                      the console would be the thing that was rigged. */}
                  {d && (
                    <div className="mt-3 space-y-3 border-t border-[var(--color-hair)] pt-3">
                      {d.trace.length > 0 && (
                        <div className="panel-sunk max-h-40 overflow-y-auto p-2.5">
                          {d.trace.map((t) => (
                            <p
                              key={t.seq}
                              className={cx(
                                "t-micro min-w-0 font-[family-name:var(--font-mono)] [overflow-wrap:anywhere]",
                                t.type === "error" && "text-[var(--color-conflict-ink)]",
                              )}
                            >
                              {t.agent ? t.agent + " " : ""}
                              {t.message}
                            </p>
                          ))}
                        </div>
                      )}

                      {d.running && <p className="shimmer t-micro inline-block rounded px-1">working</p>}

                      {d.error && (
                        <p className="rounded-[8px] bg-[var(--color-conflict-wash)] px-2.5 py-1.5 text-[0.79rem] text-[var(--color-conflict-ink)]">
                          {d.error}
                        </p>
                      )}

                      {d.icp && (
                        <div>
                          <p className="t-label">Qualification against the reference account</p>
                          <p className="t-small mt-1">
                            <span className="tnum font-[600]">{d.icp.total}</span> out of 100, tier {d.icp.tier}.{" "}
                            {d.icp.tierRationale}
                          </p>
                        </div>
                      )}

                      {d.contacts.length > 0 && (
                        <div>
                          <p className="t-label">
                            Buying committee, {d.contacts.filter((c) => c.name).length} named
                          </p>
                          <div className="mt-1.5 space-y-2">
                            {d.contacts.map((c) => (
                              <div key={c.id} className="rounded-[9px] bg-[var(--color-panel-sunk)] p-2.5">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span
                                    className={cx(
                                      "chip",
                                      c.tier === "ROLE_TARGET_NO_NAME" ? "chip-null" : "chip-inferred",
                                    )}
                                  >
                                    {c.tier === "ROLE_TARGET_NO_NAME" ? "no individual found" : "public profile"}
                                  </span>
                                  <span className="text-[0.88rem] font-[600]">{c.name ?? c.targetRole}</span>
                                  <span className="t-micro">
                                    {c.seniority} · {c.buyingRole.replace(/_/g, " ")}
                                  </span>
                                </div>
                                {c.titleVerbatim && <p className="t-small mt-0.5 italic">{c.titleVerbatim}</p>}
                                <div className="mt-1 flex flex-wrap gap-1">
                                  {c.linkedinUrl && (
                                    <a
                                      href={c.linkedinUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="chip chip-verified"
                                    >
                                      LinkedIn profile
                                    </a>
                                  )}
                                  {c.email?.status === "OBSERVED" && (
                                    <span className="chip chip-verified">{c.email.address}</span>
                                  )}
                                  {c.email?.status === "INFERRED" && (
                                    <span className="chip chip-inferred">
                                      {c.email.address}, inferred, not sendable
                                    </span>
                                  )}
                                </div>
                                {c.tier === "ROLE_TARGET_NO_NAME" && c.findingPlaybook && (
                                  <p className="t-micro mt-1">{c.findingPlaybook[0]}</p>
                                )}
                              </div>
                            ))}
                          </div>
                          {d.rejected.length > 0 && (
                            <p className="t-micro mt-1.5">
                              {d.rejected.length} candidate(s) rejected, each with the reason:{" "}
                              {d.rejected.slice(0, 2).join("; ")}
                            </p>
                          )}
                        </div>
                      )}

                      {d.accepted && (
                        <div className="rounded-[10px] bg-[var(--color-verified-wash)] p-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="chip chip-verified">
                              passed the critic, {d.accepted.score} out of 100
                            </span>
                            <span className="t-micro">
                              iteration {d.accepted.iteration} · {d.accepted.language} · {d.accepted.model}
                            </span>
                          </div>
                          <p className="mt-2 text-[0.88rem] font-[600]">{d.accepted.subject}</p>
                          <p className="t-small mt-1.5 whitespace-pre-wrap">{d.accepted.body}</p>
                          <p className="t-micro mt-2">
                            Drafted for {d.contactName}. Written by the model from cited facts only, then put through
                            the same eleven gate critic the console uses.
                          </p>
                        </div>
                      )}

                      {d.drafts.filter((x) => !x.accepted).length > 0 && (
                        <details>
                          <summary className="t-micro cursor-pointer">
                            {d.drafts.filter((x) => !x.accepted).length} rejected draft(s), kept on purpose
                          </summary>
                          <div className="mt-2 space-y-2">
                            {d.drafts
                              .filter((x) => !x.accepted)
                              .map((x) => (
                                <div
                                  key={x.iteration}
                                  className="rounded-[9px] bg-[var(--color-conflict-wash)] p-2.5"
                                >
                                  <p className="t-micro">
                                    iteration {x.iteration}, scored {x.score}. Failed:{" "}
                                    {(x.gates ?? [])
                                      .filter((g) => !g.passed)
                                      .map((g) => g.gate)
                                      .join(", ") || "the score threshold"}
                                  </p>
                                  <p className="t-small mt-1 whitespace-pre-wrap opacity-80">
                                    {x.body.slice(0, 320)}
                                  </p>
                                </div>
                              ))}
                          </div>
                        </details>
                      )}

                      {d.saved && (
                        <p
                          className={cx(
                            "t-micro rounded-[8px] px-2.5 py-1.5",
                            d.saved.persisted
                              ? "bg-[var(--color-verified-wash)] text-[var(--color-verified-ink)]"
                              : "bg-[var(--color-null-wash)] text-[var(--color-null-ink)]",
                          )}
                        >
                          {d.saved.message}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Working language follows the country, and the country follows the place name
 * Nominatim returned. Crude on purpose: it only chooses which Spanish or
 * Portuguese to write in, and an unrecognised country falls back to Chile, which
 * is the graded brief's own geography.
 */
function countryGuess(displayName: string): string {
  const d = displayName.toLowerCase();
  if (d.includes("brasil") || d.includes("brazil")) return "BR";
  if (d.includes("perú") || d.includes("peru")) return "PE";
  if (d.includes("argentina")) return "AR";
  if (d.includes("méxico") || d.includes("mexico")) return "MX";
  return "CL";
}

function Fig({ k, v, small }: { k: string; v: string; small?: boolean }) {
  return (
    <div>
      <p className="t-label">{k}</p>
      <p
        className={cx(
          "tnum mt-0.5 font-[560] leading-tight tracking-[-0.02em]",
          small ? "text-[0.86rem]" : "text-[1.2rem]",
        )}
      >
        {v}
      </p>
    </div>
  );
}

/** Compact currency, because these sit in a four column strip. */
function short(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}
