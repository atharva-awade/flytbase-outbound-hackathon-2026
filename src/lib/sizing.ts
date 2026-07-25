/**
 * Opportunity Engineer.
 *
 * Converts measured terrain into a deployment estimate an AE can defend in a
 * room. This is the piece that turns "here is a company" into "here is the
 * size of the programme and the crew hours it displaces".
 *
 * Two honesty rules are structural, not cosmetic:
 *
 *  1. Every input is an explicit, labelled assumption with a stated basis, and
 *     the UI lets the operator change it. Nothing is buried in a constant.
 *  2. Outputs are ranges. A single confident number derived from assumptions
 *     would be false precision, and false precision is how a good pitch dies
 *     under questioning.
 *
 * The phasing mirrors FlytBase's own published SQM deployment, which began with
 * one dock on one zone for one use case at USD 70–80k total system investment
 * and reached ROI inside a year. Presenting a single-dock phase one is both
 * more credible and closer to how the reference customer actually bought.
 */

import type { OpportunitySizing, SiteGeometry } from "./types";
import type { VerticalPack } from "./verticals";
import { round } from "./icp";

export interface SizingAssumptionInput {
  /** Effective inspection service radius from a dock, km. */
  dockRadiusKmLow?: number;
  dockRadiusKmHigh?: number;
  /** Inspections per site per month required or desired. */
  inspectionsPerMonthLow?: number;
  inspectionsPerMonthHigh?: number;
  /** Average autonomous mission duration, hours. */
  missionHoursLow?: number;
  missionHoursHigh?: number;
  /** Crew-days a manual equivalent of one inspection pass consumes. */
  manualCrewDaysPerPassLow?: number;
  manualCrewDaysPerPassHigh?: number;
}

const DEFAULTS: Required<SizingAssumptionInput> = {
  // Deliberately conservative against DJI Dock-class nominal range: a dock's
  // useful inspection radius is far shorter than its maximum flight radius.
  dockRadiusKmLow: 3,
  dockRadiusKmHigh: 5,
  // FlytBase's SQM deployment moved inspection from biweekly to twice daily.
  // The band below spans "monthly walkdown" to "weekly", which is the range
  // most contractor-served sites actually operate in before automation.
  inspectionsPerMonthLow: 4,
  inspectionsPerMonthHigh: 30,
  missionHoursLow: 0.4,
  missionHoursHigh: 0.8,
  manualCrewDaysPerPassLow: 0.5,
  manualCrewDaysPerPassHigh: 2,
};

export interface SizingContext {
  pack: VerticalPack;
  sites: SiteGeometry[];
  /** Named regulatory instrument driving cadence, when one was actually fetched. */
  regulatoryInstrument?: { instrument: string; sourceUrl: string; obligation: string };
  /** Evidence ids for the geometry the model consumes. */
  geometryEvidenceIds: string[];
  /** Evidence id for the FlytBase reference deployment, when available. */
  referenceEvidenceId?: string;
  overrides?: SizingAssumptionInput;
}

export function sizeOpportunity(ctx: SizingContext): OpportunitySizing {
  const a = { ...DEFAULTS, ...(ctx.overrides ?? {}) };
  const active = ctx.sites.filter((s) => !s.excluded);

  const totalArea = round(
    active.reduce((sum, s) => sum + s.areaKm2, 0),
    3,
  );
  const totalPerimeter = round(
    active.reduce((sum, s) => sum + s.perimeterKm, 0),
    2,
  );
  const siteCount = active.length;

  // ── Dock count ────────────────────────────────────────────────────────
  // A dock services a disc of radius r, but coverage is never perfect: pits
  // are irregular and terrain blocks line of sight, so an efficiency factor
  // is applied. Additionally, physically separated sites cannot share a dock,
  // so the count can never fall below the number of spatial clusters.
  const clusters = countSpatialClusters(active, a.dockRadiusKmHigh * 2);
  const coverageHigh = Math.PI * a.dockRadiusKmHigh ** 2 * 0.7;
  const coverageLow = Math.PI * a.dockRadiusKmLow ** 2 * 0.7;

  const docksLow = Math.max(clusters, Math.ceil(totalArea / coverageHigh));
  const docksHigh = Math.max(clusters, Math.ceil(totalArea / coverageLow));

  // ── Missions and flight hours ─────────────────────────────────────────
  const missionsLow = siteCount * a.inspectionsPerMonthLow;
  const missionsHigh = siteCount * a.inspectionsPerMonthHigh;
  const hoursLow = round(missionsLow * a.missionHoursLow, 1);
  const hoursHigh = round(missionsHigh * a.missionHoursHigh, 1);

  // ── Contracted crew displacement ──────────────────────────────────────
  const crewLow = round(missionsLow * a.manualCrewDaysPerPassLow, 1);
  const crewHigh = round(missionsHigh * a.manualCrewDaysPerPassHigh, 1);

  const assumptions: OpportunitySizing["assumptions"] = [
    {
      key: "dock_radius",
      label: "Effective inspection radius per dock",
      value: a.dockRadiusKmHigh,
      unit: "km",
      basis:
        "Engineering assumption, set well inside DJI Dock-class maximum flight radius to reflect useful inspection resolution rather than ferry range. Adjust to match a specific airframe and sensor payload.",
      evidenceIds: [],
    },
    {
      key: "coverage_efficiency",
      label: "Coverage efficiency",
      value: 70,
      unit: "%",
      basis:
        "Engineering assumption. Pits and pond networks are irregular and terrain interrupts coverage, so a dock never services its full theoretical disc.",
      evidenceIds: [],
    },
    {
      key: "inspection_cadence",
      label: "Inspection passes per site per month",
      value: a.inspectionsPerMonthHigh,
      unit: "passes",
      basis: ctx.regulatoryInstrument
        ? `Upper bound of the operating band. Minimum frequency is driven by ${ctx.regulatoryInstrument.instrument}.`
        : "Operating band spanning monthly to near-daily. No inspection mandate was fetched for this jurisdiction, so no regulatory minimum is asserted.",
      evidenceIds: [],
    },
    {
      key: "mission_duration",
      label: "Average autonomous mission duration",
      value: a.missionHoursHigh,
      unit: "hours",
      basis: "Engineering assumption consistent with a single battery cycle on a dock-based airframe.",
      evidenceIds: [],
    },
    {
      key: "manual_crew_days",
      label: "Contracted crew-days per manual inspection pass",
      value: a.manualCrewDaysPerPassHigh,
      unit: "crew-days",
      basis:
        "Engineering assumption for a two-person contracted crew covering a large site on foot or by vehicle. This is the figure to replace with the operator's own contract data during discovery.",
      evidenceIds: [],
    },
    {
      key: "measured_area",
      label: "Measured operating footprint",
      value: totalArea,
      unit: "km²",
      basis: "Measured from mapped site geometry, not estimated. Each contributing feature is individually citable.",
      evidenceIds: ctx.geometryEvidenceIds,
    },
    {
      key: "site_count",
      label: "Discrete operating sites measured",
      value: siteCount,
      unit: "sites",
      basis: "Count of mapped features attributed to this operator, excluding features tagged disused or abandoned.",
      evidenceIds: ctx.geometryEvidenceIds,
    },
  ];

  const derivation = buildDerivation({
    totalArea,
    totalPerimeter,
    siteCount,
    clusters,
    coverageLow,
    coverageHigh,
    docksLow,
    docksHigh,
    missionsLow,
    missionsHigh,
    hoursLow,
    hoursHigh,
    crewLow,
    crewHigh,
    a,
    regulatoryInstrument: ctx.regulatoryInstrument,
    pack: ctx.pack,
  });

  const caveats = [
    "Footprint is measured from mapped geometry, which reflects the operator's surface disturbance rather than a licensed concession boundary. It is a floor on inspectable area, not a ceiling.",
    "Dock count is a coverage estimate, not a survey. Real placement depends on terrain, line of sight, exclusion zones and available power and network at each location.",
    "Crew-day displacement assumes autonomous passes substitute for manual passes one for one. In practice automation usually increases inspection frequency rather than purely removing labour, which changes the business case from cost saving to risk reduction.",
    "Ranges are shown because every operational input is an assumption until a discovery call replaces it with the operator's own contract and cadence data.",
  ];

  if (!ctx.regulatoryInstrument) {
    caveats.push(
      "No inspection mandate was fetched for this jurisdiction, so cadence is presented as an operating band with no regulatory minimum claimed.",
    );
  }

  return {
    siteCount,
    totalAreaKm2: totalArea,
    totalPerimeterKm: totalPerimeter,
    assumptions,
    docksRequired: { low: docksLow, high: docksHigh },
    missionsPerMonth: { low: missionsLow, high: missionsHigh },
    flightHoursPerMonth: { low: hoursLow, high: hoursHigh },
    contractorCrewDaysDisplacedPerMonth: { low: crewLow, high: crewHigh },
    derivation,
    caveats,
  };
}

/**
 * Single-link clustering: sites within `thresholdKm` of each other can plausibly
 * share dock infrastructure. Prevents the model claiming one dock can serve
 * operations hundreds of kilometres apart.
 */
function countSpatialClusters(sites: SiteGeometry[], thresholdKm: number): number {
  if (sites.length === 0) return 0;
  const parent = sites.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (i: number, j: number) => {
    const a = find(i);
    const b = find(j);
    if (a !== b) parent[b] = a;
  };

  for (let i = 0; i < sites.length; i++) {
    for (let j = i + 1; j < sites.length; j++) {
      if (distKm(sites[i].centroid, sites[j].centroid) <= thresholdKm) union(i, j);
    }
  }
  return new Set(sites.map((_, i) => find(i))).size;
}

function distKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371.0088;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function buildDerivation(x: {
  totalArea: number;
  totalPerimeter: number;
  siteCount: number;
  clusters: number;
  coverageLow: number;
  coverageHigh: number;
  docksLow: number;
  docksHigh: number;
  missionsLow: number;
  missionsHigh: number;
  hoursLow: number;
  hoursHigh: number;
  crewLow: number;
  crewHigh: number;
  a: Required<SizingAssumptionInput>;
  regulatoryInstrument?: { instrument: string; sourceUrl: string };
  pack: VerticalPack;
}): string[] {
  const subjects = [...new Set(x.pack.osmSignatures.map((s) => s.inspectionSubject))]
    .slice(0, 2)
    .join("; ");

  const lines = [
    `Measured ${x.siteCount} operating site${x.siteCount === 1 ? "" : "s"} totalling ${x.totalArea} km² of surface, with ${x.totalPerimeter} km of combined boundary. These figures come from mapped geometry, so each one can be opened and checked.`,
    `The sites fall into ${x.clusters} spatial cluster${x.clusters === 1 ? "" : "s"} once features within ${x.a.dockRadiusKmHigh * 2} km of each other are grouped. Separated clusters cannot share dock infrastructure, so ${x.clusters} is the floor on dock count regardless of area.`,
    `A dock services roughly ${round(x.coverageHigh, 1)} km² at a ${x.a.dockRadiusKmHigh} km effective radius, or ${round(x.coverageLow, 1)} km² at ${x.a.dockRadiusKmLow} km, after a 70% coverage-efficiency allowance. Dividing measured area by those figures and respecting the cluster floor gives ${x.docksLow} to ${x.docksHigh} docks for full coverage.`,
    `At ${x.a.inspectionsPerMonthLow} to ${x.a.inspectionsPerMonthHigh} inspection passes per site per month, the programme runs ${x.missionsLow} to ${x.missionsHigh} autonomous missions monthly, which is ${x.hoursLow} to ${x.hoursHigh} flight hours.`,
    `Substituting for contracted crews at ${x.a.manualCrewDaysPerPassLow} to ${x.a.manualCrewDaysPerPassHigh} crew-days per manual pass, that displaces ${x.crewLow} to ${x.crewHigh} contracted crew-days per month, the hours currently spent putting people on ${subjects}.`,
  ];

  if (x.regulatoryInstrument) {
    lines.push(
      `Minimum cadence is not discretionary here: ${x.regulatoryInstrument.instrument} sets the inspection obligation, which is why the lower bound is a floor rather than a preference.`,
    );
  }

  lines.push(
    `Phase one does not require full coverage. FlytBase's published deployment at the reference account began with a single dock on one zone for one use case at USD 70,000 to 80,000 total system investment, reaching return inside a year, so the first conversation is about one dock on the highest-risk cluster, not ${x.docksHigh}.`,
  );

  return lines;
}

/** The single highest-value zone to propose for a phase-one pilot. */
export function phaseOneTarget(sites: SiteGeometry[]): SiteGeometry | undefined {
  const active = sites.filter((s) => !s.excluded);
  if (active.length === 0) return undefined;
  // Largest feature carries the most inspection burden and the clearest ROI story.
  return [...active].sort((a, b) => b.areaKm2 - a.areaKm2)[0];
}
