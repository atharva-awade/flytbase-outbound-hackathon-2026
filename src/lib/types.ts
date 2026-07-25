/**
 * Aerion core domain types.
 *
 * The central rule of this system: a fact may not reach the UI unless it is
 * carried by an EvidenceRow that has a real `sourceUrl` and a `verbatim`
 * snippet taken from that source. `Cited<T>` enforces that at the type level
 * you cannot construct a displayable value without attaching evidence ids.
 *
 * This is what makes "all research must be real" a property of the program
 * rather than a promise in a README.
 */

// ── Provenance ────────────────────────────────────────────────────────────

/** Ordered by trust. The cross-verifier prefers lower indices when sources conflict. */
export const SOURCE_CLASS_TRUST = [
  "primary_filing", // SEC 20-F/10-K, exchange filing
  "statutory_disclosure", // e.g. Chile Ley 20.285 transparency pages
  "regulator", // Sernageomin, ANM, MINEM, FAA
  "company_primary", // company site, IR deck, sustainability report, press release
  "geospatial", // OpenStreetMap measured geometry
  "conference_roster", // speaker lists with name + title + company
  "academic", // OpenAlex / Crossref author affiliations
  "trade_press", // mining.com, BNamericas, Reuters
  "search_result", // search-engine SERP metadata (incl. LinkedIn SERP titles)
  "aggregator", // third-party data aggregators
] as const;
export type SourceClass = (typeof SOURCE_CLASS_TRUST)[number];

export type Confidence =
  | "VERIFIED" // fetched, quoted, and the snippet contains the claim
  | "CORROBORATED" // >=2 independent sources agree
  | "CONFLICT" // sources disagree; both retained, winner stated
  | "INFERRED" // derived (e.g. email pattern); never presented as fact
  | "UNVERIFIED"; // seen but not confirmed against the source text

/** How a geospatial feature was attributed to a company. Coverage varies by region. */
export type AttributionMethod =
  | "osm_operator_tag" // operator=* present on the feature
  | "osm_name_match" // feature name matches a known site name
  | "proximity_cluster" // unattributed feature inside/adjacent to an attributed one
  | "company_reported" // coordinates published by the company itself
  | "unattributed"; // deliberately left unassigned

export interface EvidenceRow {
  id: string;
  /** The specific assertion this row supports. */
  claim: string;
  value?: string | number;
  unit?: string;
  sourceUrl: string;
  sourceTitle?: string;
  sourceClass: SourceClass;
  /** ISO-8601. Real fetch time, the demo shows these to prove freshness. */
  fetchedAt: string;
  /** Exact text from the source. Must contain the claim/value. Never paraphrased. */
  verbatim: string;
  /** BCP-47 of `verbatim` (es-CL, pt-BR, en). Non-English sources are a differentiator. */
  language: string;
  /** English rendering when `language` is not English, so an AE can read it. */
  translation?: string;
  confidence: Confidence;
  attributionMethod?: AttributionMethod;
  /** Which agent produced this row, drives the "how it thinks" trace. */
  producedBy: AgentId;
  /** Ids of rows that corroborate or contradict this one. */
  corroborates?: string[];
  contradicts?: string[];
}

/** A value that cannot exist without evidence backing it. */
export interface Cited<T> {
  value: T;
  evidenceIds: string[];
}

/** Recorded when the system looked for something and did not find it. */
export interface NullResult {
  id: string;
  subject: string;
  question: string;
  /** Every source actually attempted, with the observed failure. */
  attempts: { source: string; url?: string; outcome: string }[];
  /** Why this gap exists, in plain language. */
  interpretation: string;
  /** What a human should do next, or what we would build with more time. */
  remediation: string;
  producedBy: AgentId;
  recordedAt: string;
}

// ── Agents ────────────────────────────────────────────────────────────────

export const AGENT_IDS = [
  "chief_of_staff",
  // Research desk
  "anchor_analyst",
  "universe_scout",
  "terrain_surveyor",
  "filings_analyst",
  "signals_desk",
  "regulatory_analyst",
  // Qualification desk
  "cross_verifier",
  "icp_scorer",
  "opportunity_engineer",
  // Contact desk
  "org_cartographer",
  "people_finder",
  "reachability_analyst",
  // Outreach desk
  "message_strategist",
  "copywriter",
  "red_team",
  "sequence_architect",
  // Handoff desk
  "ae_briefer",
  "exporter",
] as const;
export type AgentId = (typeof AGENT_IDS)[number];

export type DeskId = "research" | "qualification" | "contact" | "outreach" | "handoff";

export interface AgentSpec {
  id: AgentId;
  desk: DeskId | "orchestrator";
  /** Job title a salesperson would recognise. */
  title: string;
  /** One plain sentence, written for a non-technical viewer. */
  plainJob: string;
  tools: string[];
}

// ── Campaign brief (the input, never hardcoded) ──────────────────────────

export interface CampaignBrief {
  id: string;
  verticalPackId: string;
  label: string;
  /** Free-text target definition, exactly as a BDR would receive it. */
  targetVertical: string;
  /** The anchor account whose real profile defines the ICP. */
  referenceAccount: string;
  /** Countries/regions in scope. ISO-3166-1 alpha-2 where possible. */
  geographies: string[];
  /** Titles to reach, in priority order. */
  targetRoles: string[];
  /** The product angle to lead with. */
  angle: string;
}

// ── Sites and geometry ────────────────────────────────────────────────────

export interface SiteGeometry {
  /** e.g. "way/886558255", resolvable on openstreetmap.org. */
  osmId: string;
  name?: string;
  operatorTag?: string;
  /** Raw OSM tags, retained so a judge can audit our interpretation. */
  tags: Record<string, string>;
  centroid: { lat: number; lon: number };
  /** Closed ring, [lon, lat]. */
  ring: [number, number][];
  areaKm2: number;
  perimeterKm: number;
  assetClass: string;
  attributionMethod: AttributionMethod;
  /** Excluded from totals when true (disused/abandoned), but still shown. */
  excluded?: boolean;
  exclusionReason?: string;
  evidenceIds: string[];
}

// ── Accounts ──────────────────────────────────────────────────────────────

export interface IcpDimensionScore {
  key: string;
  label: string;
  /** Plain-language description of what this dimension measures. */
  rationale: string;
  weight: number;
  /** 0..1 */
  raw: number;
  /** weight * raw, so the UI can render an auditable waterfall. */
  contribution: number;
  evidenceIds: string[];
  /** True when we had no evidence and scored 0 rather than guessing. */
  unscored?: boolean;
}

export interface IcpScore {
  total: number;
  tier: "A" | "B" | "C" | "DISQUALIFIED";
  tierRationale: string;
  dimensions: IcpDimensionScore[];
  /** Explicit reasons an account was dropped, shown rather than hidden. */
  disqualifiers: string[];
}

export interface OpportunitySizing {
  siteCount: number
  totalAreaKm2: number;
  totalPerimeterKm: number;
  /** Assumptions are surfaced and editable in the UI, never buried. */
  assumptions: {
    key: string;
    label: string;
    value: number;
    unit: string;
    /** Where this assumption comes from; "operator input" when user-edited. */
    basis: string;
    evidenceIds: string[];
  }[];
  /** Ranges, not false precision. */
  docksRequired: { low: number; high: number };
  missionsPerMonth: { low: number; high: number };
  flightHoursPerMonth: { low: number; high: number };
  contractorCrewDaysDisplacedPerMonth: { low: number; high: number };
  /** Plain-language derivation a non-technical judge can follow line by line. */
  derivation: string[];
  caveats: string[];
}

export interface RiskFactorScan {
  documentUrl: string;
  documentLabel: string;
  filedAt?: string;
  totalChars: number;
  /** Term -> occurrence count in the primary document. */
  termCounts: Record<string, number>;
  /** The strongest verbatim passages, with surrounding context. */
  passages: { term: string; verbatim: string; evidenceId: string }[];
  /** Terms deliberately searched and found ZERO times, a whitespace signal. */
  absentTerms: string[];
  interpretation: string;
}

export interface Signal {
  id: string;
  kind:
    | "leadership_change"
    | "incident"
    | "regulatory"
    | "expansion"
    | "capex"
    | "technology"
    | "production"
    | "sustainability";
  headline: string;
  occurredAt?: string;
  /** Why this matters for the angle, the strategic read, not the trivia. */
  soWhat: string;
  /** 0..1, how strongly this argues for outreach right now. */
  urgency: number;
  evidenceIds: string[];
}

export interface Account {
  id: string;
  slug: string;
  legalName: string;
  displayName: string;
  country: string;
  countryName: string;
  verticalPackId: string;
  commodities: string[];
  /** Present when the company files with the SEC. */
  secCik?: string;
  ticker?: string;
  domain?: string;
  /** Mail infrastructure, derived from real MX records. Evidence of stack, not a guess. */
  mailInfrastructure?: Cited<string>;
  workingLanguage: string;
  sites: SiteGeometry[];
  icp: IcpScore;
  sizing?: OpportunitySizing;
  riskScan?: RiskFactorScan;
  signals: Signal[];
  /** Why this account resembles the anchor, in one paragraph, fully cited. */
  anchorComparison: Cited<string>;
  contacts: Contact[];
  isAnchor?: boolean;
}

// ── Contacts ──────────────────────────────────────────────────────────────

export type ContactTier =
  /** Real person named on a statutory or company-primary page, title quoted. */
  | "NAMED_VERIFIED"
  /** Real person surfaced via SERP title, conference roster, or paper affiliation. */
  | "NAMED_PUBLIC_PROFILE"
  /** No individual found. We state the role and how to find them. Never invented. */
  | "ROLE_TARGET_NO_NAME";

export type BuyingRole =
  | "champion"
  | "economic_buyer"
  | "technical_buyer"
  | "risk_validator"
  | "influencer";

export interface Contact {
  id: string;
  tier: ContactTier;
  /** Absent for ROLE_TARGET_NO_NAME. Never populated by inference. */
  name?: string;
  /** Verbatim from the source, in the source language. */
  titleVerbatim?: string;
  titleEnglish?: string;
  /** The role we are targeting, which exists whether or not a name was found. */
  targetRole: string;
  buyingRole: BuyingRole;
  seniority: "c_suite" | "vp" | "director" | "head" | "manager" | "superintendent";
  accountId: string;
  /** The specific site this person owns, when identifiable. Enables the killer pairing. */
  siteOsmId?: string;
  linkedinUrl?: string;
  /** Always INFERRED unless observed verbatim in a source. Never auto-sendable. */
  email?: {
    address: string;
    status: "OBSERVED" | "INFERRED";
    /** The real address(es) the pattern was derived from. */
    patternBasis?: string;
    pattern?: string;
    evidenceIds: string[];
  };
  /** For ROLE_TARGET_NO_NAME: concrete steps to find the human. */
  findingPlaybook?: string[];
  evidenceIds: string[];
  producedBy: AgentId;
}

// ── Outreach ──────────────────────────────────────────────────────────────

export interface CriticGateResult {
  gate: string;
  label: string;
  passed: boolean;
  detail: string;
}

export interface EmailDraft {
  id: string;
  iteration: number;
  subject: string;
  body: string;
  language: string;
  /** English rendering for the AE when body is not English. */
  englishGloss?: string;
  wordCount: number;
  sentenceCount: number;
  /** Facts asserted, each tied to evidence. Enforces "no uncited claim". */
  citedFacts: { text: string; evidenceId: string }[];
  gates: CriticGateResult[];
  score: number;
  accepted: boolean;
  /** Why the critic rejected it, displayed, because rejects prove the loop is real. */
  rejectionReasons: string[];
  model: string;
}

export interface CadenceStep {
  dayOffset: number;
  channel: "email" | "linkedin" | "call";
  /** Which contact this touch targets, cadences are multi-threaded. */
  contactId: string;
  intent: string;
  /** Why this gap and this channel, with the data behind it. */
  rationale: string;
  draft?: EmailDraft;
  script?: string;
}

export interface AeBrief {
  accountId: string;
  headline: string;
  whyNow: string;
  /** The one-sentence pitch an AE can say on a call. */
  positioning: string;
  stakeholderMap: { contactId: string; role: BuyingRole; approach: string }[];
  discoveryQuestions: { question: string; whyItLands: string; evidenceIds: string[] }[];
  objections: { objection: string; response: string; evidenceIds: string[] }[];
  referenceCase: Cited<string>;
  nextAction: string;
}

// ── Runs ──────────────────────────────────────────────────────────────────

export type RunMode = "live" | "replay";

export interface TraceEvent {
  seq: number;
  at: string;
  agent: AgentId;
  phase: "start" | "tool" | "note" | "finish" | "error";
  message: string;
  tool?: string;
  url?: string;
  model?: string;
  latencyMs?: number;
  tokensIn?: number;
  tokensOut?: number;
  tokensCached?: number;
  evidenceCreated?: number;
}

export interface Run {
  id: string;
  brief: CampaignBrief;
  mode: RunMode;
  startedAt: string;
  finishedAt?: string;
  /** The orchestrator's plan, shown verbatim so delegation is inspectable. */
  plan: { agent: AgentId; task: string; dependsOn: AgentId[] }[];
  accounts: Account[];
  evidence: Record<string, EvidenceRow>;
  nullResults: NullResult[];
  cadences: Record<string, CadenceStep[]>;
  briefs: Record<string, AeBrief>;
  trace: TraceEvent[];
  stats: {
    accountsConsidered: number;
    accountsQualified: number;
    sitesMeasured: number;
    totalAreaKm2: number;
    evidenceRows: number;
    namedContacts: number;
    roleTargets: number;
    emailsAccepted: number;
    emailsRejected: number;
    sourcesFetched: number;
    languages: string[];
  };
}
