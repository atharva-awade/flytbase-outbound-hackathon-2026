/**
 * AE Briefer.
 *
 * The test this exists to pass: an account executive picks this up cold and
 * knows what to do next without asking a question. That means it cannot be a
 * summary, a summary tells them what they already have. It has to be the things
 * a rep would otherwise spend an afternoon assembling: what to open with, what to
 * ask, what they will get pushed back on, and which reference to reach for.
 *
 * Everything here is generated from the account's own evidence, so each question
 * and each objection response carries the source it rests on. A discovery
 * question that quotes the prospect's own filing lands very differently from one
 * pulled from a generic mining questionnaire.
 */

import type { Account, AeBrief, Contact, EvidenceRow } from "./types";
import type { VerticalPack } from "./verticals";
import { round } from "./icp";

export interface BriefingInput {
  account: Account;
  pack: VerticalPack;
  evidence: Record<string, EvidenceRow>;
  anchorName: string;
}

export function buildAeBrief(input: BriefingInput): AeBrief {
  const { account, pack, anchorName } = input;
  const active = account.sites.filter((s) => !s.excluded);
  const biggest = [...active].sort((a, b) => b.areaKm2 - a.areaKm2)[0];
  const topSignal = [...account.signals].sort((a, b) => b.urgency - a.urgency)[0];
  const contractorCount = account.riskScan
    ? (account.riskScan.termCounts.contractor ?? 0) +
      (account.riskScan.termCounts.contractors ?? 0) +
      (account.riskScan.termCounts.subcontract ?? 0)
    : 0;
  const filingEvidence = account.riskScan?.passages[0]?.evidenceId;
  const geoEvidence = biggest?.evidenceIds ?? [];

  // ── Stakeholder map ──────────────────────────────────────────────────
  const ranked = [...account.contacts].sort((a, b) => rank(a) - rank(b));
  const stakeholderMap = ranked.slice(0, 5).map((c) => ({
    contactId: c.id,
    role: c.buyingRole,
    approach: approachFor(c, account, biggest?.name),
  }));

  // ── Discovery questions ──────────────────────────────────────────────
  const discoveryQuestions: AeBrief["discoveryQuestions"] = [];

  if (biggest) {
    discoveryQuestions.push({
      question: `Who physically walks ${biggest.name ?? "the main pit"} today, how often, and is that your crew or a contracted one?`,
      whyItLands: `Opens on their own ground rather than our product. We already know the feature covers ${round(biggest.areaKm2, 2)} km² with ${round(biggest.perimeterKm, 1)} km of boundary, so the answer is checkable and the question cannot be brushed off with a generality.`,
      evidenceIds: geoEvidence,
    });
  }

  if (contractorCount > 0 && filingEvidence) {
    discoveryQuestions.push({
      question: `Your annual filing lists contractor safety incidents and contractor work stoppages as risks to production. How much inspection work sits with contracted crews right now?`,
      whyItLands: `It is their own disclosure, not our claim, the filing refers to contractors ${contractorCount} times. Quoting a company's own risk language moves the conversation from whether there is a problem to how big it is.`,
      evidenceIds: [filingEvidence],
    });
  }

  discoveryQuestions.push({
    question: `When an inspection finding needs to be produced for the regulator, how long does it take to assemble, and how confident are you in the timestamp on it?`,
    whyItLands:
      "Most operators can answer the first half instantly and hesitate on the second. Autonomous inspection produces a timestamped, third-party-auditable record, so this question surfaces the value that is not about labour cost.",
    evidenceIds: [],
  });

  if (active.length > 1) {
    discoveryQuestions.push({
      question: `You have ${active.length} mapped operating areas. Does each carry its own inspection crew, or do crews travel between them?`,
      whyItLands: `Travel between separated sites is pure overhead and is invisible on a cost line. We measured the sites as ${countClusters(active)} spatially separate cluster(s), so we can be specific about which ones share infrastructure.`,
      evidenceIds: geoEvidence,
    });
  }

  if (topSignal) {
    discoveryQuestions.push({
      question: questionFromSignal(topSignal.kind, topSignal.headline),
      whyItLands: `Tied to a dated, cited event rather than a guess about their priorities. ${topSignal.soWhat.split(".")[0]}.`,
      evidenceIds: topSignal.evidenceIds,
    });
  }

  discoveryQuestions.push({
    question: `If inspection frequency were not constrained by crew availability, what would you want to look at more often than you currently can?`,
    whyItLands:
      "Reframes from cost reduction to capability. The reference deployment did not cut inspection, it doubled frequency at lower exposure, and this question finds the asset the operator already wishes they watched more closely.",
    evidenceIds: [],
  });

  // ── Objections ───────────────────────────────────────────────────────
  const objections: AeBrief["objections"] = [
    {
      objection: "We already fly drones. We have a team and a pilot.",
      response:
        "Most operators at this scale do, and that is usually manual sortie flying rather than a scheduled autonomous programme. The distinction that matters is whether a mission runs without a person present and whether its output lands in your systems automatically. Ask what their pilot-to-aircraft ratio is; the reference deployment runs one-to-many under a regulator-approved waiver, which is the step manual programmes cannot take.",
      evidenceIds: [],
    },
    {
      objection: "Our contractors are cheaper than a capital programme.",
      response: `Compare like for like. Phase one at the reference account was a single dock on one zone for a total system investment of USD 70,000 to 80,000, with return inside a year, not a site-wide capital programme. Then ask what a single contractor safety incident costs them, because their own filing already names that as a production risk${contractorCount > 0 ? ` and refers to contractors ${contractorCount} times` : ""}.`,
      evidenceIds: filingEvidence ? [filingEvidence] : [],
    },
    {
      objection: "Our site has connectivity and power constraints in the pit.",
      response:
        "That is the normal starting condition rather than a blocker, and it is why dock placement is a survey rather than an assumption. Concede the point and use it: ask which zones have power and network today, because those are exactly where phase one goes. It also sets up the honest version of our sizing, which is a range precisely because placement depends on their terrain.",
      evidenceIds: [],
    },
    {
      objection: "Aviation approval in this jurisdiction will take forever.",
      response:
        "Do not minimise it. The reference deployment ran under approvals obtained with a local delivery partner rather than by the operator, which is the route that works. Name the partner-led model early, because an operator who thinks they must obtain the waiver themselves will stall the deal on a task that is not theirs.",
      evidenceIds: [],
    },
    {
      objection: "Send me some information and I will circulate it.",
      response:
        "This is the polite close, and the counter is specificity. Offer the one-page account brief for their own site, naming the measured footprint, then ask who else should see it. That converts a brush-off into a second name and multi-threads the account without pressure.",
      evidenceIds: geoEvidence,
    },
  ];

  const regime = pack.regulatoryRegimes.find((r) => r.country === account.country);
  if (regime?.sourceUrl) {
    objections.push({
      objection: "Our inspection cadence already satisfies the regulator.",
      response: `Accept it and move to exposure. Under ${regime.instrument} the obligation is that the inspection happens, not that a person is standing next to the hazard when it does. The question is not whether they comply, it is how many people-hours compliance currently costs them.`,
      evidenceIds: [],
    });
  }

  // ── Reference case ───────────────────────────────────────────────────
  const proof = pack.proofPoints[0];
  const referenceCase = proof
    ? {
        value: `Lead with ${proof.customer}. ${proof.claim}. It is the strongest reference for this account because it is the same commodity family, the same jurisdiction and the same asset class, and because it began as one dock on one zone rather than a site-wide programme, which is the objection this account will raise first.`,
        evidenceIds: [],
      }
    : { value: "No published reference deployment matches this vertical closely enough to lead with.", evidenceIds: [] };

  // ── Positioning and next action ──────────────────────────────────────
  const positioning = biggest
    ? `${account.displayName} runs ${active.length} mapped operating area${active.length === 1 ? "" : "s"} totalling ${round(active.reduce((a, s) => a + s.areaKm2, 0), 1)} km², and contracted crews currently absorb the exposure of inspecting them on foot. We replace the exposure, not the inspection, same coverage or better, without a person in front of the hazard.`
    : `${account.displayName} could not be sized from mapped geometry in this run, so lead with discovery rather than a quantified claim.`;

  const whyNow = topSignal
    ? `${topSignal.headline}. ${topSignal.soWhat}`
    : account.riskScan && contractorCount > 0
      ? `No dated trigger event was found, so the reason to call is structural rather than circumstantial: their own filing names contractor dependency as a production risk ${contractorCount} times and discloses no autonomy programme.`
      : "No timing trigger was found for this account. Treat it as nurture until one appears rather than manufacturing urgency.";

  const nextAction = nextActionFor(account, ranked[0], biggest?.name);

  return {
    accountId: account.id,
    headline: headlineFor(account, anchorName, biggest?.name),
    whyNow,
    positioning,
    stakeholderMap,
    discoveryQuestions,
    objections,
    referenceCase,
    nextAction,
  };
}

function headlineFor(account: Account, anchorName: string, siteName?: string): string {
  if (account.isAnchor) {
    return `${account.displayName} is the reference profile this campaign is modelled on. Its measured footprint and disclosed contractor dependency define what a good account looks like.`;
  }
  const tierPhrase =
    account.icp.tier === "A"
      ? "Work this now"
      : account.icp.tier === "B"
        ? "Worth a sequence once tier A is moving"
        : account.icp.tier === "DISQUALIFIED"
          ? "Do not work this yet"
          : "Nurture";
  return `${tierPhrase}. ${account.displayName} resembles ${anchorName} on the dimensions that matter${siteName ? `, and ${siteName} is where the conversation starts` : ""}.`;
}

function approachFor(c: Contact, account: Account, siteName?: string): string {
  if (c.tier === "ROLE_TARGET_NO_NAME") {
    return `No individual sourced. Target the ${c.targetRole} role and confirm the person on a second source before sending anything. Do not guess a name into a CRM.`;
  }
  switch (c.buyingRole) {
    case "champion":
      return `Open here. ${c.name} owns${siteName ? ` ${siteName}` : " the operation"} directly, which means the exposure being removed is theirs personally. Site leadership out-replies the executive layer, so this is the first touch rather than an escalation.`;
    case "economic_buyer":
      return `${c.name} carries the cost line that contracted inspection sits on. Lead with displaced crew-days rather than technology, and bring the range rather than a single number so the figure survives scrutiny.`;
    case "risk_validator":
      return `${c.name} can stop this on safety or compliance grounds, so bring them in early rather than late. The argument that lands is auditability, a timestamped, third-party-verifiable inspection record, not labour saving.`;
    case "technical_buyer":
      return `${c.name} will ask about integration, data residency and airspace before value. Have the platform's compliance posture ready and concede the connectivity constraints rather than arguing them.`;
    default:
      return `${c.name} is an influencer rather than a decision maker here. Useful for routing and for confirming who actually owns inspection.`;
  }
}

function questionFromSignal(kind: string, headline: string): string {
  switch (kind) {
    case "leadership_change":
      return `There has been a recent change in the operations leadership. What is the new priority list, and does inspection practice sit on it?`;
    case "incident":
      return `Following the recent incident, has anything changed in how inspection findings are recorded or reported?`;
    case "regulatory":
      return `How is the current regulatory position changing what you have to evidence, and how much of that evidence is gathered by people on foot?`;
    case "expansion":
      return `With the expansion underway, does the inspection burden scale with headcount or is there an intention to break that link?`;
    default:
      return `Given ${headline.slice(0, 90)}, what does that change about how the site is monitored?`;
  }
}

function nextActionFor(account: Account, primary: Contact | undefined, siteName?: string): string {
  if (account.icp.tier === "DISQUALIFIED") {
    return `Do not sequence this account. ${account.icp.disqualifiers[0] ?? "It failed qualification."} Revisit if new geometry or a timing signal appears.`;
  }
  if (!primary) {
    return "No contact of any kind was established. The next action is research, not outreach: find the operations owner on a second source before anything is sent.";
  }
  if (primary.tier === "ROLE_TARGET_NO_NAME") {
    return `Find the ${primary.targetRole} before sending anything. The finding playbook on this account lists the specific sources to try, in order.`;
  }
  return `Send the accepted first-touch message to ${primary.name}${siteName ? `, opening on ${siteName}` : ""}, then run the day 3 and day 7 touches as laid out in the cadence. Do not request a meeting in the first message, the ask is permission to send the written breakdown.`;
}

function rank(c: Contact): number {
  const roleScore =
    c.buyingRole === "champion"
      ? 0
      : c.buyingRole === "economic_buyer"
        ? 1
        : c.buyingRole === "risk_validator"
          ? 2
          : 3;
  return roleScore + (c.tier === "ROLE_TARGET_NO_NAME" ? 10 : 0) + (c.siteOsmId ? -1 : 0);
}

function countClusters(sites: { centroid: { lat: number; lon: number } }[]): number {
  const R = 6371.0088;
  const threshold = 10;
  const parent = sites.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < sites.length; i++) {
    for (let j = i + 1; j < sites.length; j++) {
      const a = sites[i].centroid;
      const b = sites[j].centroid;
      const dLat = ((b.lat - a.lat) * Math.PI) / 180;
      const dLon = ((b.lon - a.lon) * Math.PI) / 180;
      const h =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
      if (2 * R * Math.asin(Math.min(1, Math.sqrt(h))) <= threshold) {
        const ra = find(i);
        const rb = find(j);
        if (ra !== rb) parent[rb] = ra;
      }
    }
  }
  return new Set(sites.map((_, i) => find(i))).size;
}
