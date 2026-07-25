/**
 * Retrieval for the question box.
 *
 * The trust boundary that runs through the whole of this project runs through
 * here too, and it matters more here than anywhere else. A chat box over a
 * research tool is the easiest place in an application to start inventing
 * things: someone asks who runs Chuquicamata, and a language model that has read
 * the internet will happily produce a plausible name.
 *
 * So the model never retrieves. This module selects rows from the frozen run by
 * ordinary deterministic scoring, and those rows are the only material the
 * answer may use. If nothing scores, the answer says nothing was found and
 * offers to measure the ground live instead. The model's entire job is to turn
 * selected rows into a readable paragraph and to attach the identifiers it was
 * given.
 *
 * That division is also why the answer can carry citation chips: every claim in
 * it traces to a row that was chosen before the model saw the question.
 */

import type { Account, Contact, EvidenceRow, Run, Signal } from "./types";

export interface RetrievedFact {
  /** Short stable handle the model is told to cite, for example "F3". */
  ref: string;
  /** One line of established fact, already in plain language. */
  text: string;
  /** Evidence rows behind it, so the interface can render real chips. */
  evidence: EvidenceRow[];
  accountSlug?: string;
  kind: "geometry" | "contact" | "signal" | "filing" | "sizing" | "gap" | "outreach" | "method";
  score: number;
}

export interface Retrieval {
  facts: RetrievedFact[];
  /** Accounts the question appears to be about, for the follow-up links. */
  accounts: { slug: string; displayName: string }[];
  /** Set when the question names ground the corpus has not measured. */
  suggestsDiscovery: { place: string; vertical: string } | null;
  /** True when nothing scored, so the interface can say so plainly. */
  empty: boolean;
}

const STOP = new Set(
  `a an the is are was were be been being do does did of for to in on at by with from as and or but if then than that this these those what which who whom whose when where why how it its their they we you i me my our your can could should would will shall may might must have has had not no yes about into over under between during any all each some more most other such only own same so too very just now also
`
    .split(/\s+/)
    .filter(Boolean),
);

function terms(q: string): string[] {
  return q
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

/** How many query terms a haystack contains, weighted toward exact matches. */
function overlap(haystack: string, ts: string[]): number {
  const h = haystack.toLowerCase();
  let score = 0;
  for (const t of ts) {
    if (h.includes(t)) score += t.length > 5 ? 2 : 1;
  }
  return score;
}

/**
 * Vertical keywords, so "are there any solar farms in Chile" can be recognised
 * as a discovery request rather than answered from a mining corpus.
 */
const VERTICAL_HINTS: { id: string; words: string[] }[] = [
  { id: "mining", words: ["mine", "mining", "mina", "quarry", "copper", "lithium", "iron ore", "extraction", "tailings"] },
  { id: "solar", words: ["solar", "photovoltaic", "pv", "panel", "solar farm"] },
  { id: "oil_gas", words: ["oil", "gas", "refinery", "petroleum", "rig", "wellhead", "lng"] },
  { id: "ports", words: ["port", "harbour", "harbor", "terminal", "quay", "container"] },
  { id: "rail", words: ["rail", "railway", "railroad", "yard", "freight"] },
  { id: "grid", words: ["grid", "substation", "transmission", "powerline", "utility"] },
];

/**
 * Look for a place the corpus has not covered.
 *
 * Kept deliberately conservative. It fires on an explicit "in <somewhere>" or
 * "near <somewhere>" whose target is not a country already measured, because the
 * cost of wrongly offering a live search is a wasted click, while the cost of
 * answering a question about Western Australia out of a Chilean corpus is a
 * wrong answer stated confidently.
 */
function detectDiscovery(question: string, run: Run): { place: string; vertical: string } | null {
  const covered = new Set(
    run.accounts.flatMap((a) => [a.countryName?.toLowerCase(), a.displayName.toLowerCase()]).filter(Boolean) as string[],
  );

  // The article matters: "oil rigs in the North Sea" is the natural phrasing and
  // an earlier version of this pattern stopped dead on "the", so the offer to
  // measure never appeared for exactly the questions most likely to need it.
  const m = /\b(?:in|near|around|across|at)\s+(?:the\s+)?([A-Z][\p{L}\p{M}'.-]*(?:\s+[A-Z][\p{L}\p{M}'.-]*){0,3})/u.exec(
    question,
  );
  const place = m?.[1]?.trim();
  if (!place || place.length < 3) return null;
  if (covered.has(place.toLowerCase())) return null;

  const lower = question.toLowerCase();
  const hint = VERTICAL_HINTS.find((v) => v.words.some((w) => lower.includes(w)));
  return { place, vertical: hint?.id ?? "mining" };
}

const rowsFor = (run: Run, ids: string[] | undefined): EvidenceRow[] =>
  (ids ?? []).map((id) => run.evidence[id]).filter(Boolean);

export function retrieve(question: string, run: Run, limit = 9): Retrieval {
  const ts = terms(question);
  const candidates: Omit<RetrievedFact, "ref">[] = [];

  const wantsPeople = /who|contact|name|lead|head|director|manager|vp|person|people|reach/i.test(question);
  const wantsMoney = /cost|money|roi|payback|revenue|spend|save|saving|invest|price|budget|worth/i.test(question);
  const wantsRisk = /risk|safety|incident|hazard|accident|contractor|exposure/i.test(question);
  const wantsGaps = /gap|missing|fail|could not|couldn't|unknown|limitation|weakness|wrong/i.test(question);
  // "Which account do I call first" is the most common question a rep has, and
  // the plain term overlap missed it entirely: the words that carry the intent
  // are "first" and "call", neither of which appears in a scoring dimension.
  const wantsWhyNow =
    /why now|right now|timing|urgent|recent|latest|happening|changed|trigger|reason to (?:call|contact|reach)|strongest reason/i.test(
      question,
    );
  const wantsPriority =
    /\b(first|priority|prioriti|best|top|rank|start|begin|which account|who should|most promising|highest)\b/i.test(
      question,
    );

  for (const account of run.accounts) {
    const nameHit = overlap(`${account.displayName} ${account.legalName ?? ""} ${account.countryName ?? ""}`, ts);

    // ── geometry ────────────────────────────────────────────────────────
    const active = account.sites.filter((s) => !s.excluded);
    if (active.length > 0) {
      const area = active.reduce((t, s) => t + s.areaKm2, 0);
      candidates.push({
        kind: "geometry",
        accountSlug: account.slug,
        text: `${account.displayName} holds ${area.toFixed(2)} km² of mapped footprint across ${active.length} measured feature(s) in ${account.countryName}. The largest is ${active[0]?.name ?? active[0]?.osmId} at ${active[0]?.areaKm2.toFixed(2)} km².`,
        evidence: rowsFor(run, active[0]?.evidenceIds),
        score: nameHit * 3 + overlap("footprint area site km2 ground measured geometry map polygon", ts) * 2,
      });
    }

    // ── qualification ───────────────────────────────────────────────────
    candidates.push({
      kind: "sizing",
      accountSlug: account.slug,
      text: `${account.displayName} scores ${account.icp.total} out of 100 on the published weights, placing it in tier ${account.icp.tier}. ${account.anchorComparison.value}`,
      evidence: rowsFor(run, account.anchorComparison.evidenceIds),
      score: nameHit * 2 + (wantsPriority ? 4 : 0) + overlap("score tier icp qualify rank fit best priority why", ts) * 2,
    });

    if (account.sizing) {
      const s = account.sizing;
      candidates.push({
        kind: "sizing",
        accountSlug: account.slug,
        text: `A programme at ${account.displayName} sizes to ${s.docksRequired.low} to ${s.docksRequired.high} docking stations, ${s.missionsPerMonth.low} to ${s.missionsPerMonth.high} missions a month, displacing ${s.contractorCrewDaysDisplacedPerMonth.low} to ${s.contractorCrewDaysDisplacedPerMonth.high} contracted crew-days a month. Every assumption behind that is listed on the account page.`,
        evidence: [],
        score: nameHit * 2 + (wantsMoney ? 6 : 0) + overlap("dock mission flight crew programme size sizing", ts) * 2,
      });
    }

    // ── contacts ────────────────────────────────────────────────────────
    for (const c of account.contacts) {
      const hit = overlap(`${c.name ?? ""} ${c.titleVerbatim ?? ""} ${c.targetRole ?? ""}`, ts);
      if (c.name) {
        candidates.push({
          kind: "contact",
          accountSlug: account.slug,
          text: `${c.name} is recorded at ${account.displayName} as "${c.titleVerbatim ?? c.targetRole}". Provenance tier ${c.tier}${c.email?.status === "OBSERVED" ? `, published address ${c.email.address}` : ", no published address, so any address would be a guess and is not offered as sendable"}.`,
          evidence: rowsFor(run, c.evidenceIds),
          score: hit * 4 + nameHit * 2 + (wantsPeople ? 5 : 0),
        });
      } else {
        candidates.push({
          kind: "gap",
          accountSlug: account.slug,
          text: `At ${account.displayName} the seat "${c.targetRole}" is a role target with no individual found. No name is offered for it, and the record instead states how to find one.`,
          evidence: rowsFor(run, c.evidenceIds),
          score: hit * 3 + nameHit + (wantsPeople ? 3 : 0) + (wantsGaps ? 4 : 0),
        });
      }
    }

    // ── signals ─────────────────────────────────────────────────────────
    for (const sig of account.signals as Signal[]) {
      candidates.push({
        kind: "signal",
        accountSlug: account.slug,
        text: `${sig.occurredAt ? `${sig.occurredAt}: ` : ""}${sig.headline} (${account.displayName}). Urgency ${sig.urgency.toFixed(2)}. ${sig.soWhat}`,
        evidence: rowsFor(run, sig.evidenceIds),
        score:
          overlap(`${sig.headline} ${sig.soWhat}`, ts) * 3 +
          nameHit * 3 +
          (wantsWhyNow ? 10 : 0) +
          overlap("timing signal event trigger recent change news appointment incident", ts) * 2,
      });
    }

    // ── primary filing ──────────────────────────────────────────────────
    if (account.riskScan) {
      const top = account.riskScan.passages[0];
      candidates.push({
        kind: "filing",
        accountSlug: account.slug,
        text: `${account.displayName}'s own filing refers to contractors ${account.riskScan.termCounts?.contractor ?? 0} time(s) and safety ${account.riskScan.termCounts?.safety ?? 0} time(s).${top ? ` It states, verbatim: "${top.verbatim.slice(0, 220)}"` : ""}`,
        evidence: top ? rowsFor(run, [top.evidenceId]) : [],
        score: nameHit * 2 + (wantsRisk ? 6 : 0) + overlap("filing disclosure annual report 20-f contractor safety risk", ts) * 2,
      });
    }
  }

  // ── the ranking, as one comparative fact ──────────────────────────────
  //
  // Built here rather than left to the model, because ordering accounts is
  // arithmetic and a model asked to rank will happily reorder them.
  if (run.accounts.length > 1) {
    const ranked = [...run.accounts].sort((a, b) => b.icp.total - a.icp.total);
    const lead = ranked[0];
    const leadSignal = [...lead.signals].sort((x, y) => y.urgency - x.urgency)[0];
    candidates.push({
      kind: "sizing",
      accountSlug: lead.slug,
      text: `Ranked by the published weights, the order is ${ranked
        .map((a) => `${a.displayName} ${a.icp.total}`)
        .join(", ")}. ${lead.displayName} leads on ${lead.icp.total} out of 100.${
        leadSignal ? ` Its strongest timing signal is: ${leadSignal.headline}` : ""
      }`,
      evidence: leadSignal ? rowsFor(run, leadSignal.evidenceIds) : [],
      score: (wantsPriority ? 14 : 0) + overlap("rank order score tier compare priority which", ts) * 2,
    });
  }

  // ── gaps, which the brief explicitly asks to be shown ─────────────────
  for (const gap of run.nullResults ?? []) {
    candidates.push({
      kind: "gap",
      text: `Recorded gap on ${gap.subject}: ${gap.question} ${gap.interpretation} ${gap.remediation}`.trim(),
      evidence: [],
      score: overlap(`${gap.subject} ${gap.question} ${gap.interpretation}`, ts) * 3 + (wantsGaps ? 7 : 0),
    });
  }

  // ── method, so "how does this work" is answerable from the corpus ─────
  candidates.push({
    kind: "method",
    text: `Accounts here are discovered by measuring mapped industrial features rather than by asking a model to list companies. Footprints are the spherical excess of the returned boundary, contacts come from statutory disclosures and company pages with the title quoted verbatim, and scoring is ordinary arithmetic on published weights with no model involved. This run holds ${Object.keys(run.evidence).length} evidence rows and ${(run.nullResults ?? []).length} recorded gaps.`,
    evidence: [],
    score: overlap("how work method approach pipeline agent trust measure prove why believe hallucinat fabricat", ts) * 3,
  });

  // At most three of any one kind.
  //
  // Without this, a question mentioning Codelco returned nine Codelco contacts
  // and the model never saw the timing signal, the footprint or the filing that
  // actually answered it. One account can have a dozen named officers, and term
  // overlap gives them all the same score, so the highest scoring nine were nine
  // near duplicates. Capping per kind guarantees the answer is written from a
  // spread of evidence rather than from whichever category happens to be
  // largest.
  const perKind = new Map<string, number>();
  const facts = candidates
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .filter((c) => {
      const seen = perKind.get(c.kind) ?? 0;
      if (seen >= 3) return false;
      perKind.set(c.kind, seen + 1);
      return true;
    })
    .slice(0, limit)
    .map((c, i) => ({ ...c, ref: `F${i + 1}` }));

  const named = run.accounts
    .filter((a) => overlap(`${a.displayName} ${a.legalName ?? ""}`, ts) > 0)
    .map((a) => ({ slug: a.slug, displayName: a.displayName }));

  return {
    facts,
    accounts: named.length > 0 ? named : facts.length > 0 ? accountsOf(run, facts) : [],
    suggestsDiscovery: detectDiscovery(question, run),
    empty: facts.length === 0,
  };
}

function accountsOf(run: Run, facts: RetrievedFact[]): { slug: string; displayName: string }[] {
  const slugs = new Set(facts.map((f) => f.accountSlug).filter(Boolean) as string[]);
  return run.accounts.filter((a) => slugs.has(a.slug)).map((a) => ({ slug: a.slug, displayName: a.displayName }));
}

/**
 * The instruction block. Held byte-identical across requests so it stays in the
 * provider's prompt cache, where cached tokens do not count against the rate
 * limit.
 */
export const ASK_PREFIX = `You answer questions about an outbound research run for FlytBase, an autonomous drone inspection company.

Absolute rules, in order of importance:

1. Use ONLY the numbered FACTS supplied with the question. You have no other knowledge of these companies, sites or people. If the FACTS do not answer the question, say plainly that this run does not contain the answer, and say what would.
2. Never state a person's name, a company name, a number, a date or a place that is not in the FACTS. Not one. If you are tempted to add context you know from elsewhere, do not.
3. Cite every claim by appending the fact handle in square brackets, for example [F2]. A sentence carrying a figure or a name must carry a handle.
4. Answer in at most 130 words, in plain language a salesperson would use. No headings, no bullet lists unless the question asks for a list, no preamble.
5. Never use an em dash. Use a comma, a colon or a full stop.
6. If the FACTS record that something could not be found, say so directly. A recorded gap is a real answer and is more useful than a guess.
7. Do not offer to do anything, do not ask a follow-up question, and do not describe your own reasoning. State the answer.`;

export function buildAskPrompt(question: string, retrieval: Retrieval): string {
  const lines = ["FACTS:"];
  for (const f of retrieval.facts) {
    lines.push(`[${f.ref}] ${f.text}`);
  }
  if (retrieval.facts.length === 0) {
    lines.push("(none: nothing in this run scored against the question)");
  }
  lines.push("", `QUESTION: ${question}`);
  return lines.join("\n");
}
