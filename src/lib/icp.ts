/**
 * Deterministic ICP scorer.
 *
 * Deliberately NOT an LLM. "The model said 92%" is unauditable; this is a pure
 * function whose weights are published on screen and whose per-dimension
 * contributions are rendered as a waterfall a non-technical judge can add up by
 * hand. Every dimension either cites evidence or is explicitly marked unscored
 * a missing signal scores zero rather than being guessed.
 *
 * The anchor account defines the target profile, so the scorer is calibrated
 * against the reference account's own measured and disclosed characteristics
 * rather than against an abstract idea of a good customer.
 */

import type {
  Account,
  EvidenceRow,
  IcpDimensionScore,
  IcpScore,
  RiskFactorScan,
  Signal,
  SiteGeometry,
} from "./types";
import type { VerticalPack } from "./verticals";

export interface AnchorProfile {
  /** Measured footprint of the reference account, in km². */
  measuredAreaKm2: number;
  siteCount: number;
  commodities: string[];
  /** Contractor-family mention count in the anchor's primary filing. */
  contractorMentions: number;
  /** Whether the anchor discloses any autonomy programme. */
  disclosesAutonomy: boolean;
  workingLanguage: string;
  country: string;
}

export interface ScoreInputs {
  pack: VerticalPack;
  anchor: AnchorProfile;
  sites: SiteGeometry[];
  commodities: string[];
  country: string;
  riskScan?: RiskFactorScan;
  signals: Signal[];
  contactsNamed: number;
  /** Present when the account files with a securities regulator. */
  hasPrimaryFiling: boolean;
  /** Evidence ids per dimension key, so each bar links to its sources. */
  evidence: Record<string, string[]>;
}

const DIMENSION_LABELS: Record<string, { label: string; rationale: string }> = {
  commodity_fit: {
    label: "Commodity & extraction match",
    rationale:
      "Does the operator extract the same commodity classes as the reference account, using comparable surface methods?",
  },
  measured_footprint: {
    label: "Measured site footprint",
    rationale:
      "Total square kilometres of operating surface we could measure from mapped geometry. Footprint is the unit of inspection work, so it is the closest proxy for deal size.",
  },
  multi_site: {
    label: "Multi-site distribution",
    rationale:
      "Number of discrete operating sites. Distributed operations multiply travel cost for contracted crews, which is exactly the cost autonomous inspection removes.",
  },
  continuous_ops: {
    label: "Continuous operations",
    rationale:
      "Evidence the site runs around the clock, which makes inspection windows scarce and manual coverage expensive.",
  },
  hazard_regime: {
    label: "Regulated hazard exposure",
    rationale:
      "Whether the operator sits under a named inspection mandate and has disclosed safety exposure. Regulation converts inspection from discretionary to obligatory.",
  },
  contractor_dependency: {
    label: "Contractor dependency",
    rationale:
      "How heavily the operator's own primary filing leans on contractors, measured by verbatim mention counts in its risk factors. This is the incumbent cost being displaced.",
  },
  tech_readiness: {
    label: "Automation readiness",
    rationale:
      "Signals of digital or automation investment. Some readiness shortens the sale; a fully solved autonomy programme removes the opportunity.",
  },
  capital_capacity: {
    label: "Capital capacity",
    rationale:
      "Ability to fund a programme, inferred from public-market listing status and disclosed scale.",
  },
  trigger_signal: {
    label: "Timing trigger",
    rationale:
      "A dated, cited event that makes contact relevant now, leadership change, incident, regulatory action, or expansion.",
  },
  reachability: {
    label: "Reachability",
    rationale:
      "Whether we found real named people at the target seniority with a citable source. Unreachable accounts are deprioritised, not invented into existence.",
  },
};

export function scoreAccount(inputs: ScoreInputs): IcpScore {
  const { pack, anchor, sites, riskScan, signals } = inputs;

  /**
   * Normalise the weights before using them.
   *
   * A score out of 100 has to be out of 100. One pack's weights summed to 1.10
   * through a typo, and the result was a reference account scoring 103.4, which
   * is the kind of number that costs a reader their confidence in every other
   * figure on the page. The pack data is fixed, and this makes the class of
   * mistake unable to reach the screen again: whatever weights a pack declares,
   * the dimensions reported here sum to exactly 1 and the total to at most 100.
   */
  const declared = pack.icpWeights;
  const weightSum = Object.values(declared).reduce((a, w) => a + w, 0);
  const weights: Record<string, number> =
    Math.abs(weightSum - 1) < 1e-9 || weightSum <= 0
      ? declared
      : Object.fromEntries(Object.entries(declared).map(([k, w]) => [k, w / weightSum]));
  const active = sites.filter((s) => !s.excluded);
  const totalArea = active.reduce((a, s) => a + s.areaKm2, 0);

  const raw: Record<string, number | null> = {};

  // Commodity overlap with the anchor, by set intersection.
  if (inputs.commodities.length === 0) {
    raw.commodity_fit = null;
  } else {
    const anchorSet = new Set(anchor.commodities.map(lc));
    const overlap = inputs.commodities.filter((c) => anchorSet.has(lc(c))).length;
    raw.commodity_fit = clamp(overlap / Math.max(1, Math.min(anchor.commodities.length, inputs.commodities.length)));
  }

  // Footprint relative to the anchor, saturating at parity. An operator with
  // the anchor's footprint or more scores full marks.
  raw.measured_footprint =
    totalArea > 0 && anchor.measuredAreaKm2 > 0
      ? clamp(Math.log1p(totalArea) / Math.log1p(anchor.measuredAreaKm2))
      : totalArea > 0
        ? 0.5
        : null;

  // Site count, saturating at the anchor's count.
  raw.multi_site =
    active.length > 0 ? clamp(Math.log1p(active.length) / Math.log1p(Math.max(2, anchor.siteCount))) : null;

  // Continuous operations: process plants and brine ponds imply 24/7 flow.
  const continuousClasses = new Set(["process_plant", "brine_pond", "tailings", "port_terminal", "harbour", "rail_yard"]);
  const hasContinuous = active.some((s) => continuousClasses.has(s.assetClass));
  raw.continuous_ops = active.length === 0 ? null : hasContinuous ? 1 : 0.55;

  // Hazard regime: a named instrument for this jurisdiction plus disclosed exposure.
  const regime = pack.regulatoryRegimes.find((r) => r.country === inputs.country);
  const safetyDisclosed =
    (riskScan?.termCounts["safety incident"] ?? 0) +
      (riskScan?.termCounts.fatality ?? 0) +
      (riskScan?.termCounts.tailings ?? 0) >
    0;
  raw.hazard_regime =
    regime && safetyDisclosed ? 1 : regime ? 0.7 : safetyDisclosed ? 0.5 : inputs.hasPrimaryFiling ? 0.2 : null;

  // Contractor dependency, benchmarked against the anchor's own filing.
  if (riskScan) {
    const mentions =
      (riskScan.termCounts.contractor ?? 0) +
      (riskScan.termCounts.contractors ?? 0) +
      (riskScan.termCounts.subcontract ?? 0) +
      (riskScan.termCounts["independent contractors"] ?? 0);
    raw.contractor_dependency = clamp(mentions / Math.max(1, anchor.contractorMentions));
  } else {
    raw.contractor_dependency = null;
  }

  // Automation readiness. Some is good; a disclosed autonomy programme means
  // the whitespace is already occupied, so the curve turns back down.
  const techSignals = signals.filter((s) => s.kind === "technology").length;
  const autonomyDisclosed = riskScan ? !riskScan.absentTerms.includes("autonomous") : false;
  raw.tech_readiness = autonomyDisclosed
    ? 0.35
    : techSignals > 0
      ? clamp(0.6 + 0.15 * techSignals)
      : riskScan
        ? 0.7 // filing exists and shows no incumbent autonomy: clean whitespace
        : null;

  raw.capital_capacity = inputs.hasPrimaryFiling ? 1 : totalArea > 5 ? 0.6 : null;

  // Timing: strongest single signal dominates, with a small bonus for breadth.
  if (signals.length === 0) {
    raw.trigger_signal = null;
  } else {
    const strongest = Math.max(...signals.map((s) => s.urgency));
    raw.trigger_signal = clamp(strongest * 0.85 + Math.min(0.15, 0.05 * signals.length));
  }

  raw.reachability = inputs.contactsNamed > 0 ? clamp(0.4 + 0.2 * inputs.contactsNamed) : 0;

  // Assemble the waterfall.
  const dimensions: IcpDimensionScore[] = Object.keys(weights).map((key) => {
    const meta = DIMENSION_LABELS[key] ?? { label: key, rationale: "" };
    const value = raw[key];
    const unscored = value === null || value === undefined;
    const r = unscored ? 0 : (value as number);
    return {
      key,
      label: meta.label,
      rationale: meta.rationale,
      weight: weights[key],
      raw: round(r, 3),
      contribution: round(weights[key] * r * 100, 1),
      evidenceIds: inputs.evidence[key] ?? [],
      unscored,
    };
  });

  const total = round(
    dimensions.reduce((a, d) => a + d.contribution, 0),
    1,
  );

  // Disqualifiers are stated, not silently applied.
  const disqualifiers: string[] = [];
  if (active.length === 0) {
    disqualifiers.push("No mappable operating site could be measured, so deal size cannot be estimated.");
  }
  if (totalArea > 0 && totalArea < 0.25) {
    disqualifiers.push(
      `Measured footprint of ${round(totalArea, 3)} km² is below the threshold where dock-based autonomous inspection pays back.`,
    );
  }

  const tier: IcpScore["tier"] = disqualifiers.length
    ? "DISQUALIFIED"
    : total >= 70
      ? "A"
      : total >= 50
        ? "B"
        : "C";

  return {
    total,
    tier,
    tierRationale: tierRationale(tier, total, dimensions, disqualifiers),
    dimensions: dimensions.sort((a, b) => b.contribution - a.contribution),
    disqualifiers,
  };
}

function tierRationale(
  tier: IcpScore["tier"],
  total: number,
  dims: IcpDimensionScore[],
  disqualifiers: string[],
): string {
  if (tier === "DISQUALIFIED") return disqualifiers.join(" ");
  const top = [...dims].sort((a, b) => b.contribution - a.contribution).slice(0, 3);
  const missing = dims.filter((d) => d.unscored);
  const lead = `Scores ${total} of 100, carried by ${top
    .map((d) => `${d.label.toLowerCase()} (${d.contribution})`)
    .join(", ")}.`;
  const gap = missing.length
    ? ` ${missing.length} dimension${missing.length > 1 ? "s" : ""} could not be scored from public evidence and contributed zero rather than an estimate: ${missing
        .map((d) => d.label.toLowerCase())
        .join(", ")}.`
    : "";
  const band =
    tier === "A"
      ? " Tier A: work this account now."
      : tier === "B"
        ? " Tier B: worth a sequence once Tier A is in motion."
        : " Tier C: nurture, or revisit when a timing signal appears.";
  return lead + gap + band;
}

/** Build the anchor profile from the reference account's own measured data. */
export function anchorProfileFrom(account: {
  sites: SiteGeometry[];
  commodities: string[];
  riskScan?: RiskFactorScan;
  workingLanguage: string;
  country: string;
}): AnchorProfile {
  const active = account.sites.filter((s) => !s.excluded);
  const rs = account.riskScan;
  const contractorMentions = rs
    ? (rs.termCounts.contractor ?? 0) +
      (rs.termCounts.contractors ?? 0) +
      (rs.termCounts.subcontract ?? 0) +
      (rs.termCounts["independent contractors"] ?? 0)
    : 1;
  return {
    measuredAreaKm2: active.reduce((a, s) => a + s.areaKm2, 0),
    siteCount: active.length,
    commodities: account.commodities,
    contractorMentions: Math.max(1, contractorMentions),
    disclosesAutonomy: rs ? !rs.absentTerms.includes("autonomous") : false,
    workingLanguage: account.workingLanguage,
    country: account.country,
  };
}

/** Rank accounts for the AE: tier first, then score, then timing urgency. */
export function rankAccounts(accounts: Account[]): Account[] {
  const tierRank = { A: 0, B: 1, C: 2, DISQUALIFIED: 3 } as const;
  return [...accounts].sort((a, b) => {
    if (a.isAnchor !== b.isAnchor) return a.isAnchor ? -1 : 1;
    const t = tierRank[a.icp.tier] - tierRank[b.icp.tier];
    if (t !== 0) return t;
    if (b.icp.total !== a.icp.total) return b.icp.total - a.icp.total;
    const au = Math.max(0, ...a.signals.map((s) => s.urgency));
    const bu = Math.max(0, ...b.signals.map((s) => s.urgency));
    return bu - au;
  });
}

const lc = (s: string) => s.toLowerCase().trim();
const clamp = (n: number) => Math.max(0, Math.min(1, n));
export const round = (n: number, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;

/** Helper used by the harvest to register an evidence row and return its id. */
export function registerEvidence(
  ledger: Record<string, EvidenceRow>,
  row: Omit<EvidenceRow, "id">,
  idHint: string,
): string {
  const id = `ev-${idHint}-${Object.keys(ledger).length + 1}`;
  ledger[id] = { id, ...row };
  return id;
}
