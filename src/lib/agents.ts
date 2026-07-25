/**
 * The agent org.
 *
 * Deliberately shaped and named like a sales team rather than a dependency
 * graph. The people assessing this are a revenue organisation, and "Filings
 * Analyst on the Research desk" tells them what the component does in a way
 * "node_3: extract" never will.
 *
 * The decomposition rule throughout: anything that must be defensible is a
 * deterministic function, and the language model is only trusted with prose.
 * Scoring, measurement and counting never pass through a model.
 */

import type { AgentId, AgentSpec, DeskId } from "./types";

export interface Desk {
  id: DeskId | "orchestrator";
  label: string;
  /** One plain sentence a non-technical reader can act on. */
  purpose: string;
  accent: string;
}

export const DESKS: Desk[] = [
  {
    id: "orchestrator",
    label: "Chief of Staff",
    purpose: "Reads the brief, decides who does what, and merges the desks' work into one answer.",
    accent: "var(--color-ink)",
  },
  {
    id: "research",
    label: "Research desk",
    purpose: "Establishes what is true. Measures the ground, reads the filings, finds the events.",
    accent: "var(--color-v-mining)",
  },
  {
    id: "qualification",
    label: "Qualification desk",
    purpose: "Decides which accounts are worth a rep's day, and how big the opportunity is.",
    accent: "var(--color-accent)",
  },
  {
    id: "contact",
    label: "Contact desk",
    purpose: "Works out who to talk to, and refuses to invent anyone who cannot be found.",
    accent: "var(--color-v-ports)",
  },
  {
    id: "outreach",
    label: "Outreach desk",
    purpose: "Writes the message, then tries to tear it apart before a prospect ever sees it.",
    accent: "var(--color-v-rail)",
  },
  {
    id: "handoff",
    label: "Handoff desk",
    purpose: "Packages everything so an account executive can act without asking a question.",
    accent: "var(--color-verified)",
  },
];

export interface AgentNode extends AgentSpec {
  /** What this agent hands to the next one. */
  produces: string;
  /** Whether the output is computed or generated, the trust boundary. */
  kind: "deterministic" | "model" | "fetch" | "orchestration";
  dependsOn: AgentId[];
}

export const AGENTS: AgentNode[] = [
  {
    id: "chief_of_staff",
    desk: "orchestrator",
    title: "Chief of Staff",
    plainJob:
      "Turns the campaign brief into a work plan, hands each job to the right desk, and decides when there is enough evidence to stop researching and start writing.",
    tools: ["run planner", "evidence sufficiency check"],
    produces: "A written plan naming every job and who owns it",
    kind: "orchestration",
    dependsOn: [],
  },

  // ── Research desk ──────────────────────────────────────────────────
  {
    id: "terrain_surveyor",
    desk: "research",
    title: "Terrain Surveyor",
    plainJob:
      "Measures every industrial site mapped in the target countries and works out which company runs each one, so the account list comes from the physical world instead of a model's memory.",
    tools: ["OpenStreetMap Overpass API", "geodesic area and perimeter", "attribution ladder"],
    produces: "Measured polygons with area, boundary, coordinates and an operator",
    kind: "fetch",
    dependsOn: ["chief_of_staff"],
  },
  {
    id: "universe_scout",
    desk: "research",
    title: "Universe Scout",
    plainJob:
      "Turns the operator names found on the map into a list of real companies, and leaves out any it cannot confidently identify rather than guessing at a parent company.",
    tools: ["operator-to-identity resolution"],
    produces: "The account universe, with the unresolved remainder logged as gaps",
    kind: "deterministic",
    dependsOn: ["terrain_surveyor"],
  },
  {
    id: "filings_analyst",
    desk: "research",
    title: "Filings Analyst",
    plainJob:
      "Reads each company's own annual filing and counts how often it talks about contractors, inspections and safety, then quotes the strongest passages word for word.",
    tools: ["SEC EDGAR full-text search", "submissions index", "risk-factor scan"],
    produces: "Term counts plus verbatim risk-factor passages, and a list of terms found zero times",
    kind: "deterministic",
    dependsOn: ["universe_scout"],
  },
  {
    id: "anchor_analyst",
    desk: "research",
    title: "Anchor Analyst",
    plainJob:
      "Studies the one account the brief names as the reference and turns its real profile into the yardstick every other account is measured against.",
    tools: ["measured footprint", "primary filing", "commodity tags"],
    produces: "The target profile: footprint, site count, contractor dependency, language",
    kind: "deterministic",
    dependsOn: ["terrain_surveyor", "filings_analyst"],
  },
  {
    id: "signals_desk",
    desk: "research",
    title: "Signals Desk",
    plainJob:
      "Looks for dated events that change whether now is a good time to make contact, a new appointment, an incident, an expansion, and says why each one matters.",
    tools: ["statutory appointment dates", "interim-status detection", "server-side web search"],
    produces: "Dated, cited signals with an urgency score and a read on what they mean",
    kind: "fetch",
    dependsOn: ["universe_scout"],
  },
  {
    id: "regulatory_analyst",
    desk: "research",
    title: "Regulatory Analyst",
    plainJob:
      "Finds the specific rule that forces an inspection to happen in each country, because naming the actual regulation is what makes a safety conversation credible.",
    tools: ["jurisdiction registry", "instrument text fetch"],
    produces: "Named instruments with obligations, withheld from copy until the text is fetched",
    kind: "fetch",
    dependsOn: ["universe_scout"],
  },

  // ── Qualification desk ─────────────────────────────────────────────
  {
    id: "cross_verifier",
    desk: "qualification",
    title: "Cross-Verification Officer",
    plainJob:
      "Checks important claims against a second independent source, and where two sources disagree, shows the disagreement instead of quietly picking one.",
    tools: ["source trust ordering", "conflict reconciliation"],
    produces: "Confidence levels on each fact, and conflicts surfaced rather than hidden",
    kind: "deterministic",
    dependsOn: ["filings_analyst", "signals_desk", "terrain_surveyor"],
  },
  {
    id: "icp_scorer",
    desk: "qualification",
    title: "ICP Scorer",
    plainJob:
      "Scores each account out of a hundred using published weights, so anyone can check the arithmetic. No model opinion goes into this number.",
    tools: ["ten weighted dimensions", "anchor-relative normalisation"],
    produces: "A score, a tier, per-dimension contributions and stated disqualifiers",
    kind: "deterministic",
    dependsOn: ["anchor_analyst", "cross_verifier"],
  },
  {
    id: "opportunity_engineer",
    desk: "qualification",
    title: "Opportunity Engineer",
    plainJob:
      "Turns measured ground into a programme size: how many docking stations, how many flights a month, and how many contracted crew-days that replaces.",
    tools: ["spatial clustering", "coverage model", "cadence model"],
    produces: "Ranges for docks, missions, flight hours and displaced crew-days, plus every assumption",
    kind: "deterministic",
    dependsOn: ["icp_scorer"],
  },

  // ── Contact desk ───────────────────────────────────────────────────
  {
    id: "org_cartographer",
    desk: "contact",
    title: "Org Cartographer",
    plainJob:
      "Works out the shape of the buying group for this kind of company, who champions, who signs, who can veto on safety grounds, whether or not names are available.",
    tools: ["role taxonomy", "seniority classification"],
    produces: "The buying committee structure and which role to open with",
    kind: "deterministic",
    dependsOn: ["universe_scout"],
  },
  {
    id: "people_finder",
    desk: "contact",
    title: "People Finder",
    plainJob:
      "Finds real named people and the exact page that names them. If nobody can be found, it says so and describes how to find them, rather than inventing a plausible name.",
    tools: ["statutory transparency rosters", "company leadership pages", "soft-404 detection"],
    produces: "Named contacts with verbatim titles and sources, or explicit nameless role targets",
    kind: "fetch",
    dependsOn: ["org_cartographer"],
  },
  {
    id: "reachability_analyst",
    desk: "contact",
    title: "Reachability Analyst",
    plainJob:
      "Checks how a company's email actually works and only ever labels a derived address as a guess. It never puts a guessed address somewhere it could be sent to.",
    tools: ["live MX lookup", "pattern derivation from observed addresses"],
    produces: "Mail infrastructure evidence, and addresses marked observed or inferred",
    kind: "fetch",
    dependsOn: ["people_finder"],
  },

  // ── Outreach desk ──────────────────────────────────────────────────
  {
    id: "message_strategist",
    desk: "outreach",
    title: "Message Strategist",
    plainJob:
      "Chooses the angle for each person: which of their own facts to lead with, which customer story proves it, and which language they actually work in.",
    tools: ["persona angle selection", "proof-point matching", "language policy"],
    produces: "A brief for the writer: the angle, the two facts, the proof point, the language",
    kind: "deterministic",
    dependsOn: ["opportunity_engineer", "reachability_analyst"],
  },
  {
    id: "copywriter",
    desk: "outreach",
    title: "Copywriter",
    plainJob:
      "Writes the actual message in the recipient's working language, using only facts that already have a source attached.",
    tools: ["language model, prose only"],
    produces: "A draft subject line and body, with each asserted fact tied to an evidence row",
    kind: "model",
    dependsOn: ["message_strategist"],
  },
  {
    id: "red_team",
    desk: "outreach",
    title: "Red Team critic",
    plainJob:
      "Tries to reject the writer's draft. It checks length, banned phrasing, whether the facts are cited, whether the ask is reasonable, and how the copy reads, and sends it back if any check fails.",
    tools: ["ten hard gates", "banned-phrase list", "language-correct readability"],
    produces: "A pass or fail with reasons, and the rejected drafts kept on the record",
    kind: "deterministic",
    dependsOn: ["copywriter"],
  },
  {
    id: "sequence_architect",
    desk: "outreach",
    title: "Sequence Architect",
    plainJob:
      "Lays out the follow-up plan across channels and days, and applies a different standard to follow-ups than to first messages, because the two behave differently.",
    tools: ["cadence model", "multi-threading across the committee"],
    produces: "A dated, multi-channel sequence with copy for each touch",
    kind: "deterministic",
    dependsOn: ["red_team"],
  },

  // ── Handoff desk ───────────────────────────────────────────────────
  {
    id: "ae_briefer",
    desk: "handoff",
    title: "AE Briefer",
    plainJob:
      "Writes the one-page brief an account executive picks up: why this account, why now, who to call, what to ask, and what they will push back on.",
    tools: ["discovery question generation", "objection mapping"],
    produces: "Positioning, stakeholder map, discovery questions, objection handling, next action",
    kind: "model",
    dependsOn: ["sequence_architect", "icp_scorer"],
  },
  {
    id: "exporter",
    desk: "handoff",
    title: "Exporter",
    plainJob:
      "Gets the work out of this system and into the tools a rep already uses, and refuses to export any address that was only a guess.",
    tools: ["CRM-shaped CSV", "JSON run artifact", "consented send"],
    produces: "Importable files and, on request, a real message to an address the operator typed",
    kind: "deterministic",
    dependsOn: ["ae_briefer"],
  },
];

export function agentById(id: AgentId): AgentNode | undefined {
  return AGENTS.find((a) => a.id === id);
}

export function agentsByDesk(desk: DeskId | "orchestrator"): AgentNode[] {
  return AGENTS.filter((a) => a.desk === desk);
}

export const KIND_LABEL: Record<AgentNode["kind"], string> = {
  deterministic: "computed, no model involved",
  model: "language model, prose only",
  fetch: "fetches from a named source",
  orchestration: "plans and delegates",
};
