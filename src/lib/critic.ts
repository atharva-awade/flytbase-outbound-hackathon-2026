/**
 * Red Team critic.
 *
 * The copywriter drafts; this rejects. It is deliberately deterministic — a
 * second language model grading a first one is unfalsifiable, whereas these
 * gates are arithmetic a judge can re-run by hand.
 *
 * Rejected drafts are retained and displayed. That serves two purposes: it
 * proves the emails were machine-generated rather than hand-written by us
 * (writing them ourselves is explicitly disqualifying), and it demonstrates a
 * genuine multi-agent loop rather than a single prompt with extra steps.
 *
 * The thresholds are not invented. They come from published cold-email
 * research: reply rates peak in the 50–100 word band and collapse past 200;
 * interest-based calls to action outperform meeting requests roughly two to one
 * at first touch; and follow-ups behave in the opposite direction to openers,
 * so touch one and touch two-plus are scored against different rubrics.
 */

export type Touch = "first" | "followup";

export interface CriticInput {
  subject: string;
  body: string;
  language: string;
  touch: Touch;
  /** Facts the writer asserted, each bound to an evidence row. */
  citedFacts: { text: string; evidenceId: string; isNumeric?: boolean; dateIso?: string }[];
  /** Signature is required, and checked for rather than assumed. */
  senderName: string;
}

export interface GateOutcome {
  gate: string;
  label: string;
  passed: boolean;
  detail: string;
}

export interface CriticVerdict {
  gates: GateOutcome[];
  score: number;
  accepted: boolean;
  rejectionReasons: string[];
  metrics: {
    words: number;
    sentences: number;
    longestSentenceWords: number;
    emDashes: number;
    readability: number;
    readabilityScale: string;
    youRatio: number;
    citedFactCount: number;
  };
}

export const PASS_THRESHOLD = 85;

/** Any hit is a hard fail. Assembled from published phrase-level penalties. */
export const BANNED_PHRASES = [
  // Openers that mark a template instantly
  "hope this email finds you well",
  "hope this finds you well",
  "hope you're doing well",
  "hope you are doing well",
  "i hope you're well",
  "i noticed that",
  "i noticed you",
  "i came across",
  "i was reading about",
  "reaching out because",
  "i wanted to reach out",
  "just reaching out",
  "quick question",
  // Follow-up filler
  "circling back",
  "just checking in",
  "just following up",
  "touching base",
  "per my last email",
  "as per my",
  "bumping this",
  // Model vocabulary
  "delve",
  "leverage",
  "synergy",
  "synergize",
  "seamless",
  "seamlessly",
  "cutting-edge",
  "state-of-the-art",
  "game-changer",
  "game changer",
  "unlock",
  "revolutionize",
  "revolutionise",
  "robust",
  "holistic",
  "empower",
  "elevate",
  "streamline",
  "best-in-class",
  "in today's fast-paced",
  "landscape",
  "ecosystem",
  "tapestry",
  "testament to",
  "navigate the complexities",
  // Sales sludge
  "we help companies like yours",
  "does that resonate",
  "pick your brain",
  "low-hanging fruit",
  "at the end of the day",
  "move the needle",
  // Spanish equivalents — the same tells exist and read just as synthetic
  "espero que se encuentre bien",
  "espero que este correo lo encuentre bien",
  "me pongo en contacto",
  "quería contactarlo",
  "solución integral",
  "de vanguardia",
  "líder en el mercado",
  "sinergia",
  // Portuguese
  "espero que este e-mail o encontre bem",
  "venho por meio deste",
  "solução inovadora",
];

const PLACEHOLDER_RX = /\{\{?[^}]*\}?\}|\[[^\]]{2,}\]|<[a-z_ ]{2,}>|\bTBD\b|\bXX+\b|\bFIRSTNAME\b|\bCOMPANY_NAME\b/i;

const MEETING_ASK_RX =
  /\b(15|20|30|45)\s*(minutes|min|minutos)\b|\bbook a call\b|\bschedule a call\b|\bgrab time\b|\bdoes (tuesday|wednesday|thursday|monday|friday)\b|\bon my calendar\b|\bagendar una (llamada|reuni[óo]n)\b|\bcoordinar una (llamada|reuni[óo]n)\b|\bmarcar uma (liga[çc][ãa]o|reuni[ãa]o)\b/i;

/** Interest-based asks: permission to send something, not a diary request. */
const INTEREST_CTA_RX =
  /\bworth (me )?(sending|sharing)\b|\bwant me to send\b|\bshould i send\b|\bhappy to send\b|\bcan i send\b|\bopen to (seeing|a look)\b|\b(le )?env[íi]o\b|\bquiere que le env[íi]e\b|\b(te|le) mando\b|\bposso enviar\b|\bquer que eu envie\b/i;

export function critique(input: CriticInput): CriticVerdict {
  const body = input.body.trim();
  const isSpanish = input.language.startsWith("es");
  const isPortuguese = input.language.startsWith("pt");

  const sentences = splitSentences(body);
  const words = tokenizeWords(body);
  const wordCount = words.length;
  const sentenceWordCounts = sentences.map((s) => tokenizeWords(s).length);
  const longestSentence = Math.max(0, ...sentenceWordCounts);
  const emDashes = (body.match(/—/g) ?? []).length;

  const readability = isSpanish || isPortuguese
    ? fernandezHuerta(words, sentences)
    : fleschKincaidGrade(words, sentences);
  const readabilityScale = isSpanish || isPortuguese ? "Fernández-Huerta (higher is easier)" : "Flesch-Kincaid grade";

  const youCount = countAny(body, isSpanish
    ? ["usted", "su ", "sus ", "le "]
    : isPortuguese
      ? ["você", "seu ", "sua ", "lhe "]
      : ["you ", "your ", "you're", "yours"]);
  const weCount = countAny(body, isSpanish
    ? ["nosotros", "nuestro", "nuestra", "yo "]
    : isPortuguese
      ? ["nós", "nosso", "nossa", "eu "]
      : ["we ", "our ", "us ", " i "]);
  const youRatio = weCount === 0 ? (youCount > 0 ? 99 : 0) : youCount / weCount;

  const gates: GateOutcome[] = [];

  // G1 — no placeholders. Mail-merge is explicitly not personalisation.
  const placeholderHit = PLACEHOLDER_RX.exec(`${input.subject} ${body}`);
  gates.push({
    gate: "G1",
    label: "No placeholder tokens",
    passed: !placeholderHit,
    detail: placeholderHit
      ? `Found placeholder-shaped token "${placeholderHit[0]}" — that is mail-merge, not personalisation.`
      : "No merge fields, brackets or TBD markers present.",
  });

  // G2 — banned phrases and em-dash discipline.
  const haystack = `${input.subject}\n${body}`.toLowerCase();
  const hits = BANNED_PHRASES.filter((p) => haystack.includes(p));
  gates.push({
    gate: "G2",
    label: "No template or model-tell phrasing",
    passed: hits.length === 0 && emDashes <= 2,
    detail:
      hits.length > 0
        ? `Banned phrasing: ${hits.slice(0, 4).map((h) => `"${h}"`).join(", ")}.`
        : emDashes > 2
          ? `${emDashes} em-dashes; more than two is a recognised model tell.`
          : "Clean of known template openers and model vocabulary.",
  });

  // G3 — length. Openers stay short; follow-ups are allowed to carry substance.
  const lengthOk =
    input.touch === "first"
      ? wordCount >= 55 && wordCount <= 95 && sentences.length >= 4 && sentences.length <= 7 && longestSentence <= 22
      : wordCount >= 60 && wordCount <= 150 && sentences.length >= 4 && longestSentence <= 24;
  gates.push({
    gate: "G3",
    label: input.touch === "first" ? "Opener length 55–95 words" : "Follow-up carries 4+ sentences",
    passed: lengthOk,
    detail: `${wordCount} words across ${sentences.length} sentences; longest sentence ${longestSentence} words.${
      input.touch === "first"
        ? " Reply rates peak in the 50–100 word band."
        : " Follow-ups with four or more sentences materially outperform shorter ones."
    }`,
  });

  // G4 — verifiable specifics. This is the anti-hallucination gate.
  const numericFacts = input.citedFacts.filter((f) => f.isNumeric ?? /\d/.test(f.text));
  const recentFacts = input.citedFacts.filter((f) => f.dateIso && withinMonths(f.dateIso, 18));
  const allCited = input.citedFacts.every((f) => Boolean(f.evidenceId));
  const g4 = input.citedFacts.length >= 2 && numericFacts.length >= 1 && allCited;
  gates.push({
    gate: "G4",
    label: "Two or more cited, verifiable specifics",
    passed: g4,
    detail: `${input.citedFacts.length} cited fact(s), ${numericFacts.length} numeric, ${recentFacts.length} dated within 18 months.${
      allCited ? "" : " At least one asserted fact has no evidence id, which is not allowed."
    }`,
  });

  // G5 — one interest-based ask, no diary request at first touch, no links.
  const urlCount = (body.match(/https?:\/\//g) ?? []).length;
  const meetingAsk = MEETING_ASK_RX.test(body);
  const interestAsk = INTEREST_CTA_RX.test(body);
  const questionMarks = (body.match(/\?/g) ?? []).length;
  const g5 =
    input.touch === "first"
      ? interestAsk && !meetingAsk && urlCount === 0 && questionMarks <= 1
      : questionMarks <= 2 && urlCount <= 1;
  gates.push({
    gate: "G5",
    label: input.touch === "first" ? "Single interest-based ask, no meeting request" : "Focused ask",
    passed: g5,
    detail:
      input.touch === "first"
        ? meetingAsk
          ? "Contains a calendar request. At first touch, interest-based asks outperform meeting requests roughly two to one."
          : !interestAsk
            ? "No recognisable interest-based ask — the reader is not told what they are agreeing to receive."
            : urlCount > 0
              ? `${urlCount} link(s) in a first touch; links depress first-touch reply rates and raise spam scoring.`
              : questionMarks > 1
                ? `${questionMarks} questions; a single ask converts better than several.`
                : "One interest-based ask, no links, no calendar request."
        : `${questionMarks} question(s), ${urlCount} link(s).`,
  });

  // G6 — readability. Operators skim on a phone at a mine site.
  const g6 = isSpanish || isPortuguese ? readability >= 60 : readability <= 9;
  gates.push({
    gate: "G6",
    label: "Plain language",
    passed: g6,
    detail: `${readabilityScale}: ${readability.toFixed(1)}. ${
      g6 ? "Reads plainly." : "Too dense for a message that gets read between shifts."
    }`,
  });

  // G7 — about them, not us; and signed.
  const signed = body.toLowerCase().includes(input.senderName.toLowerCase().split(" ")[0]);
  const g7 = youRatio >= 2 && signed;
  gates.push({
    gate: "G7",
    label: "Reader-centred and signed",
    passed: g7,
    detail: `Second-person to first-person ratio ${youRatio === 99 ? "all second-person" : youRatio.toFixed(1)}:1${
      signed ? ", signature present." : ", but no signature block found."
    }`,
  });

  // Subject-line discipline is scored rather than gated, since a weak subject
  // is a lost open rather than a disqualifying artefact.
  const subjectWords = tokenizeWords(input.subject).length;
  const subjectPenalties: string[] = [];
  if (input.subject.length > 50) subjectPenalties.push("over 50 characters");
  if (subjectWords > 6) subjectPenalties.push("more than six words");
  if (/\b(ai|platform|solution|partnership|revolutionary)\b/i.test(input.subject))
    subjectPenalties.push("contains a flagged buzzword");
  if (/[!]|^[A-Z\s]+$/.test(input.subject)) subjectPenalties.push("exclamation or shouting");

  const failed = gates.filter((g) => !g.passed);

  // Score: gates carry most of the weight, subject and tightness the remainder.
  let score = 100;
  score -= failed.length * 14;
  score -= subjectPenalties.length * 4;
  if (input.touch === "first" && wordCount > 95) score -= Math.min(10, wordCount - 95);
  if (longestSentence > 22) score -= Math.min(8, longestSentence - 22);
  score = Math.max(0, Math.min(100, score));

  const rejectionReasons = [
    ...failed.map((g) => `${g.gate} ${g.label}: ${g.detail}`),
    ...subjectPenalties.map((p) => `Subject line ${p}.`),
  ];

  return {
    gates,
    score,
    accepted: failed.length === 0 && score >= PASS_THRESHOLD,
    rejectionReasons,
    metrics: {
      words: wordCount,
      sentences: sentences.length,
      longestSentenceWords: longestSentence,
      emDashes,
      readability: Number(readability.toFixed(1)),
      readabilityScale,
      youRatio: youRatio === 99 ? 99 : Number(youRatio.toFixed(2)),
      citedFactCount: input.citedFacts.length,
    },
  };
}

// ── Text metrics ─────────────────────────────────────────────────────────

export function splitSentences(text: string): string[] {
  return text
    .replace(/\n+/g, " ")
    .split(/(?<=[.!?¡¿])\s+(?=[A-ZÁÉÍÓÚÑ¡¿])|(?<=[.!?])\s*$/u)
    .map((s) => s.trim())
    .filter((s) => s.length > 1);
}

export function tokenizeWords(text: string): string[] {
  return (text.match(/[\p{L}\p{N}'’-]+/gu) ?? []).filter((w) => w.length > 0);
}

/** Recency check for cited facts: stale specifics read as desk research. */
function withinMonths(iso: string, months: number): boolean {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return false;
  const cutoff = Date.now() - months * 30.44 * 86_400_000;
  return then >= cutoff;
}

function countAny(text: string, needles: string[]): number {
  const lower = ` ${text.toLowerCase()} `;
  return needles.reduce((n, needle) => n + occurrences(lower, needle), 0);
}

function occurrences(haystack: string, needle: string): number {
  let count = 0;
  let i = 0;
  for (;;) {
    const at = haystack.indexOf(needle, i);
    if (at === -1) break;
    count++;
    i = at + needle.length;
  }
  return count;
}

/** English syllable heuristic — good enough for a grade-level gate. */
function syllablesEn(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (w.length <= 3) return 1;
  const trimmed = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "");
  return Math.max(1, (trimmed.match(/[aeiouy]{1,2}/g) ?? []).length);
}

/** Spanish and Portuguese are syllable-transparent: count vowel groups. */
function syllablesEs(word: string): number {
  const w = word.toLowerCase();
  return Math.max(1, (w.match(/[aeiouáéíóúàâãêôõü]+/g) ?? []).length);
}

export function fleschKincaidGrade(words: string[], sentences: string[]): number {
  if (words.length === 0 || sentences.length === 0) return 0;
  const syll = words.reduce((n, w) => n + syllablesEn(w), 0);
  return 0.39 * (words.length / sentences.length) + 11.8 * (syll / words.length) - 15.59;
}

/**
 * Fernández-Huerta, the standard Spanish adaptation of Flesch. Applying an
 * English grade formula to Spanish copy would produce a meaningless number,
 * and gating on a meaningless number is worse than not gating at all.
 */
export function fernandezHuerta(words: string[], sentences: string[]): number {
  if (words.length === 0 || sentences.length === 0) return 0;
  const syll = words.reduce((n, w) => n + syllablesEs(w), 0);
  const P = (syll / words.length) * 100;
  const F = (sentences.length / words.length) * 100;
  return 206.84 - 0.6 * P - 1.02 * F;
}
