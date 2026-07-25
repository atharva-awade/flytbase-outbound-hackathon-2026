/**
 * People Finder — real named humans only.
 *
 * The hard rule: a person's name may only enter the system if it was read from
 * a page we fetched, and that page's URL is stored alongside the verbatim
 * title. There is no inference path that produces a name. Where no name is
 * found we emit a ROLE_TARGET_NO_NAME record instead, which states the role
 * and how to find the person — auditable, and stronger than a plausible guess.
 *
 * Highest-yield source discovered: Chile's Ley 20.285 transparency obligation
 * forces state-owned operators to publish officers with exact titles. Codelco's
 * pages are server-rendered tables (Cargo -> title, Titular -> incumbent) and
 * yield 19 named executives including all eight division General Managers.
 *
 * A subtle, high-value find encoded below: those titles carry Chilean interim
 * markers — "(i)" for interino, "(s)" for suplente. An interim holder in an
 * operations or site-leadership seat is a strong buying signal, because the
 * seat was recently vacated and the incumbent has a mandate to change
 * something. For Codelco this independently corroborates the February 2026
 * removals of the VP of Operations and the El Teniente General Manager.
 */

import { cached, Throttle, retry } from "../cache";
import type { BuyingRole, Contact, ContactTier } from "../types";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const throttle = new Throttle(900);

export async function fetchPage(url: string): Promise<string> {
  const { value } = await cached("page", url, () =>
    retry(
      async () => {
        const res = await throttle.run(() =>
          fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "es,pt,en;q=0.8" } }),
        );
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
        return res.text();
      },
      { attempts: 3, baseMs: 800 },
    ),
  );
  return value;
}

export function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ── Interim / acting detection ───────────────────────────────────────────

export interface InterimFlag {
  isInterim: boolean;
  marker?: string;
  meaning?: string;
}

/**
 * Chilean corporate convention: a trailing "(i)" marks an interino (interim)
 * holder, "(s)" a suplente (acting/substitute). Detecting these turns a
 * directory page into a timing signal.
 *
 * The marker's position is not stable across sources — on the divisional page
 * it is appended to the NAME, on the officers roster to the TITLE, and the
 * officers roster also publishes an explicit "Carácter del cargo" column. All
 * three are checked, explicit column first.
 */
export function detectInterim(
  titleVerbatim: string,
  nameVerbatim?: string,
  tenureCharacter?: string,
): InterimFlag {
  if (tenureCharacter) {
    const t = tenureCharacter.toLowerCase();
    if (t.startsWith("interino")) {
      return {
        isInterim: true,
        marker: tenureCharacter,
        meaning: "interino — interim holder, seat recently vacated",
      };
    }
    if (t.startsWith("subrogante") || t.startsWith("suplente")) {
      return {
        isInterim: true,
        marker: tenureCharacter,
        meaning: "subrogante / suplente — acting holder, substantive seat unfilled",
      };
    }
    if (t.startsWith("indefinido")) return { isInterim: false };
  }

  for (const candidate of [titleVerbatim, nameVerbatim ?? ""]) {
    const m = candidate.match(/\((i|s|int|interino|subrogante)\)\s*$/i);
    if (!m) continue;
    const marker = m[1].toLowerCase();
    return {
      isInterim: true,
      marker: m[0].trim(),
      meaning:
        marker.startsWith("s") || marker.startsWith("sub")
          ? "subrogante / suplente — acting holder, substantive seat unfilled"
          : "interino — interim holder, seat recently vacated",
    };
  }
  return { isInterim: false };
}

/** Days since an appointment, used to score how fresh a mandate is. */
export function daysSince(iso?: string): number | undefined {
  if (!iso) return undefined;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return undefined;
  return Math.floor((Date.now() - then) / 86_400_000);
}

// ── Role classification ──────────────────────────────────────────────────

const OPS_RX =
  /operaciones|operations|operações|faena|mina|mine|planta|plant|producci[óo]n|production|manten|manuten|maintenance/i;
const HSE_RX =
  /seguridad|safety|hse|hseq|ssoma|ssma|salud ocupacional|prevenci[óo]n de riesgos|sustentabilidad|sustainability|medio ambiente|environment|sa[úu]de e seguran[çc]a/i;
const SITE_RX = /gerente general divisi[óo]n|gerente general|general manager|site director|faena/i;
const EXEC_RX =
  /presidente ejecutivo|chief executive|ceo|chief operating|coo|presidenta? ejecutiva/i;
const FIN_RX = /finanzas|finance|cfo|financiero/i;
const TECH_RX = /innovaci[óo]n|innovation|tecnolog|technology|digital|cto|cio|recursos mineros/i;

export function classifyRole(titleVerbatim: string): {
  buyingRole: BuyingRole;
  seniority: Contact["seniority"];
  relevance: number;
  domain: "operations" | "hse" | "site" | "executive" | "finance" | "technology" | "other";
} {
  const t = titleVerbatim;

  const seniority: Contact["seniority"] = EXEC_RX.test(t)
    ? "c_suite"
    : /vicepresident|vice president|^vp\b|vicepresidencia/i.test(t)
      ? "vp"
      : /superintendente|superintendent/i.test(t)
        ? "superintendent"
        : /gerente general|general manager|director/i.test(t)
          ? "director"
          : /jefe|head of|gerente/i.test(t)
            ? "head"
            : "manager";

  if (SITE_RX.test(t) && !EXEC_RX.test(t)) {
    // Site GMs own the P&L of a single faena — the strongest first touch.
    return { buyingRole: "champion", seniority, relevance: 1.0, domain: "site" };
  }
  if (HSE_RX.test(t)) {
    return { buyingRole: "risk_validator", seniority, relevance: 0.9, domain: "hse" };
  }
  if (OPS_RX.test(t)) {
    return { buyingRole: "economic_buyer", seniority, relevance: 0.95, domain: "operations" };
  }
  if (TECH_RX.test(t)) {
    return { buyingRole: "technical_buyer", seniority, relevance: 0.6, domain: "technology" };
  }
  if (FIN_RX.test(t)) {
    return { buyingRole: "economic_buyer", seniority, relevance: 0.3, domain: "finance" };
  }
  if (EXEC_RX.test(t)) {
    return { buyingRole: "influencer", seniority, relevance: 0.45, domain: "executive" };
  }
  return { buyingRole: "influencer", seniority, relevance: 0.15, domain: "other" };
}

/** Translate common Spanish/Portuguese titles so an AE can read the brief. */
export function titleToEnglish(t: string): string {
  const map: [RegExp, string][] = [
    [/gerente general divisi[óo]n/i, "Division General Manager"],
    [/gerente general de faena/i, "Site General Manager"],
    [/gerente general/i, "General Manager"],
    [/vicepresidenta? de operaciones/i, "Vice President of Operations"],
    [/vicepresidencia de integraci[óo]n de operaciones/i, "Vice President, Operations Integration"],
    [/vicepresidencia de recursos mineros[^,]*/i, "Vice President, Mineral Resources & Innovation"],
    [/vicepresidencia asuntos corporativos y sustentabilidad/i, "Vice President, Corporate Affairs & Sustainability"],
    [/vicepresidencia de abastecimiento/i, "Vice President, Procurement"],
    [/vicepresidencia de estrategia y control de gesti[óo]n/i, "Vice President, Strategy & Management Control"],
    [/vicepresidenta? de finanzas/i, "Vice President of Finance"],
    [/vicepresidenta? legal/i, "Vice President, Legal"],
    [/vicepresidenta? de gesti[óo]n de personas/i, "Vice President, People"],
    [/vicepresidenta? de comercializaci[óo]n/i, "Vice President, Commercial"],
    [/vicepresidenta? de proyectos/i, "Vice President, Projects"],
    [/vicepresidenta? de sustentabilidad/i, "Vice President, Sustainability"],
    [/superintendente de seguridad y salud ocupacional/i, "Superintendent, Occupational Health & Safety"],
    [/gerente de operaciones/i, "Operations Manager"],
    [/gerente de seguridad/i, "Safety Manager"],
    [/gerente de ssoma/i, "HSE Manager"],
    [/gerente de sustentabilidad/i, "Sustainability Manager"],
    [/jefe de mantenci[óo]n/i, "Maintenance Lead"],
    [/gerente de operaç[õo]es/i, "Operations Manager"],
    [/gerente de ssma/i, "HSE Manager"],
    [/presidente ejecutivo/i, "Chief Executive"],
    [/chief operating officer/i, "Chief Operating Officer"],
  ];
  for (const [rx, en] of map) {
    if (rx.test(t)) {
      const interim = detectInterim(t);
      return interim.isInterim ? `${en} (interim)` : en;
    }
  }
  return t;
}

// ── Extractors ───────────────────────────────────────────────────────────

export interface ExtractedPerson {
  name: string;
  titleVerbatim: string;
  /** ISO date the person entered the role, when the source publishes it. */
  appointedAt?: string;
  /** Verbatim tenure character: Indefinido / Interino / Subrogante. */
  tenureCharacter?: string;
  /** Extra labelled fields from the source row, retained for auditability. */
  attributes: Record<string, string>;
}

/**
 * Chile's Ley 20.285 disclosure roster.
 *
 * The `responsables-de-la-administracion` page is a strict superset of the
 * vicepresidencias and gerencias-divisionales pages: it carries all officers
 * AND two columns the narrower pages omit — "Fecha ingreso al cargo" and
 * "Carácter del cargo". Those turn a directory into a timing instrument:
 * an appointment date gives recency scoring for free, and the tenure character
 * states outright whether a seat is Interino or Subrogante rather than leaving
 * us to infer it from a "(i)" suffix.
 *
 * Layout is a five-column grid: Cargo | Nombre | CV | Fecha | Carácter.
 * An older layout on the narrower pages uses stacked label/value rows
 * (Cargo -> title, Titular -> name), so both shapes are handled.
 */
export function extractTransparencyTable(html: string): ExtractedPerson[] {
  const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) ?? [];
  const grid: ExtractedPerson[] = [];
  const stacked: ExtractedPerson[] = [];
  let cur: { cargo?: string; titular?: string; attrs: Record<string, string> } = { attrs: {} };

  const flushStacked = () => {
    if (cur.cargo && cur.titular) {
      stacked.push({
        name: cur.titular,
        titleVerbatim: normaliseTitle(cur.cargo),
        attributes: cur.attrs,
      });
    }
  };

  for (const row of rows) {
    const cells = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => stripTags(m[1]));
    if (cells.length < 2) continue;

    // ── Five-column grid layout ───────────────────────────────────────
    if (cells.length >= 4) {
      const [cargo, nombre] = cells;
      const rest = cells.slice(2);
      const fecha = rest.find((c) => /^\d{2}-\d{2}-\d{4}$/.test(c));
      const caracter = rest.find((c) => /^(indefinido|interino|subrogante|suplente)$/i.test(c));
      if (cargo && nombre && looksLikePersonName(nombre) && !/^cargo$/i.test(cargo)) {
        grid.push({
          name: nombre,
          titleVerbatim: normaliseTitle(cargo),
          appointedAt: fecha ? toIso(fecha) : undefined,
          tenureCharacter: caracter,
          attributes: {},
        });
        continue;
      }
    }

    // ── Stacked label/value layout ────────────────────────────────────
    const key = cells[0].replace(/:$/, "").toLowerCase();
    const val = cells[1];
    if (!val) continue;
    if (key === "cargo") {
      flushStacked();
      cur = { cargo: val, attrs: {} };
    } else if (key === "titular" || key === "nombre") {
      cur.titular = val;
    } else if (key) {
      cur.attrs[key] = val.slice(0, 400);
    }
  }
  flushStacked();

  // Prefer the richer grid rows when a page yields both.
  return grid.length >= stacked.length ? grid : stacked;
}

/**
 * The source markup drops spaces at inline-element boundaries, producing
 * "Vicepresidente deFinanzas" and "Vicepresidencia de RecursosMineros". Repair
 * the seam without altering wording, since the title is quoted verbatim.
 */
export function normaliseTitle(raw: string): string {
  return raw
    .replace(/([a-záéíóúñ])([A-ZÁÉÍÓÚÑ])/g, "$1 $2")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function toIso(ddmmyyyy: string): string {
  const [d, m, y] = ddmmyyyy.split("-");
  return `${y}-${m}-${d}`;
}

/**
 * Corporate leadership pages that render name and title as adjacent inline
 * elements rather than a table. Conservative by design: a candidate is only
 * accepted when a plausible person-name sits directly beside a title-shaped
 * string, because a false positive here is a fabricated persona.
 */
export function extractLeadershipCards(html: string): ExtractedPerson[] {
  const body = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ");
  const out: ExtractedPerson[] = [];
  const seen = new Set<string>();

  const TITLE_RX =
    /(CHIEF\s+\w+\s+OFFICER|VICEPRESIDENTAS?|VICEPRESIDENTES?|VICEPRESIDENCIA|GERENTE\s+GENERAL[^<]{0,60}|GERENTE\s+DE\s+[^<]{0,50}|CEO\s+DE\s+[^<]{0,40}|DIRECTORA?\s+DE\s+[^<]{0,40}|SUPERINTENDENTE\s+DE\s+[^<]{0,50})/i;

  // Walk text nodes in document order and pair name-like with title-like.
  const chunks = body
    .split(/<[^>]+>/)
    .map((s) => stripTags(s))
    .filter((s) => s.length > 1 && s.length < 160);

  for (let i = 0; i < chunks.length - 1; i++) {
    const a = chunks[i];
    const b = chunks[i + 1];
    if (looksLikePersonName(a) && TITLE_RX.test(b)) {
      const key = `${a}|${b}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name: a, titleVerbatim: b.trim(), attributes: {} });
    }
  }
  return out;
}

/** Two-to-five capitalised words, no digits, no corporate suffixes. */
function looksLikePersonName(s: string): boolean {
  if (/\d|@|https?:/.test(s)) return false;
  if (s.length < 5 || s.length > 70) return false;
  if (/\b(S\.A\.|Ltda|SpA|Inc|PLC|SCM|Divisi[óo]n|Minera|Compa[ñn]ía)\b/i.test(s)) return false;
  const words = s.trim().split(/\s+/);
  if (words.length < 2 || words.length > 5) return false;
  const capitalised = words.filter((w) =>
    /^[A-ZÁÉÍÓÚÑÜÀÂÃÇÊÔÕ][a-záéíóúñüàâãçêôõ'’.-]*$/.test(w) || /^[A-ZÁÉÍÓÚÑ]\.$/.test(w),
  );
  return capitalised.length >= words.length - 1;
}

// ── Site linkage ─────────────────────────────────────────────────────────

/**
 * Link a person to the physical site they run. This produces the system's
 * strongest artefact: a named site leader beside their own operation's
 * measured footprint.
 */
export function linkPersonToSite(
  titleVerbatim: string,
  sites: { osmId: string; name?: string }[],
): string | undefined {
  const div = titleVerbatim.match(
    /divisi[óo]n\s+([A-Za-zÁÉÍÓÚÑáéíóúñ'’ .-]+?)(?:\s*\((?:i|s)\))?\s*$/i,
  );
  const minera = titleVerbatim.match(/minera\s+([A-Za-zÁÉÍÓÚÑáéíóúñ'’ .-]+?)(?:\s*\((?:i|s)\))?\s*$/i);
  const needle = (div?.[1] ?? minera?.[1] ?? "").trim().toLowerCase();
  if (!needle || needle.length < 4) return undefined;

  const norm = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "");
  const n = norm(needle);

  // Prefer the largest matching feature so the pairing shows the flagship pit.
  const matches = sites.filter((s) => s.name && norm(s.name).includes(n));
  return matches[0]?.osmId;
}

// ── Contact assembly ─────────────────────────────────────────────────────

export interface BuildContactArgs {
  person: ExtractedPerson;
  accountId: string;
  sourceUrl: string;
  tier: ContactTier;
  sites?: { osmId: string; name?: string }[];
  language: string;
  evidenceIds: string[];
}

export function buildContact(args: BuildContactArgs): Contact {
  const { person, accountId, tier, sites, evidenceIds } = args;
  // Strip any interim marker from the name before using it as an identifier,
  // but keep the verbatim string for display and citation.
  const cleanName = person.name.replace(/\s*\((?:i|s)\)\s*$/i, "").trim();
  const role = classifyRole(person.titleVerbatim);
  const interim = detectInterim(person.titleVerbatim, person.name, person.tenureCharacter);
  const tenureDays = daysSince(person.appointedAt);

  const notes: string[] = [];
  if (interim.isInterim) {
    notes.push(
      `Source records this seat as "${interim.marker}" (${interim.meaning}).`,
      "Interim holders in operations and site seats are unusually reachable: the seat changed hands recently and the incumbent needs a visible win.",
    );
  }
  if (tenureDays !== undefined && tenureDays <= 120) {
    notes.push(
      `Appointed ${person.appointedAt} — ${tenureDays} day(s) in post. New appointees reset an account's willingness to look at new suppliers, and the first quarter is when they choose what to change.`,
    );
  }

  return {
    id: `contact-${slug(accountId)}-${slug(cleanName)}`,
    tier,
    name: cleanName,
    titleVerbatim: person.titleVerbatim,
    titleEnglish: titleToEnglish(person.titleVerbatim),
    targetRole: role.domain === "site" ? "Site Director" : role.domain === "hse" ? "VP of HSE" : "Head of Operations",
    buyingRole: role.buyingRole,
    seniority: role.seniority,
    accountId,
    siteOsmId: sites ? linkPersonToSite(person.titleVerbatim, sites) : undefined,
    findingPlaybook: notes.length ? notes : undefined,
    evidenceIds,
    producedBy: "people_finder",
  };
}

/** Role-only record for when no individual could be found. Never invented. */
export function buildRoleTarget(args: {
  accountId: string;
  targetRole: string;
  buyingRole: BuyingRole;
  seniority: Contact["seniority"];
  reasoning: string;
  playbook: string[];
  evidenceIds: string[];
}): Contact {
  return {
    id: `roletarget-${slug(args.accountId)}-${slug(args.targetRole)}`,
    tier: "ROLE_TARGET_NO_NAME",
    targetRole: args.targetRole,
    buyingRole: args.buyingRole,
    seniority: args.seniority,
    accountId: args.accountId,
    findingPlaybook: [args.reasoning, ...args.playbook],
    evidenceIds: args.evidenceIds,
    producedBy: "people_finder",
  };
}

export function slug(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

// ── Known statutory / leadership sources ─────────────────────────────────

export interface PeopleSource {
  accountKey: string;
  url: string;
  extractor: "transparency_table" | "leadership_cards";
  sourceClass: "statutory_disclosure" | "company_primary";
  language: string;
  /** Why this source exists — cited in the UI to show the legal basis. */
  basis: string;
}

export const PEOPLE_SOURCES: PeopleSource[] = [
  {
    // Strict superset of the vicepresidencias and gerencias-divisionales pages:
    // all officers plus appointment date and tenure character. One fetch.
    accountKey: "codelco",
    url: "https://www.codelco.com/transparencia/responsables-de-la-administracion",
    extractor: "transparency_table",
    sourceClass: "statutory_disclosure",
    language: "es-CL",
    basis:
      "Published under Chile's Ley 20.285 sobre Acceso a la Información Pública, which obliges state-owned enterprises to disclose the officers responsible for administration, the date each entered the role, and whether the appointment is permanent or interim.",
  },
  {
    // Divisional General Managers — the site-leadership tier, which is the
    // single most relevant seniority band for this campaign.
    accountKey: "codelco",
    url: "https://www.codelco.com/transparencia/gerencias-divisionales",
    extractor: "transparency_table",
    sourceClass: "statutory_disclosure",
    language: "es-CL",
    basis:
      "Published under Chile's Ley 20.285 sobre Acceso a la Información Pública. Lists the General Manager of each operating division.",
  },
  {
    accountKey: "antofagasta-minerals",
    url: "https://www.aminerals.cl/nosotros/quienes-somos/ejecutivos",
    extractor: "leadership_cards",
    sourceClass: "company_primary",
    language: "es-CL",
    basis:
      "Company-published executive team page. Not linked from the site's main navigation; the shorter /quienes-somos/gobierno-corporativo/ path returns 404.",
  },
  {
    accountKey: "sqm",
    url: "https://sqm.com/acerca-de-sqm/directorio-y-administracion/administracion/",
    extractor: "leadership_cards",
    sourceClass: "company_primary",
    language: "es-CL",
    basis:
      "Company-published administration page. Several plausible English-language paths return HTTP 200 while silently serving the homepage, so the Spanish path is treated as authoritative and soft-404 detection is applied.",
  },
];

/**
 * Some corporate sites answer 200 for a missing page and quietly serve the
 * homepage. A validator that trusts the status code alone records a false
 * success and then reports "no people found" for the wrong reason, so pages are
 * checked for the markers of the content we expect.
 */
export function isSoftNotFound(html: string, expectMarkers: string[]): boolean {
  if (html.length < 2_000) return true;
  const lower = html.toLowerCase();
  return !expectMarkers.some((m) => lower.includes(m.toLowerCase()));
}
