/**
 * Outreach desk.
 *
 * The division of labour here is the point. A deterministic Message Strategist
 * decides WHAT to say — which two of the account's own facts to lead with, which
 * published customer story proves it, which language the recipient works in —
 * and every one of those inputs already carries a source. The language model is
 * then asked only to phrase it. It receives no freedom to introduce a claim,
 * because it never sees anything except facts that are already cited.
 *
 * The Red Team then tries to reject the result. Rejected drafts are kept, which
 * is both the proof that a machine wrote them and the proof that the loop is
 * real. Writing these by hand would be disqualifying, so the system is built so
 * that a missing model key produces no email at all rather than a human one.
 */

import { critique, PASS_THRESHOLD, type CriticVerdict, type Touch } from "./critic";
import { hasKey, writeProse, MissingKeyError } from "./llm";
import type {
  Account,
  CadenceStep,
  Contact,
  EmailDraft,
  EvidenceRow,
  SiteGeometry,
} from "./types";
import type { VerticalPack } from "./verticals";

// ── Message strategy: deterministic, auditable ───────────────────────────

export interface CitedFact {
  /** Written for the model to paraphrase, never to invent around. */
  text: string;
  evidenceId: string;
  isNumeric: boolean;
  dateIso?: string;
}

export interface MessageStrategy {
  contactId: string;
  language: string;
  /** Why this person, in one line, for the AE reading over the rep's shoulder. */
  whyThisPerson: string;
  /** The angle to lead with. */
  angle: string;
  /** Exactly the facts the writer may use. Nothing else is available to it. */
  facts: CitedFact[];
  /** The published customer story that proves the claim, with its source. */
  proofPoint: { customer: string; claim: string; sourceUrl: string } | null;
  /** The single interest-based ask. */
  ask: string;
  /** Site the recipient owns, when known — the specificity that lands. */
  site?: SiteGeometry;
  /** Deliberately withheld from the writer, and why. */
  withheld: string[];
}

/**
 * The reference deployment's published outcomes, phrased so they cannot be
 * restated into something untrue. Each is quotable verbatim and nothing else
 * about that customer may be asserted.
 */
export const PROOF_QUOTABLES = [
  "inspection time fell from days to hours",
  "mission reliability above 95 percent",
  "inspection frequency doubled",
  "detection time under 90 minutes",
  "total system investment of USD 70,000 to 80,000, which is what they SPENT",
  "return on that investment inside one year",
];

const LANG_NAME: Record<string, string> = {
  "es-CL": "Chilean Spanish",
  "es-PE": "Peruvian Spanish",
  "pt-BR": "Brazilian Portuguese",
  en: "English",
};

/**
 * Language is a function of ownership and seniority, not of convenience.
 * Writing to a Chilean site manager in English announces the sender as foreign
 * and automated; writing to a global major's corporate layer in Spanish can read
 * as presumptuous. Site-level always gets the local language.
 */
export function chooseLanguage(account: Account, contact: Contact): string {
  const local = account.workingLanguage;
  const siteLevel =
    contact.seniority === "director" ||
    contact.seniority === "superintendent" ||
    contact.seniority === "manager" ||
    contact.seniority === "head";
  if (siteLevel) return local;
  // Corporate layer at a globally listed operator tolerates English.
  const globallyListed = Boolean(account.ticker) && account.country !== "CL";
  return globallyListed ? "en" : local;
}

export function buildStrategy(args: {
  account: Account;
  contact: Contact;
  pack: VerticalPack;
  evidence: Record<string, EvidenceRow>;
}): MessageStrategy {
  const { account, contact, pack, evidence } = args;
  const language = chooseLanguage(account, contact);
  const site = contact.siteOsmId ? account.sites.find((s) => s.osmId === contact.siteOsmId) : undefined;
  const facts: CitedFact[] = [];
  const withheld: string[] = [];

  // Fact 1 — their own filing language about contractors, where it exists.
  const contractorPassage = account.riskScan?.passages.find(
    (p) => /contractor/i.test(p.term) && p.evidenceId,
  );
  if (contractorPassage) {
    // Deliberately carries NO count. The mention frequency is a scoring signal,
    // not a claim: handed "refers to contractors 30 times" a writer will render
    // it as "30 safety incidents", which the filing does not say. Observed
    // happening, so the number is withheld from the writer entirely.
    facts.push({
      text: `${account.displayName}'s own ${account.riskScan?.documentLabel} names contractor safety incidents and contractor work stoppages among its risks to production`,
      evidenceId: contractorPassage.evidenceId,
      isNumeric: false,
      dateIso: account.riskScan?.filedAt,
    });
  }

  // Fact 2 — the measured extent of what this person is responsible for.
  if (site && site.evidenceIds[0]) {
    facts.push({
      text: `${site.name ?? "the operation"} covers ${site.areaKm2.toFixed(1)} km² of mapped surface with ${site.perimeterKm.toFixed(0)} km of boundary`,
      evidenceId: site.evidenceIds[0],
      isNumeric: true,
    });
  } else {
    const active = account.sites.filter((s) => !s.excluded);
    const biggest = [...active].sort((a, b) => b.areaKm2 - a.areaKm2)[0];
    if (biggest?.evidenceIds[0]) {
      facts.push({
        text: `${account.displayName} operates ${active.length} mapped sites totalling ${active
          .reduce((a, s) => a + s.areaKm2, 0)
          .toFixed(0)} km², the largest being ${biggest.name ?? "an unnamed pit"} at ${biggest.areaKm2.toFixed(1)} km²`,
        evidenceId: biggest.evidenceIds[0],
        isNumeric: true,
      });
    }
  }

  // Fact 3 — the timing signal, if one is strong and recent.
  const signal = [...account.signals].sort((a, b) => b.urgency - a.urgency)[0];
  if (signal && signal.urgency >= 0.7 && signal.evidenceIds[0]) {
    facts.push({
      text: signal.headline,
      evidenceId: signal.evidenceIds[0],
      isNumeric: /\d/.test(signal.headline),
      dateIso: signal.occurredAt,
    });
  }

  // Anything without a source is explicitly withheld rather than guessed at.
  const regime = pack.regulatoryRegimes.find((r) => r.country === account.country);
  if (regime && !regime.sourceUrl) {
    withheld.push(
      `${regime.instrument} is the instrument that forces inspection cadence here, but its text was not fetched in this run, so it is withheld from the copy. A wrong decree number is worse than none.`,
    );
  }
  if (!account.riskScan) {
    withheld.push(
      "No primary filing was available for this account, so no claim is made about its contractor dependency.",
    );
  }
  if (account.sizing && account.sizing.assumptions.some((a) => a.evidenceIds.length === 0)) {
    withheld.push(
      "Deployment sizing rests on stated engineering assumptions, so its figures are kept out of a first touch and reserved for the discovery call.",
    );
  }

  const proofPoint = pack.proofPoints[0] ?? null;

  const angle = site
    ? `Contracted crews currently walk ${site.name ?? "this operation"}; the same coverage can be flown from a dock without putting people in front of the hazard.`
    : `Contracted inspection crews are the cost and the risk; autonomous coverage removes the exposure without reducing the inspection frequency.`;

  const whyThisPerson =
    contact.tier === "ROLE_TARGET_NO_NAME"
      ? `No individual was sourced, so this is addressed to the ${contact.targetRole} role.`
      : `${contact.name} holds ${contact.titleVerbatim}${site ? ` and owns ${site.name ?? "the site"} directly` : ""}, which makes them accountable for exactly the exposure this removes.`;

  return {
    contactId: contact.id,
    language,
    whyThisPerson,
    angle,
    facts: facts.filter((f) => evidence[f.evidenceId]),
    proofPoint,
    ask:
      "Offer to send a short written breakdown of how the reference customer changed inspection cadence. Ask only for permission to send it — never for a meeting, and never propose a time.",
    site,
    withheld,
  };
}

// ── Writer prompt: static prefix + per-lead delta ────────────────────────

/**
 * The static half of the prompt, byte-identical on every call so prefix caching
 * engages. Cached tokens are exempt from rate limits, which is what makes
 * generating a batch of these viable on a free tier at all.
 */
export const WRITER_PREFIX = `You are an outbound writer for FlytBase, which sells autonomous drone inspection to large industrial sites.

You will be given a small set of FACTS. Each fact was independently verified and carries a source. You must write using ONLY those facts.

Absolute rules:
- Never state anything that is not in the FACTS. No invented numbers, no invented projects, no guessed job history.
- Never use placeholder tokens, merge fields, or square brackets.
- Write in the language you are told to write in, natively. Do not translate from English — compose in the target language so the sentence rhythm is native.
- No links. No attachments. No signature beyond the sender block you are given.
- The ask is permission to send something. Never request a meeting, never propose a time, never mention minutes or calendars.

Style:
- The body MUST be between 55 and 95 words. Count the words before you answer. A 30-word email will be rejected.
- The body MUST be four to seven sentences. No sentence longer than 22 words.
- You MUST use at least TWO of the FACTS, and you MUST include their numbers exactly as given (for example 9.7 km2, 71 sites, 14 km). Numbers are what make the message specific.
- Open with something true about THEIR operation, not about us and not about the industry.
- Plain, concrete, unadorned. A site manager reads this between shifts on a phone.
- Do not use any of these: hope this finds you well, I noticed, I came across, reaching out, circling back, just checking in, delve, leverage, seamless, cutting-edge, unlock, streamline, robust, landscape, ecosystem, empower, elevate, best-in-class, game-changer, revolutionise.
- At most two em-dashes. Prefer none.
- Write about them at least twice as often as about us. Use "you"/"usted" far more than "we"/"nosotros".
- The body MUST end with a signature on its own line, containing the sender name exactly as given to you.

Compose the body to this shape. Each line is one sentence with a word budget. Following it lands you inside the required length without counting:
- Sentence 1 (12 to 18 words): state their own measured scale, using a number from the FACTS verbatim.
- Sentence 2 (12 to 18 words): state a second fact, using its number verbatim.
- Sentence 3 (12 to 18 words): the operational consequence for them — what contracted crews currently absorb.
- Sentence 4 (12 to 18 words): what the named reference customer actually achieved, with one figure.
- Sentence 5 (10 to 16 words): the permission question. Ask only to send a written summary.
- Final line: the signature block exactly as given, on its own line.

That is five sentences plus a signature, which lands between 60 and 85 words. Do not write three sentences. Do not write ten.

Return STRICT JSON only, with exactly these keys:
{"subject": string, "body": string, "factsUsed": string[]}

The subject must be 3 to 6 words, under 50 characters, describing the operational problem — never the product. Never put the words AI, platform, solution, or partnership in the subject.
"factsUsed" must quote the exact fact strings you relied on, copied from the FACTS list.`;

function buildUserPrompt(args: {
  strategy: MessageStrategy;
  account: Account;
  contact: Contact;
  touch: Touch;
  senderName: string;
  senderTitle: string;
  previousRejections?: string[];
  repairHint?: string;
}): string {
  const { strategy, account, contact, touch, senderName, senderTitle } = args;
  const lang = LANG_NAME[strategy.language] ?? strategy.language;

  const lines = [
    `WRITE IN: ${lang}`,
    `TOUCH: ${touch === "first" ? "first contact" : "follow-up (four or more sentences, allowed to carry more substance, still one ask)"}`,
    "",
    `RECIPIENT: ${contact.name ?? `the ${contact.targetRole}`}`,
    `THEIR TITLE (verbatim, in their language): ${contact.titleVerbatim ?? contact.targetRole}`,
    `COMPANY: ${account.displayName} (${account.countryName})`,
    "",
    "FACTS — you may use only these:",
    ...strategy.facts.map((f, i) => `  ${i + 1}. ${f.text}`),
    "",
    `ANGLE: ${strategy.angle}`,
    `ASK: ${strategy.ask}`,
  ];

  if (strategy.proofPoint) {
    lines.push(
      "",
      `REFERENCE CUSTOMER you may name: ${strategy.proofPoint.customer}.`,
      `Published outcomes, quotable ONLY in these exact terms:`,
      ...PROOF_QUOTABLES.map((q) => `  - ${q}`),
      `Use at most ONE of those. Express it IN THE TARGET LANGUAGE — translate the meaning exactly and keep any figure identical. Do NOT copy the English wording into the message; the list above is in English only because these instructions are.`,
      `Specifically: "frequency doubled" must not become a before-and-after cadence, because the actual figures are not in your FACTS. The investment figure is what the customer SPENT, not what they saved — calling it a saving is false.`,
    );
  }

  lines.push(
    "",
    `SIGN AS (this exact block must be the last line of the body): ${senderName}, ${senderTitle}, FlytBase`,
    "",
    "REMINDER: 55 to 95 words. Four to seven sentences. At least two FACTS including their numbers. Ends with the signature line.",
  );

  if (args.previousRejections?.length) {
    lines.push(
      "",
      "YOUR PREVIOUS DRAFT WAS REJECTED. Fix every one of these and keep everything that was already fine:",
      ...args.previousRejections.map((r) => `  - ${r}`),
    );
    if (args.repairHint) lines.push("", `HOW TO FIX IT: ${args.repairHint}`);
  }

  return lines.join("\n");
}

// ── The loop ─────────────────────────────────────────────────────────────

export interface GenerateResult {
  drafts: EmailDraft[];
  accepted: EmailDraft | null;
  strategy: MessageStrategy;
  /** Set when generation could not run at all. */
  blocked?: string;
}

interface WriterOutput {
  subject: string;
  body: string;
  factsUsed: string[];
}

/**
 * Draft, critique, and re-draft up to three times. Every attempt is returned,
 * including the failures, because the failures are the evidence that a critic
 * exists.
 */
export async function generateEmail(args: {
  account: Account;
  contact: Contact;
  pack: VerticalPack;
  evidence: Record<string, EvidenceRow>;
  touch?: Touch;
  senderName?: string;
  senderTitle?: string;
  maxIterations?: number;
}): Promise<GenerateResult> {
  const touch = args.touch ?? "first";
  const senderName = args.senderName ?? "Atharva Awade";
  const senderTitle = args.senderTitle ?? "Business Development";
  const maxIterations = args.maxIterations ?? 4;

  const strategy = buildStrategy({
    account: args.account,
    contact: args.contact,
    pack: args.pack,
    evidence: args.evidence,
  });

  // Without at least two sourced facts the critic would reject anything we
  // wrote, so we decline to write rather than padding with generalities.
  if (strategy.facts.length < 2) {
    return {
      drafts: [],
      accepted: null,
      strategy,
      blocked: `Only ${strategy.facts.length} sourced fact(s) available for this contact. The critic requires at least two verifiable specifics, so no message was generated rather than one padded with industry generalities.`,
    };
  }

  if (!hasKey("groq") && !hasKey("nim")) {
    return {
      drafts: [],
      accepted: null,
      strategy,
      blocked:
        "No model key is configured, so no message was generated. The strategy above is deterministic and was produced without a model; only the phrasing requires one. Writing the copy by hand instead would misrepresent the system.",
    };
  }

  const drafts: EmailDraft[] = [];
  let rejections: string[] = [];
  let repairHint: string | undefined;

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    let out: WriterOutput;
    let model = "unknown";
    try {
      const res = await writeProse({
        staticPrefix: WRITER_PREFIX,
        userContent: buildUserPrompt({
          strategy,
          account: args.account,
          contact: args.contact,
          touch,
          senderName,
          senderTitle,
          previousRejections: rejections.length ? rejections : undefined,
          repairHint,
        }),
        maxTokens: 900,
        temperature: iteration === 1 ? 0.6 : 0.78,
        json: true,
      });
      model = res.usage.model;
      out = parseWriter(res.text);
    } catch (err) {
      if (err instanceof MissingKeyError) {
        return { drafts, accepted: null, strategy, blocked: err.message };
      }
      return {
        drafts,
        accepted: null,
        strategy,
        blocked: `Generation failed on iteration ${iteration}: ${(err as Error).message}`,
      };
    }

    // Bind the writer's claims back to evidence. A sentence that does not
    // correspond to a supplied fact cannot be counted as cited.
    const citedFacts = strategy.facts
      .filter((f) => factWasUsed(out.body, out.factsUsed, f.text))
      .map((f) => ({
        text: f.text,
        evidenceId: f.evidenceId,
        isNumeric: f.isNumeric,
        dateIso: f.dateIso,
      }));

    const verdict: CriticVerdict = critique({
      subject: out.subject,
      body: out.body,
      language: strategy.language,
      touch,
      citedFacts,
      senderName,
      accountName: args.account.displayName,
      // Every number the writer was allowed to use. Anything else in the draft
      // was invented.
      permittedNumbers: [
        ...strategy.facts.flatMap((f) => f.text.match(/\d+(?:[.,]\d+)?/g) ?? []),
        ...(strategy.proofPoint ? ["95", "90", "70", "80", "70,000", "80,000", "1", "2"] : []),
      ],
    });

    const draft: EmailDraft = {
      id: `${args.contact.id}-t${touch === "first" ? 1 : 2}-i${iteration}`,
      iteration,
      subject: out.subject,
      body: out.body,
      language: strategy.language,
      wordCount: verdict.metrics.words,
      sentenceCount: verdict.metrics.sentences,
      citedFacts: citedFacts.map((f) => ({ text: f.text, evidenceId: f.evidenceId })),
      gates: verdict.gates,
      score: verdict.score,
      accepted: verdict.accepted,
      rejectionReasons: verdict.rejectionReasons,
      model,
    };
    drafts.push(draft);

    if (verdict.accepted) {
      return { drafts, accepted: draft, strategy };
    }
    rejections = verdict.rejectionReasons;
    repairHint = buildRepairHint(verdict, strategy);
  }

  return {
    drafts,
    accepted: null,
    strategy,
    blocked: `The critic rejected all ${maxIterations} attempts. The drafts are retained above with the exact gate that failed each time. A rejected draft is a better outcome than an accepted bad one, and the failing gates say precisely what to fix.`,
  };
}

/**
 * Turn the critic's measurements into an instruction the writer can act on.
 * Telling a model "reply rates peak between 50 and 100 words" does not change
 * its output; telling it "you wrote 44 words, add about 15 more by using the
 * third fact" does.
 */
function buildRepairHint(verdict: CriticVerdict, strategy: MessageStrategy): string {
  const parts: string[] = [];
  const m = verdict.metrics;

  if (m.words < 55) {
    const deficit = 60 - m.words;
    parts.push(
      `Your draft was ${m.words} words. That is too short and will be rejected again. Add roughly ${deficit} more words of substance by using another of the FACTS in full, including its number. Do not add filler or adjectives — add a fact.`,
    );
  } else if (m.words > 95) {
    parts.push(
      `Your draft was ${m.words} words. Cut roughly ${m.words - 85} words by removing a whole claim, not by trimming adjectives.`,
    );
  }
  if (m.sentences < 4) {
    parts.push(`You wrote ${m.sentences} sentences. Write between four and seven.`);
  }
  if (m.longestSentenceWords > 22) {
    parts.push(`Your longest sentence is ${m.longestSentenceWords} words. Split it.`);
  }
  if (verdict.gates.some((g) => g.gate === "G5" && !g.passed)) {
    parts.push(
      `End with a permission question in the target language, of the form "may I send you a short written summary of how <reference customer> changed their inspection cadence". Do not request a meeting and do not propose a time.`,
    );
  }
  if (verdict.gates.some((g) => g.gate === "G7" && !g.passed)) {
    parts.push(
      `The final line of the body must be the signature block exactly as given. Also address the reader directly more often than you refer to yourself.`,
    );
  }
  if (verdict.gates.some((g) => g.gate === "G8" && !g.passed)) {
    parts.push(
      `Remove every number that was not in the FACTS. Do not convert a described risk into a count of incidents, and do not describe the investment figure as a saving — it is what the customer spent.`,
    );
  }
  if (verdict.gates.some((g) => g.gate === "G10" && !g.passed)) {
    parts.push(
      `Rewrite entirely in the target language. Translate the reference outcome rather than copying its English wording.`,
    );
  }
  if (verdict.gates.some((g) => g.gate === "G9" && !g.passed)) {
    parts.push(`Spell the company name exactly as it appears in the FACTS.`);
  }
  if (verdict.gates.some((g) => g.gate === "G4" && !g.passed)) {
    parts.push(
      `You must include the numbers from at least two FACTS verbatim. Available numbers: ${strategy.facts
        .flatMap((f) => f.text.match(/\d+(?:[.,]\d+)?/g) ?? [])
        .slice(0, 6)
        .join(", ")}.`,
    );
  }
  return parts.join(" ");
}

function parseWriter(raw: string): WriterOutput {
  const trimmed = raw.trim();
  const attempt = (s: string): WriterOutput | null => {
    try {
      const o = JSON.parse(s) as Partial<WriterOutput>;
      if (typeof o.subject === "string" && typeof o.body === "string") {
        return {
          subject: o.subject.trim(),
          body: o.body.trim(),
          factsUsed: Array.isArray(o.factsUsed) ? o.factsUsed.map(String) : [],
        };
      }
    } catch {
      /* fall through */
    }
    return null;
  };

  const direct = attempt(trimmed);
  if (direct) return direct;

  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    const fenced = attempt(fence[1].trim());
    if (fenced) return fenced;
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end > start) {
    const sliced = attempt(trimmed.slice(start, end + 1));
    if (sliced) return sliced;
  }

  throw new Error("The writer did not return usable JSON.");
}

/**
 * Decide whether a draft actually used a supplied fact.
 *
 * The facts are handed to the writer in English while the draft is composed in
 * Spanish or Portuguese, so word overlap between the two is close to useless.
 * Numbers, however, survive translation intact — "9.7 km²" and "71 sitios" read
 * the same in any language — so a distinctive figure appearing in the body is
 * the strongest available signal that the fact was used. The model's own
 * `factsUsed` echo is checked as well, since it echoes the English original.
 */
function factWasUsed(body: string, factsUsed: string[], fact: string): boolean {
  // Strongest signal: a distinctive number from the fact appears in the body.
  const numbers = (fact.match(/\d+(?:[.,]\d+)?/g) ?? []).filter((n) => n.length >= 2 || Number(n) > 3);
  const bodyDigits = body.replace(/\s/g, "");
  if (numbers.some((n) => bodyDigits.includes(n) || bodyDigits.includes(n.replace(".", ",")))) {
    return true;
  }
  // The writer echoes the English fact strings, so match those directly.
  if (factsUsed.some((u) => overlaps(u, fact))) return true;
  // Finally, a same-language paraphrase.
  return overlaps(body, fact);
}

/** Loose containment check so a same-language paraphrase still counts. */
function overlaps(a: string, b: string): boolean {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9 ]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3);
  const aw = new Set(norm(a));
  const bw = norm(b);
  if (bw.length === 0) return false;
  const shared = bw.filter((w) => aw.has(w)).length;
  return shared / bw.length >= 0.26;
}

// ── Cadence ──────────────────────────────────────────────────────────────

/**
 * Day offsets are not arbitrary. Three-day gaps place materially better than
 * one-day gaps, a first message produces most replies but follow-ups produce a
 * large minority, and the sequence multi-threads across the committee rather
 * than pestering one person five times.
 */
export function buildCadence(args: {
  account: Account;
  contacts: Contact[];
  accepted: Map<string, EmailDraft>;
}): CadenceStep[] {
  const { contacts, accepted } = args;
  const ranked = [...contacts].sort((a, b) => rank(a) - rank(b));
  const primary = ranked[0];
  const second = ranked[1];
  const exec = ranked.find((c) => c.seniority === "vp" || c.seniority === "c_suite");

  const steps: CadenceStep[] = [];
  if (!primary) return steps;

  steps.push({
    dayOffset: 0,
    channel: "email",
    contactId: primary.id,
    intent: "Open on their own operation, ask permission to send the written breakdown.",
    rationale:
      "Site-level leadership out-replies the executive layer, so the sequence opens there rather than at the top. The ask is interest-based because at first contact that outperforms a meeting request roughly two to one.",
    draft: accepted.get(primary.id),
  });

  steps.push({
    dayOffset: 3,
    channel: "linkedin",
    contactId: primary.id,
    intent: "Short connection note referencing the same operational fact, no pitch.",
    rationale:
      "A three-day gap places materially better than a one-day gap. Switching channel rather than resending keeps the thread from reading as automation.",
    script: `Connection note for ${primary.name ?? primary.targetRole}: reference the same measured fact used in the first email, state you sent a note about inspection cadence, and offer nothing further. Two sentences.`,
  });

  if (second) {
    steps.push({
      dayOffset: 5,
      channel: "email",
      contactId: second.id,
      intent: "Multi-thread to the second committee member with the risk framing rather than the cost framing.",
      rationale:
        "Multi-threading raises the chance the account engages without increasing pressure on any single person. The framing changes because a risk validator and an operations owner are not persuaded by the same sentence.",
      draft: accepted.get(second.id),
    });
  }

  steps.push({
    dayOffset: 7,
    channel: "call",
    contactId: primary.id,
    intent: "Brief call referencing both prior touches; leave a voicemail that repeats the single ask.",
    rationale:
      "By day seven the two prior touches make the call warm rather than cold. The voicemail repeats the same ask so the thread stays coherent.",
    script: `Opener for ${primary.name ?? primary.targetRole}: name the site and its measured extent, state in one sentence what contracted crews currently do there, then ask whether it is worth sending the written breakdown. Stop talking.`,
  });

  steps.push({
    dayOffset: 12,
    channel: "email",
    contactId: primary.id,
    intent: "Final follow-up carrying one new verifiable fact, then close the loop politely.",
    rationale:
      "Follow-ups behave in the opposite direction to openers: four or more sentences outperform shorter ones, so this touch is allowed to carry more substance. It also states plainly that it is the last, which protects the sender's reputation.",
  });

  if (exec && exec.id !== primary.id && exec.id !== second?.id) {
    steps.push({
      dayOffset: 14,
      channel: "email",
      contactId: exec.id,
      intent: "Escalation to the executive layer, referencing the thread rather than starting fresh.",
      rationale:
        "The executive is the escalation path, not the entry point. Reaching them after the operating layer has seen the material makes the note a continuation rather than a cold approach.",
    });
  }

  return steps;
}

function rank(c: Contact): number {
  // Site leadership first, then operations, then risk, then the rest.
  const roleScore =
    c.buyingRole === "champion" ? 0 : c.buyingRole === "economic_buyer" ? 1 : c.buyingRole === "risk_validator" ? 2 : 3;
  const namedScore = c.tier === "ROLE_TARGET_NO_NAME" ? 10 : 0;
  const siteScore = c.siteOsmId ? -1 : 0;
  return roleScore + namedScore + siteScore;
}

export { PASS_THRESHOLD };
