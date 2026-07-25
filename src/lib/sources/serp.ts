/**
 * Public-profile discovery via search results.
 *
 * The method matters for defensibility. A direct request to a professional
 * profile returns a redirect into an authentication wall, so the profile body is
 * never fetched. What is used instead is the search engine's own result title,
 * which carries exactly the fields the brief asks for, a person's name and
 * their stated title, and the profile URL becomes the citation a reviewer can
 * open. Nothing is scraped from behind a login.
 *
 * Local-language titles substantially outperform English ones for Spanish- and
 * Portuguese-speaking operations, and one credential in particular is a
 * high-precision filter: in Chile only a genuinely qualified mine-safety lead
 * lists "Experto Sernageomín" on a profile, because it is a statutory
 * qualification rather than a self-description.
 */

import { cached, Throttle, retry } from "../cache";
import { classifyRole, type ExtractedPerson } from "./people";

const throttle = new Throttle(1_100);

export interface SerpHit {
  title: string;
  link: string;
  snippet: string;
  position: number;
}

interface SerperResponse {
  organic?: { title?: string; link?: string; snippet?: string; position?: number }[];
  credits?: number;
}

export function hasSerpKey(): boolean {
  return Boolean(process.env.SERPER_API_KEY);
}

/**
 * Free Serper accounts reject `num` above 10 with "Query pattern not allowed for
 * free accounts", a 400 that looks like a malformed query but is a plan limit.
 * Ten results per query is therefore the ceiling here.
 */
async function serper(query: string, gl: string, hl: string, num = 10): Promise<SerpHit[]> {
  const key = process.env.SERPER_API_KEY;
  if (!key) return [];

  const { value } = await cached("serper", { query, gl, hl, num }, () =>
    retry(
      async () => {
        const res = await throttle.run(() =>
          fetch("https://google.serper.dev/search", {
            method: "POST",
            headers: { "X-API-KEY": key, "Content-Type": "application/json" },
            body: JSON.stringify({ q: query, gl, hl, num }),
          }),
        );
        if (!res.ok) throw new Error(`Serper ${res.status}`);
        return (await res.json()) as SerperResponse;
      },
      { attempts: 2, baseMs: 900 },
    ),
  );

  return (value.organic ?? [])
    .filter((o) => o.title && o.link)
    .map((o) => ({
      title: o.title!,
      link: o.link!,
      snippet: o.snippet ?? "",
      position: o.position ?? 0,
    }));
}

/** Locale hints so results come back in the language the operator works in. */
const LOCALE: Record<string, { gl: string; hl: string }> = {
  CL: { gl: "cl", hl: "es" },
  PE: { gl: "pe", hl: "es" },
  BR: { gl: "br", hl: "pt" },
  AR: { gl: "ar", hl: "es" },
  MX: { gl: "mx", hl: "es" },
  US: { gl: "us", hl: "en" },
};

/**
 * Title clauses per language. Ordered so the highest-precision term comes first:
 * the Sernageomín credential is statutory, so a profile carrying it is almost
 * certainly a real mine-safety lead rather than a keyword match.
 */
const TITLE_CLAUSES: Record<string, string[]> = {
  es: [
    '"Experto Sernageomín"',
    '"Gerente General de Faena"',
    '"Gerente de Operaciones"',
    '"Superintendente de Seguridad"',
    '"Gerente de Seguridad y Salud Ocupacional"',
    '"Gerente de SSOMA"',
    '"Gerente de Medio Ambiente"',
    '"Jefe de Mantención"',
  ],
  pt: [
    '"Gerente de Operações"',
    '"Gerente de SSMA"',
    '"Diretor de Saúde e Segurança"',
    '"Gerente de Manutenção"',
  ],
  en: [
    '"Head of Operations"',
    '"VP HSE"',
    '"Site Director"',
    '"General Manager" mine',
    '"Head of Health and Safety"',
  ],
};

export interface ProfileCandidate extends ExtractedPerson {
  profileUrl: string;
  /** The verbatim search-result title this was read from. */
  serpTitle: string;
  snippet: string;
  relevance: number;
}

/**
 * A search-result title for a professional profile is conventionally
 * "Name - Title - Company" or "Name - Title | LinkedIn". Parsing is deliberately
 * conservative: if a segment does not look like a person's name, the hit is
 * discarded rather than guessed at, because a false positive here is a
 * fabricated persona.
 */
export function parseProfileTitle(serpTitle: string): { name: string; title: string } | null {
  const cleaned = serpTitle
    .replace(/\s*\|\s*LinkedIn\s*$/i, "")
    .replace(/\s*-\s*LinkedIn\s*$/i, "")
    .trim();

  const parts = cleaned.split(/\s+[-–, ]\s+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return null;

  const [candidateName, ...rest] = parts;
  if (!looksLikeName(candidateName)) return null;

  // Drop a trailing company segment when a title segment already exists.
  const title = rest.length >= 2 ? rest.slice(0, rest.length - 1).join(" - ") : rest[0];
  const finalTitle = (title ?? "").replace(/\.{3}$/, "").trim();
  if (finalTitle.length < 4) return null;

  return { name: candidateName, title: finalTitle };
}

function looksLikeName(s: string): boolean {
  if (/\d|@|https?:|,/.test(s)) return false;
  const words = s.trim().split(/\s+/);
  if (words.length < 2 || words.length > 5) return false;
  if (/\b(S\.A\.|Ltda|SpA|Inc|PLC|SCM|Minera|Compañía|Corporación|Division|División)\b/i.test(s)) {
    return false;
  }
  const capitalised = words.filter((w) =>
    /^[A-ZÁÉÍÓÚÑÜÀÂÃÇÊÔÕ][a-záéíóúñüàâãçêôõ'’.-]*$/.test(w),
  );
  return capitalised.length >= words.length - 1;
}

/**
 * Find public profiles at a company for the roles this campaign targets.
 * Returns candidates only, the caller decides the provenance tier, and these
 * are never promoted above a public-profile grade because a search snippet is
 * weaker evidence than a company's own disclosure.
 */
export async function findPublicProfiles(args: {
  companyNames: string[];
  country: string;
  language: string;
  maxQueries?: number;
  /** Other operators in the run. A profile naming one of these is rejected. */
  otherCompanies?: string[];
}): Promise<{
  candidates: ProfileCandidate[];
  queriesRun: string[];
  creditsUsed: number;
  errors: string[];
  /** Candidates deliberately discarded, with the reason. Shown, not hidden. */
  rejected: string[];
}> {
  const { companyNames, country } = args;
  const locale = LOCALE[country] ?? { gl: "us", hl: "en" };
  const langKey = args.language.startsWith("pt") ? "pt" : args.language.startsWith("es") ? "es" : "en";
  const clauses = TITLE_CLAUSES[langKey] ?? TITLE_CLAUSES.en;
  const maxQueries = args.maxQueries ?? 2;

  const candidates: ProfileCandidate[] = [];
  const queriesRun: string[] = [];
  const errors: string[] = [];
  const rejected: string[] = [];
  const seen = new Set<string>();
  let credits = 0;

  // Batch the title clauses into a single OR group per query to conserve credits.
  const groups = chunk(clauses, Math.ceil(clauses.length / maxQueries));

  for (const group of groups.slice(0, maxQueries)) {
    const company = companyNames[0];
    const query = `site:linkedin.com/in "${company}" (${group.join(" OR ")})`;
    queriesRun.push(query);

    let hits: SerpHit[] = [];
    try {
      hits = await serper(query, locale.gl, locale.hl, 10);
      credits += 1;
    } catch (err) {
      errors.push(`${query} -> ${(err as Error).message}`);
      continue;
    }

    for (const hit of hits) {
      if (!/linkedin\.com\/in\//i.test(hit.link)) continue;
      const parsed = parseProfileTitle(hit.title);
      if (!parsed) continue;

      // Employer attribution is the dangerous step. A naive substring test
      // matches a person whose SURNAME happens to equal the company ("Vanessa
      // Vale" is not employed by Vale) and matches profiles that name a
      // different operator entirely. Both produce a real person attached to the
      // wrong company, which is worse than returning no name at all.
      const verdict = employerMatches({
        title: parsed.title,
        personName: parsed.name,
        snippet: hit.snippet,
        companyNames,
        otherCompanies: args.otherCompanies ?? [],
      });
      if (!verdict.matched) {
        rejected.push(`${parsed.name}: ${verdict.reason}`);
        continue;
      }

      // The role must plausibly sit on the buying committee. A maintainer,
      // operator or graduate engineer is a real person but cannot sponsor a
      // programme, and padding the list with them makes the whole set look
      // careless. So a leadership token is required, not merely a domain match:
      // "Gerente de Operaciones" qualifies, "Mantenedor mina" does not.
      if (!hasLeadershipToken(parsed.title)) {
        rejected.push(
          `${parsed.name}: "${parsed.title}" carries no leadership rank, so it is not a buying-committee seat`,
        );
        continue;
      }
      const role = classifyRole(parsed.title);
      if (role.relevance < 0.85) {
        rejected.push(`${parsed.name}: role "${parsed.title}" is not an operations, site or HSE leadership seat`);
        continue;
      }

      const key = parsed.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      candidates.push({
        name: parsed.name,
        titleVerbatim: parsed.title,
        attributes: {},
        profileUrl: hit.link.split("?")[0],
        serpTitle: hit.title,
        snippet: hit.snippet,
        relevance: role.relevance,
      });
    }
  }

  candidates.sort((a, b) => b.relevance - a.relevance);
  return { candidates, queriesRun, creditsUsed: credits, errors, rejected };
}

/** Split an array into `size`-length groups. */
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  const n = Math.max(1, size);
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}


/**
 * Decide whether a search result genuinely belongs to an employee of this
 * company. Three tests, all of which must pass:
 *
 *  1. The company must be named as an EMPLOYER, either following an employer
 *     preposition ("en", "at", "na", "@"), or present as its full multi-word
 *     name. A bare first token is not enough, because company names collide
 *     with surnames.
 *  2. The matched token must not simply be part of the person's own name.
 *  3. No OTHER operator from the run may appear in the result, since a profile
 *     naming a different employer belongs to that employer.
 */
export function employerMatches(args: {
  title: string;
  personName: string;
  snippet: string;
  companyNames: string[];
  otherCompanies: string[];
}): { matched: boolean; reason: string } {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .replace(/\s+/g, " ")
      .trim();

  const haystack = norm(`${args.title} ${args.snippet}`);
  const personTokens = new Set(norm(args.personName).split(" "));

  // Checked first, because it is both the cheapest test and the most decisive:
  // a profile that names a different operator belongs to that operator.
  for (const other of args.otherCompanies) {
    const o = norm(other);
    if (o.length < 5) continue;
    if (haystack.includes(o) && !args.companyNames.some((c) => norm(c).includes(o))) {
      return { matched: false, reason: `profile names a different operator ("${other}")` };
    }
  }

  // Words that introduce an employer in the languages this campaign covers.
  const EMPLOYER_PREP = String.raw`(?:\ben\b|\bat\b|\bna\b|\bno\b|@|\bde\b|\bpara\b)\s+`;
  // Legal suffixes are stripped only as WHOLE words. Stripping them loosely
  // would carve a company token out of an unrelated surname, "Casanova" must
  // not become "Canova".
  const LEGAL_FORM = /\b(?:s\.?a\.?|ltda\.?|spa|inc\.?|plc|scm|limitada|corp\.?|sac)\b/g;

  for (const raw of args.companyNames) {
    const c = norm(raw).replace(LEGAL_FORM, "").replace(/\s+/g, " ").trim();
    if (c.length < 4) continue;

    const tokens = c.split(" ").filter((t) => t.length > 3);
    const multiWord = tokens.length > 1;

    // A full multi-word company name is distinctive enough on its own.
    if (multiWord && haystack.includes(c)) {
      return { matched: true, reason: `full company name present ("${c}")` };
    }

    // Operations are commonly referred to by the distinctive part of the name
    // rather than the full legal entity, a Teck Quebrada Blanca employee writes
    // "Quebrada Blanca". Two or more consecutive significant tokens is specific
    // enough to attribute, where a single token would not be.
    if (multiWord) {
      for (let i = 0; i < tokens.length - 1; i++) {
        const pair = `${tokens[i]} ${tokens[i + 1]}`;
        if (haystack.includes(pair)) {
          return { matched: true, reason: `operation named as "${pair}"` };
        }
      }
    }

    // A single-token name must appear after an employer preposition, so a
    // surname collision cannot satisfy the test. This is what stops a person
    // surnamed Vale being attributed to Vale S.A.
    const asEmployer = new RegExp(EMPLOYER_PREP + escapeRx(c) + String.raw`\b`, "i");
    if (asEmployer.test(haystack)) {
      return { matched: true, reason: `named as employer ("${c}")` };
    }

    if (!multiWord && haystack.includes(c) && personTokens.has(c)) {
      return {
        matched: false,
        reason: `"${c}" appears only as part of the person's own name, not as an employer`,
      };
    }
  }

  return { matched: false, reason: "company not named as the employer in the result" };
}

/**
 * Escape regex metacharacters without relying on backslash-heavy literals,
 * which are easy to corrupt when this file is edited programmatically.
 */
function escapeRx(s: string): string {
  const specials = new Set([".", "*", "+", "?", "^", "$", "{", "}", "(", ")", "|", "[", "]", "/"]);
  const BACKSLASH = String.fromCharCode(92);
  return [...s].map((ch) => (specials.has(ch) || ch === BACKSLASH ? BACKSLASH + ch : ch)).join("");
}

/**
 * Whether a self-stated title carries an actual leadership rank.
 *
 * A domain match alone is not enough. "Mantenedor mina" and "Operadora Mina" are
 * mining-operations roles but cannot sponsor a programme, and listing them beside
 * a division General Manager makes the whole contact set look undiscriminating.
 */
export function hasLeadershipToken(title: string): boolean {
  const t = title
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");

  // Explicitly non-leadership, checked first because some of these strings also
  // contain a domain word that would otherwise pass.
  const excluded =
    /\b(mantenedor|operador|operadora|practicante|estudiante|aprendiz|asistente|analista|ingeniero civil|ingeniera civil|tecnico|tecnica|consultor independiente)\b/;
  if (excluded.test(t)) return false;

  const leadership =
    /\b(gerente|gerencia|jefe|jefa|superintendente|director|directora|vicepresident|vp|head|chief|c[eo]o|manager|lider|lider|superviso|owner|partner)\b/;
  return leadership.test(t);
}
