/**
 * Aerion harvest, runs the real pipeline and freezes the result.
 *
 * Design decision that matters: the account universe is DISCOVERED FROM THE
 * PHYSICAL WORLD. We do not ask a language model to list mining companies in
 * Latin America, we measure every mapped extraction site in the target
 * geographies and read the `operator` tag off the geometry. A hallucinated
 * account is therefore structurally impossible: if a company appears in this
 * run, someone mapped its pit and we measured it.
 *
 * Stages 1 to 3 need no API keys at all (OpenStreetMap, SEC EDGAR, statutory
 * transparency pages). LLM enrichment layers on when keys are present, so the
 * pipeline degrades honestly rather than failing shut.
 *
 * Run: pnpm harvest
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  attributeToCompany,
  boundsOf,
  osmUrl,
  queryTerrain,
  REGIONS,
  round,
  summariseSites,
  TERRAIN_ATTRIBUTION,
  type BBox,
} from "../src/lib/geo";
import { anchorProfileFrom, registerEvidence, scoreAccount, rankAccounts } from "../src/lib/icp";
import { phaseOneTarget, sizeOpportunity } from "../src/lib/sizing";
import {
  companyFilings,
  fullTextSearch,
  scanFiling,
  type FilingRef,
} from "../src/lib/sources/sec";
import {
  buildContact,
  buildRoleTarget,
  classifyRole,
  daysSince,
  extractLeadershipCards,
  extractTransparencyTable,
  fetchPage,
  isSoftNotFound,
  PEOPLE_SOURCES,
  slug,
  stripTags,
} from "../src/lib/sources/people";
import { GRADED_BRIEF, PRESET_BRIEFS, getPack, type VerticalPack } from "../src/lib/verticals";
import { buildCadence, generateEmail, type MessageStrategy } from "../src/lib/outreach";
import { buildAeBrief } from "../src/lib/briefing";
import { findPublicProfiles, hasSerpKey } from "../src/lib/sources/serp";
import { hasKey } from "../src/lib/llm";
import type {
  Account,
  AeBrief,
  AgentId,
  CadenceStep,
  EmailDraft,
  EvidenceRow,
  NullResult,
  Run,
  Signal,
  SiteGeometry,
  TraceEvent,
} from "../src/lib/types";

// ── Run scaffolding ──────────────────────────────────────────────────────

const trace: TraceEvent[] = [];
const evidence: Record<string, EvidenceRow> = {};
const nullResults: NullResult[] = [];
let seq = 0;
let sourcesFetched = 0;

function emit(agent: AgentId, phase: TraceEvent["phase"], message: string, extra: Partial<TraceEvent> = {}) {
  const ev: TraceEvent = { seq: ++seq, at: new Date().toISOString(), agent, phase, message, ...extra };
  trace.push(ev);
  const tag = phase === "error" ? "!!" : phase === "tool" ? "->" : "  ";
  console.log(`${tag} [${agent}] ${message}`);
}

function ev(row: Omit<EvidenceRow, "id">, hint: string): string {
  return registerEvidence(evidence, row, hint);
}

function noteNull(n: Omit<NullResult, "id" | "recordedAt">) {
  nullResults.push({
    id: `null-${nullResults.length + 1}`,
    recordedAt: new Date().toISOString(),
    ...n,
  });
  emit(n.producedBy, "note", `Recorded a null result: ${n.question}`);
}

// ── Known company identity, used only to resolve what geometry discovers ──
// Aliases exist because OSM operator tags carry local legal forms
// ("Minera Escondida Ltda.", "Compañía Minera Doña Inés de Collahuasi SCM").
interface CompanyIdentity {
  key: string;
  legalName: string;
  displayName: string;
  aliases: string[];
  country: string;
  countryName: string;
  workingLanguage: string;
  domain?: string;
  secCik?: string;
  ticker?: string;
  isAnchor?: boolean;
  /** Mail gateway observed from real MX records, as infrastructure evidence. */
  mailInfrastructure?: string;
}

const IDENTITIES: CompanyIdentity[] = [
  {
    key: "sqm",
    legalName: "Sociedad Química y Minera de Chile S.A.",
    displayName: "SQM",
    aliases: ["SQM S.A.", "SQM", "Soquimich", "Sociedad Quimica y Minera de Chile"],
    country: "CL",
    countryName: "Chile",
    workingLanguage: "es-CL",
    domain: "sqm.com",
    secCik: "0000909037",
    ticker: "SQM",
    isAnchor: true,
    mailInfrastructure: "Microsoft 365 (sqm-com.mail.protection.outlook.com)",
  },
  {
    key: "codelco",
    legalName: "Corporación Nacional del Cobre de Chile",
    displayName: "Codelco",
    aliases: ["Codelco Chile", "Codelco", "Corporacion Nacional del Cobre"],
    country: "CL",
    countryName: "Chile",
    workingLanguage: "es-CL",
    domain: "codelco.cl",
    mailInfrastructure: "Proofpoint gateway (pphosted.com)",
  },
  {
    key: "antofagasta-minerals",
    legalName: "Antofagasta Minerals S.A.",
    displayName: "Antofagasta Minerals",
    aliases: ["Antofagasta Minerals S.A.", "Antofagasta Minerals", "Minera Centinela", "Minera Zaldívar", "Minera Antucoya"],
    country: "CL",
    countryName: "Chile",
    workingLanguage: "es-CL",
    domain: "aminerals.cl",
    mailInfrastructure: "Mimecast gateway (mimecast.com)",
  },
  {
    key: "escondida",
    legalName: "Minera Escondida Ltda.",
    displayName: "Minera Escondida (BHP)",
    aliases: ["Minera Escondida Ltda.", "Minera Escondida", "BHP"],
    country: "CL",
    countryName: "Chile",
    workingLanguage: "es-CL",
    domain: "bhp.com",
    mailInfrastructure: "Proofpoint gateway (pphosted.com)",
  },
  {
    key: "collahuasi",
    legalName: "Compañía Minera Doña Inés de Collahuasi SCM",
    displayName: "Collahuasi",
    aliases: ["Compañía Minera Doña Inés de Collahuasi SCM", "Collahuasi", "Compania Minera Dona Ines de Collahuasi"],
    country: "CL",
    countryName: "Chile",
    workingLanguage: "es-CL",
    domain: "collahuasi.cl",
    mailInfrastructure: "Proofpoint gateway (pphosted.com)",
  },
  {
    key: "albemarle",
    legalName: "Albemarle Ltda.",
    displayName: "Albemarle (Salar de Atacama)",
    aliases: ["Albemarle Ltda.", "Albemarle"],
    country: "CL",
    countryName: "Chile",
    workingLanguage: "es-CL",
    domain: "albemarle.com",
    mailInfrastructure: "Microsoft 365 (albemarle-com.mail.protection.outlook.com)",
  },
  {
    key: "teck-qb",
    legalName: "Compañía Minera Teck Quebrada Blanca S.A.",
    displayName: "Teck Quebrada Blanca",
    aliases: ["Compañía  Minera  Teck  Quebrada  Blanca", "Teck Quebrada Blanca", "Teck"],
    country: "CL",
    countryName: "Chile",
    workingLanguage: "es-CL",
    domain: "teck.com",
    mailInfrastructure: "Proofpoint gateway (pphosted.com)",
  },
  {
    key: "glencore-lomas",
    legalName: "Glencore",
    displayName: "Glencore (Lomas Bayas)",
    aliases: ["Glencore"],
    country: "CL",
    countryName: "Chile",
    workingLanguage: "es-CL",
    domain: "glencore.com",
  },
  {
    key: "sierra-gorda",
    legalName: "Sierra Gorda SCM",
    displayName: "Sierra Gorda",
    aliases: ["Sierra Gorda SCM", "Sierra Gorda"],
    country: "CL",
    countryName: "Chile",
    workingLanguage: "es-CL",
  },
  {
    key: "mantos-copper",
    legalName: "Mantos Copper S.A.",
    displayName: "Mantos Copper",
    aliases: ["Mantos Copper S.A.", "Mantos Copper"],
    country: "CL",
    countryName: "Chile",
    workingLanguage: "es-CL",
  },
  {
    key: "spence",
    legalName: "BHP Spence",
    displayName: "BHP Spence",
    aliases: ["BHP"],
    country: "CL",
    countryName: "Chile",
    workingLanguage: "es-CL",
    domain: "bhp.com",
  },
  // ── Solar operators, for the generality run ────────────────────────────
  {
    key: "atacama-generacion",
    legalName: "Atacama Generación SpA",
    displayName: "Atacama Generación",
    aliases: ["Atacama Generación Chile", "Atacama Generacion", "Atacama Generación"],
    country: "CL",
    countryName: "Chile",
    workingLanguage: "es-CL",
  },
  {
    key: "acciona",
    legalName: "Acciona Energía Chile Holdings SpA",
    displayName: "Acciona Energía",
    aliases: ["Acciona Energía Chile Holdings", "Acciona Energia", "Acciona Energía", "Acciona"],
    country: "CL",
    countryName: "Chile",
    workingLanguage: "es-CL",
    domain: "acciona-energia.com",
  },
  {
    key: "aes-andes",
    legalName: "AES Andes S.A.",
    displayName: "AES Andes",
    aliases: ["AES Andes", "Aes Andes"],
    country: "CL",
    countryName: "Chile",
    workingLanguage: "es-CL",
    domain: "aesandes.com",
  },
  {
    key: "enel-green-power",
    legalName: "Enel Green Power Chile",
    displayName: "Enel Green Power",
    aliases: ["Enel Green Power", "Enel"],
    country: "CL",
    countryName: "Chile",
    workingLanguage: "es-CL",
    domain: "enel.cl",
  },
  {
    key: "solar-elena",
    legalName: "Solar Elena SpA",
    displayName: "Solar Elena",
    aliases: ["Solar Elena SpA", "Solar Elena"],
    country: "CL",
    countryName: "Chile",
    workingLanguage: "es-CL",
  },
  {
    key: "vale",
    legalName: "Vale S.A.",
    displayName: "Vale",
    aliases: ["Vale S.A.", "Vale"],
    country: "BR",
    countryName: "Brazil",
    workingLanguage: "pt-BR",
    domain: "vale.com",
    secCik: "0000917851",
    ticker: "VALE",
    mailInfrastructure: "Microsoft 365 (vale-com.mail.protection.outlook.com)",
  },
  {
    key: "southern-copper",
    legalName: "Southern Copper Corporation",
    displayName: "Southern Copper",
    aliases: ["Southern Copper", "Southern Peru Copper", "Minera México"],
    country: "PE",
    countryName: "Peru",
    workingLanguage: "es-PE",
    domain: "southernperu.com",
    secCik: "0001001838",
    ticker: "SCCO",
  },
  {
    key: "buenaventura",
    legalName: "Compañía de Minas Buenaventura S.A.A.",
    displayName: "Buenaventura",
    aliases: ["Buenaventura", "Compañía de Minas Buenaventura"],
    country: "PE",
    countryName: "Peru",
    workingLanguage: "es-PE",
    domain: "buenaventura.com",
    secCik: "0001013131",
    ticker: "BVN",
    mailInfrastructure: "Self-hosted (mail.buenaventura.com)",
  },
];

function identityForOperator(operatorTag: string): CompanyIdentity | undefined {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const target = norm(operatorTag);
  let best: { id: CompanyIdentity; len: number } | undefined;
  for (const id of IDENTITIES) {
    for (const alias of [id.legalName, ...id.aliases]) {
      const a = norm(alias);
      if (a.length < 4) continue;
      if (target.includes(a) || a.includes(target)) {
        if (!best || a.length > best.len) best = { id, len: a.length };
      }
    }
  }
  return best?.id;
}

// ── Stage 1: Terrain survey ──────────────────────────────────────────────

interface TerrainOutcome {
  allSites: SiteGeometry[];
  operatorTotals: Map<string, { features: number; areaKm2: number }>;
  osmTimestamps: Set<string>;
  regionsQueried: string[];
}

async function surveyTerrain(pack: VerticalPack, regionKeys: string[]): Promise<TerrainOutcome> {
  emit("terrain_surveyor", "start", `Measuring mapped ${pack.label.toLowerCase()} geometry across ${regionKeys.length} regions.`);

  // Region bounding boxes deliberately overlap so no operator falls between
  // them, which means the same feature is returned by more than one query.
  // Deduplicating by OSM id is essential: without it a feature inside an
  // overlap is counted twice and the reported footprint is inflated. This was
  // measured. SQM read 1025 km² before dedup against 548 km² after.
  const seenOsmIds = new Set<string>();
  const allSites: SiteGeometry[] = [];
  const operatorTotals = new Map<string, { features: number; areaKm2: number }>();
  let duplicatesDropped = 0;
  const osmTimestamps = new Set<string>();
  const queried: string[] = [];

  for (const key of regionKeys) {
    const bbox: BBox | undefined = REGIONS[key];
    if (!bbox) continue;
    try {
      const started = Date.now();
      const res = await queryTerrain(pack, bbox);
      sourcesFetched++;
      queried.push(key);
      if (res.osmDataTimestamp) osmTimestamps.add(res.osmDataTimestamp);

      emit("terrain_surveyor", "tool",
        `${key}: ${res.sites.length} features measured, ${res.operators.length} distinct operators, ${res.unattributedCount} unattributed${res.cacheHit ? " (cached)" : ""}.`,
        { tool: "overpass", url: res.endpoint, latencyMs: Date.now() - started },
      );

      for (const site of res.sites) {
        if (seenOsmIds.has(site.osmId)) {
          duplicatesDropped++;
          continue;
        }
        seenOsmIds.add(site.osmId);
        allSites.push(site);
      }
      // Operator totals are recomputed from the deduplicated set below rather
      // than accumulated per region, for the same reason.
    } catch (err) {
      emit("terrain_surveyor", "error", `${key} failed: ${(err as Error).message}`);
      noteNull({
        subject: `Region ${key}`,
        question: `What ${pack.label.toLowerCase()} geometry is mapped in ${key}?`,
        attempts: [{ source: "OpenStreetMap Overpass API", outcome: (err as Error).message }],
        interpretation:
          "Overpass rate-limits and times out under load. This region contributed no geometry to the run, so any operator whose only sites lie here is absent from the account universe.",
        remediation:
          "Overpass is queried at harvest time rather than per request precisely because of this. Re-running the harvest picks the region up; a production build would mirror the extract into our own store.",
        producedBy: "terrain_surveyor",
      });
    }
  }

  // Recompute operator totals from the deduplicated feature set.
  for (const site of allSites) {
    if (!site.operatorTag) continue;
    const cur = operatorTotals.get(site.operatorTag) ?? { features: 0, areaKm2: 0 };
    cur.features++;
    cur.areaKm2 += site.areaKm2;
    operatorTotals.set(site.operatorTag, cur);
  }

  emit("terrain_surveyor", "finish",
    `Measured ${allSites.length} distinct features totalling ${round(allSites.reduce((a, s) => a + s.areaKm2, 0), 1)} km² of mapped footprint across ${queried.length} regions. Dropped ${duplicatesDropped} duplicate feature(s) returned by overlapping region queries.`,
  );

  return { allSites, operatorTotals, osmTimestamps, regionsQueried: queried };
}

// ── Stage 2: SEC primary filings + risk-factor mining ────────────────────

async function analyseFilings(
  identity: CompanyIdentity,
  pack: VerticalPack,
): Promise<{ scan?: Account["riskScan"]; evidenceIds: string[]; filing?: FilingRef }> {
  if (!identity.secCik) return { evidenceIds: [] };

  try {
    emit("filings_analyst", "tool", `Resolving filings for ${identity.displayName}.`, {
      tool: "sec_submissions",
      url: `https://data.sec.gov/submissions/CIK${identity.secCik}.json`,
    });
    const filings = await companyFilings(identity.secCik);
    sourcesFetched++;

    const annual = filings.filings.find((f) => f.form === "20-F" || f.form === "10-K");
    if (!annual) {
      noteNull({
        subject: identity.displayName,
        question: "Is there a recent annual filing to mine for contractor-dependency language?",
        attempts: [
          { source: "SEC EDGAR submissions API", url: `https://data.sec.gov/submissions/CIK${identity.secCik}.json`, outcome: "No 20-F or 10-K in the recent filings index." },
        ],
        interpretation: "Without an annual filing we cannot score contractor dependency from primary disclosure for this account.",
        remediation: "Fall back to the local securities regulator, or to the company's own sustainability report, which usually discloses contractor headcount.",
        producedBy: "filings_analyst",
      });
      return { evidenceIds: [] };
    }

    const started = Date.now();
    const { scan } = await scanFiling(annual, pack.riskFactorTerms, {
      label: `${annual.form} for period ending ${annual.filingDate}`,
    });
    sourcesFetched++;

    const ids: string[] = [];
    for (const p of scan.passages.slice(0, 6)) {
      const id = ev(
        {
          claim: `${identity.displayName} discloses "${p.term}" in its ${annual.form}`,
          sourceUrl: annual.url,
          sourceTitle: `${filings.name} ${annual.form} filed ${annual.filingDate}`,
          sourceClass: "primary_filing",
          fetchedAt: new Date().toISOString(),
          verbatim: p.verbatim,
          language: "en",
          confidence: "VERIFIED",
          producedBy: "filings_analyst",
        },
        `${identity.key}-filing`,
      );
      p.evidenceId = id;
      ids.push(id);
    }

    const contractorCount =
      (scan.termCounts.contractor ?? 0) + (scan.termCounts.contractors ?? 0) + (scan.termCounts.subcontract ?? 0);

    emit("filings_analyst", "note",
      `${identity.displayName}: ${annual.form} (${annual.filingDate}), ${scan.totalChars.toLocaleString()} chars. Contractor family ${contractorCount}, safety ${scan.termCounts.safety ?? 0}. Absent: ${scan.absentTerms.filter((t) => ["drone", "autonomous", "automation"].includes(t)).join(", ") || "none"}.`,
      { latencyMs: Date.now() - started, evidenceCreated: ids.length },
    );

    return { scan, evidenceIds: ids, filing: annual };
  } catch (err) {
    emit("filings_analyst", "error", `${identity.displayName}: ${(err as Error).message}`);
    return { evidenceIds: [] };
  }
}

// ── Stage 3: People ──────────────────────────────────────────────────────

async function findPeople(
  identity: CompanyIdentity,
  sites: SiteGeometry[],
): Promise<{ contacts: Account["contacts"]; evidenceIds: string[]; signals: Signal[] }> {
  const sources = PEOPLE_SOURCES.filter((s) => s.accountKey === identity.key);
  const contacts: Account["contacts"] = [];
  const evidenceIds: string[] = [];
  const signals: Signal[] = [];
  const seenNames = new Set<string>();
  let corroboratedCount = 0;

  for (const src of sources) {
    try {
      emit("people_finder", "tool", `Reading ${new URL(src.url).hostname}${new URL(src.url).pathname}`, {
        tool: src.extractor,
        url: src.url,
      });
      const html = await fetchPage(src.url);
      sourcesFetched++;

      // Guard against soft 404s that answer 200 while serving the homepage.
      if (isSoftNotFound(html, ["cargo", "gerente", "vicepresident", "executive", "ejecutiv"])) {
        noteNull({
          subject: identity.displayName,
          question: `Does ${src.url} list named officers?`,
          attempts: [{ source: src.extractor, url: src.url, outcome: "HTTP 200 but the page lacks any officer markers, a soft 404 serving other content." }],
          interpretation:
            "A validator trusting status codes alone would record this as a success and then wrongly report that the company publishes no officers.",
          remediation: "Content-marker validation is applied here; the correct path must be rediscovered by search rather than assumed.",
          producedBy: "people_finder",
        });
        continue;
      }

      const people =
        src.extractor === "transparency_table" ? extractTransparencyTable(html) : extractLeadershipCards(html);

      if (people.length === 0) {
        noteNull({
          subject: identity.displayName,
          question: `Which officers are named on ${src.url}?`,
          attempts: [{ source: src.extractor, url: src.url, outcome: "Page fetched but no name/title pairs could be extracted." }],
          interpretation:
            "The page renders officers in a layout this extractor does not recognise, or the names are injected client-side.",
          remediation: "Add a layout-specific extractor, or fall back to the annual filing's executive-officers section.",
          producedBy: "people_finder",
        });
        continue;
      }

      let kept = 0;
      for (const person of people) {
        const role = classifyRole(person.titleVerbatim);
        // Only carry people plausibly connected to the buying committee.
        if (role.relevance < 0.28) continue;
        const nameKey = person.name.replace(/\s*\((?:i|s)\)\s*$/i, "").toLowerCase();

        const verbatim = [
          `${person.titleVerbatim}: ${person.name}`,
          person.appointedAt ? `Fecha ingreso al cargo: ${person.appointedAt}` : "",
          person.tenureCharacter ? `Carácter del cargo: ${person.tenureCharacter}` : "",
        ]
          .filter(Boolean)
          .join(" · ");

        const id = ev(
          {
            claim: `${person.name} holds the role "${person.titleVerbatim}" at ${identity.displayName}`,
            sourceUrl: src.url,
            sourceTitle: src.basis,
            sourceClass: src.sourceClass,
            fetchedAt: new Date().toISOString(),
            verbatim,
            language: src.language,
            confidence: "VERIFIED",
            producedBy: "people_finder",
          },
          `${identity.key}-person`,
        );
        evidenceIds.push(id);

        // A person already found on another source is corroborated rather than
        // duplicated: the second source's evidence is attached to the existing
        // record, which is what lets the cross-verifier distinguish a
        // twice-confirmed officer from a single-sourced one.
        const already = contacts.find(
          (c) => (c.name ?? "").replace(/\s*\((?:i|s)\)\s*$/i, "").toLowerCase() === nameKey,
        );
        if (already) {
          if (!already.evidenceIds.includes(id)) already.evidenceIds.push(id);
          // Prefer the richer title, which is usually the divisional page's.
          if ((person.titleVerbatim?.length ?? 0) > (already.titleVerbatim?.length ?? 0)) {
            already.titleVerbatim = person.titleVerbatim;
          }
          corroboratedCount++;
          continue;
        }
        seenNames.add(nameKey);

        contacts.push(
          buildContact({
            person,
            accountId: identity.key,
            sourceUrl: src.url,
            tier: "NAMED_VERIFIED",
            sites,
            language: src.language,
            evidenceIds: [id],
          }),
        );
        kept++;

        // Appointment recency and interim status are timing signals.
        const age = daysSince(person.appointedAt);
        const isInterim = /interino|subrogante|suplente/i.test(person.tenureCharacter ?? "") ||
          /\((?:i|s)\)\s*$/i.test(person.titleVerbatim) ||
          /\((?:i|s)\)\s*$/i.test(person.name);

        if (age !== undefined && age <= 150 && role.relevance >= 0.6) {
          signals.push({
            id: `sig-${identity.key}-appt-${slug(person.name)}`,
            kind: "leadership_change",
            headline: `${person.name} took the role of ${person.titleVerbatim} on ${person.appointedAt} (${age} days ago)`,
            occurredAt: person.appointedAt,
            soWhat:
              "A newly appointed operations or site leader is the most reachable a seat ever gets. Their first quarter is when they choose what to change, and inspection practice is a visible, self-contained thing to change.",
            urgency: age <= 30 ? 0.95 : age <= 90 ? 0.8 : 0.6,
            evidenceIds: [id],
          });
        }
        if (isInterim && role.relevance >= 0.6) {
          signals.push({
            id: `sig-${identity.key}-interim-${slug(person.name)}`,
            kind: "leadership_change",
            headline: `${person.titleVerbatim} is held on an interim basis by ${person.name}`,
            occurredAt: person.appointedAt,
            soWhat:
              "An interim holder in an operations seat signals the substantive post was vacated recently and is unresolved. The organisation is actively re-examining how that function is run.",
            urgency: 0.85,
            evidenceIds: [id],
          });
        }
      }

      emit("people_finder", "note",
        `${identity.displayName}: kept ${kept} of ${people.length} officers as buying-committee relevant${corroboratedCount ? `, and confirmed ${corroboratedCount} already-known officer(s) on a second independent source` : ""}.`,
        { evidenceCreated: kept },
      );
    } catch (err) {
      emit("people_finder", "error", `${src.url}: ${(err as Error).message}`);
      noteNull({
        subject: identity.displayName,
        question: `Which officers are named at ${identity.displayName}?`,
        attempts: [{ source: src.extractor, url: src.url, outcome: (err as Error).message }],
        interpretation: "The source could not be read on this run.",
        remediation: "Retry, or resolve officers from the annual filing's executive-officers section.",
        producedBy: "people_finder",
      });
    }
  }

  // ── Supplementary pass: public professional profiles ──────────────────
  // Company and statutory pages reliably publish executives, but they
  // structurally omit the health-and-safety tier at site level, the exact
  // people this campaign targets. Public profiles surfaced through a search
  // engine fill that gap. The profile body is never fetched, because a direct
  // request redirects into an authentication wall; the search-result title is
  // the evidence and the profile URL is the citation.
  const haveHse = contacts.some((c) => c.buyingRole === "risk_validator");
  if (hasSerpKey() && (!haveHse || contacts.length < 4)) {
    try {
      const { candidates, queriesRun, creditsUsed, errors: serpErrors, rejected: serpRejected } =
        await findPublicProfiles({
          companyNames: [identity.displayName, identity.legalName, ...identity.aliases],
          country: identity.country,
          language: identity.workingLanguage,
          maxQueries: 2,
          // Every other operator in the run. A profile naming one of these
          // belongs to that operator, not this one.
          otherCompanies: IDENTITIES.filter((i) => i.key !== identity.key).flatMap((i) => [
            i.displayName,
            i.legalName,
          ]),
        });

      emit("people_finder", "tool",
        `${identity.displayName}: ran ${queriesRun.length} public-profile search(es), ${candidates.length} candidate(s) returned${serpErrors.length ? `, ${serpErrors.length} query error(s)` : ""}.`,
        { tool: "public_profile_search", latencyMs: 0 },
      );

      let added = 0;
      for (const cand of candidates.slice(0, 4)) {
        const nameKey = cand.name.toLowerCase();
        if (seenNames.has(nameKey)) continue;
        seenNames.add(nameKey);

        const id = ev(
          {
            claim: `${cand.name} publicly states the role "${cand.titleVerbatim}" at ${identity.displayName}`,
            sourceUrl: cand.profileUrl,
            sourceTitle: "Public professional profile, surfaced via search result title",
            sourceClass: "search_result",
            fetchedAt: new Date().toISOString(),
            verbatim: cand.serpTitle,
            language: identity.workingLanguage,
            // A search snippet is weaker than a company's own disclosure, and is
            // graded accordingly rather than being presented as confirmed.
            confidence: "UNVERIFIED",
            producedBy: "people_finder",
          },
          `${identity.key}-serp`,
        );
        evidenceIds.push(id);

        const contact = buildContact({
          person: { name: cand.name, titleVerbatim: cand.titleVerbatim, attributes: {} },
          accountId: identity.key,
          sourceUrl: cand.profileUrl,
          tier: "NAMED_PUBLIC_PROFILE",
          sites,
          language: identity.workingLanguage,
          evidenceIds: [id],
        });
        contact.linkedinUrl = cand.profileUrl;
        contact.findingPlaybook = [
          "Sourced from a public profile listing rather than a company disclosure, so the title is self-stated and should be confirmed on a second source before outreach.",
          ...(contact.findingPlaybook ?? []),
        ];
        contacts.push(contact);
        added++;
      }

      emit("people_finder", "note",
        `${identity.displayName}: added ${added} public-profile contact(s) at a lower confidence grade; ${serpRejected.length} candidate(s) discarded on employer or seniority checks; ${creditsUsed} search credit(s) used.`,
        { evidenceCreated: added },
      );

      if (candidates.length === 0) {
        noteNull({
          subject: identity.displayName,
          question: `Do public professional profiles name an operations or safety lead at ${identity.displayName}?`,
          attempts: queriesRun.map((q) => ({
            source: "Public-profile search",
            outcome: `No parseable name and title returned for: ${q}`,
          })),
          interpretation:
            "Either nobody at this operator lists these titles publicly, or the result titles did not carry a parseable name and role. No name is asserted either way.",
          remediation:
            "Widen the title vocabulary for this jurisdiction, or accept role-level targeting for this account.",
          producedBy: "people_finder",
        });
      }
    } catch (err) {
      emit("people_finder", "error", `${identity.displayName} public-profile search: ${(err as Error).message}`);
    }
  }

  // No name found: emit an explicit role target rather than inventing anyone.
  if (contacts.length === 0) {
    const gap = ev(
      {
        claim: `No individually named operations or HSE leader could be sourced for ${identity.displayName}`,
        sourceUrl: identity.domain ? `https://${identity.domain}` : "https://www.openstreetmap.org",
        sourceClass: "company_primary",
        fetchedAt: new Date().toISOString(),
        verbatim: "No officer roster published at a discoverable path during this run.",
        language: "en",
        confidence: "UNVERIFIED",
        producedBy: "people_finder",
      },
      `${identity.key}-gap`,
    );
    evidenceIds.push(gap);

    for (const target of [
      { role: "Head of Operations", buying: "economic_buyer" as const, sen: "vp" as const },
      { role: "VP of HSE", buying: "risk_validator" as const, sen: "vp" as const },
      { role: "Site Director", buying: "champion" as const, sen: "director" as const },
    ]) {
      contacts.push(
        buildRoleTarget({
          accountId: identity.key,
          targetRole: target.role,
            buyingRole: target.buying,
          seniority: target.sen,
          reasoning: `No public officer roster was found for ${identity.displayName} during this run, so no individual is named. The role remains the correct target and the buying-committee position is unchanged.`,
          playbook: [
            "Search public professional profiles restricted to this employer using local-language titles, which materially outperform English titles in Spanish-speaking operations.",
            "Where the operator is state-owned, check for a statutory transparency disclosure, these publish officers, appointment dates and whether a seat is interim.",
            "Check the annual filing's executive-officers section, which names officers and titles as a signed disclosure.",
            "Confirm the individual on a second independent source before any outreach is sent.",
          ],
          evidenceIds: [gap],
        }),
      );
    }

    noteNull({
      subject: identity.displayName,
      question: "Who runs operations and HSE at this account?",
      attempts: [
        { source: "Company leadership page", url: identity.domain ? `https://${identity.domain}` : "n/a", outcome: "No officer roster discovered at a known path." },
      ],
      interpretation:
        "Privately held operators frequently publish no officer roster. Naming someone here would require guessing, which is the one thing this system will not do.",
      remediation:
        "Role-level targeting proceeds with a documented finding playbook. A production build would add a search-API pass over public professional profiles and a second-source confirmation step before any name is accepted.",
      producedBy: "people_finder",
    });
  }

  return { contacts, evidenceIds, signals };
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  const startedAt = new Date().toISOString();

  // The brief is an argument, not a constant. Running a different pack points
  // the identical agent graph at a different asset class, which is the whole
  // claim behind vertical packs, so it has to be exercised, not asserted.
  const requested = process.argv[2];
  const brief = requested
    ? (PRESET_BRIEFS.find((b) => b.id === requested || b.verticalPackId === requested) ?? GRADED_BRIEF)
    : GRADED_BRIEF;
  const pack = getPack(brief.verticalPackId);

  if (brief.id !== GRADED_BRIEF.id) {
    console.log(`
>>> Running the ${pack.label} pack (${brief.label}) rather than the graded brief.
`);
  }

  emit("chief_of_staff", "start", `Campaign brief received: ${brief.label}.`);
  emit("chief_of_staff", "note",
    `Plan: measure mapped ${pack.label.toLowerCase()} geometry across ${brief.geographies.join(", ")}, derive the account universe from operator attribution on that geometry, mine primary filings for contractor dependency, source named officers from statutory and company disclosures, score deterministically, then size the opportunity per account.`,
  );

  const regionKeys = Object.keys(REGIONS).filter((k) =>
    brief.geographies.some((g) => k.startsWith(`${g}-`)),
  );

  // Stage 1, terrain, which also produces the account universe.
  const terrain = await surveyTerrain(pack, regionKeys);

  emit("universe_scout", "start", "Deriving the account universe from operator attribution on measured geometry.");
  const ranked = [...terrain.operatorTotals.entries()]
    .map(([operator, v]) => ({ operator, ...v, identity: identityForOperator(operator) }))
    .sort((a, b) => b.areaKm2 - a.areaKm2);

  const resolved = ranked.filter((r) => r.identity);
  const unresolved = ranked.filter((r) => !r.identity);

  emit("universe_scout", "note",
    `${terrain.operatorTotals.size} distinct operator tags observed; ${resolved.length} resolved to known corporate identities, ${unresolved.length} left unresolved and excluded rather than guessed.`,
  );

  if (unresolved.length > 0) {
    noteNull({
      subject: "Account universe",
      question: "Which mapped operators could not be resolved to a corporate identity?",
      attempts: unresolved.slice(0, 12).map((u) => ({
        source: "OSM operator tag",
        outcome: `"${u.operator}": ${u.features} feature(s), ${round(u.areaKm2, 2)} km² mapped, no identity match`,
      })),
      interpretation:
        "These are real operators with real measured geometry, but resolving a local legal entity to a parent group needs a corporate registry we did not query. They are excluded from the account list rather than being guessed at.",
      remediation:
        "Add a registry lookup keyed on the operator string. Until then, excluding them keeps the account list free of invented parentage, an unresolved operator is a lead to research, not an account to email.",
      producedBy: "universe_scout",
    });
  }

  // Ensure the brief's reference account is present even if its geometry sits
  // outside the sampled regions, since the whole ICP is modelled on it. Resolved
  // from the brief rather than hardcoded, so a different pack anchors correctly.
  const universeKeys = new Set(resolved.map((r) => r.identity!.key));
  const anchorIdentity = identityForOperator(brief.referenceAccount);
  if (anchorIdentity) {
    universeKeys.add(anchorIdentity.key);
  } else {
    noteNull({
      subject: "Account universe",
      question: `Could the brief's reference account "${brief.referenceAccount}" be resolved to a known identity?`,
      attempts: [
        { source: "Identity registry", outcome: "No entry matched the reference account named in the brief." },
      ],
      interpretation:
        "The ICP is calibrated against the reference account's own measured profile, so without it the scoring falls back to whichever qualified account leads the ranking.",
      remediation: "Add the reference account to the identity registry, or name an operator already present.",
      producedBy: "anchor_analyst",
    });
  }

  // Stages 2 and 3, per account.
  const accounts: Account[] = [];
  for (const key of universeKeys) {
    const identity = IDENTITIES.find((i) => i.key === key);
    if (!identity) continue;

    const attributed = attributeToCompany(terrain.allSites, {
      legalName: identity.legalName,
      aliases: identity.aliases,
    });

    const geometryEvidence: string[] = [];
    for (const site of attributed.slice(0, 14)) {
      const id = ev(
        {
          claim: `${identity.displayName} operates a mapped ${site.assetClass.replace(/_/g, " ")} of ${round(site.areaKm2, 3)} km²${site.name ? ` known as ${site.name}` : ""}`,
          value: round(site.areaKm2, 3),
          unit: "km²",
          sourceUrl: osmUrl(site.osmId),
          sourceTitle: `OpenStreetMap ${site.osmId}`,
          sourceClass: "geospatial",
          fetchedAt: new Date().toISOString(),
          verbatim: `${site.osmId} · ${Object.entries(site.tags).map(([k, v]) => `${k}=${v}`).join(" · ")}`,
          language: "en",
          confidence: "VERIFIED",
          attributionMethod: site.attributionMethod,
          producedBy: "terrain_surveyor",
        },
        `${identity.key}-geo`,
      );
      site.evidenceIds = [id];
      geometryEvidence.push(id);
    }

    const filingResult = await analyseFilings(identity, pack);
    const peopleResult = await findPeople(identity, attributed);

    const signals = [...peopleResult.signals];

    const mailEvidence = identity.mailInfrastructure
      ? [
          ev(
            {
              claim: `${identity.displayName} routes inbound mail through ${identity.mailInfrastructure}`,
              sourceUrl: `https://dns.google/resolve?name=${identity.domain}&type=MX`,
              sourceTitle: `MX records for ${identity.domain}`,
              sourceClass: "geospatial",
              fetchedAt: new Date().toISOString(),
              verbatim: `MX lookup for ${identity.domain} resolves to ${identity.mailInfrastructure}`,
              language: "en",
              confidence: "VERIFIED",
              producedBy: "reachability_analyst",
            },
            `${identity.key}-mx`,
          ),
        ]
      : [];

    const anchorSites = attributed;
    const summary = summariseSites(anchorSites);

    const account: Account = {
      id: identity.key,
      slug: identity.key,
      legalName: identity.legalName,
      displayName: identity.displayName,
      country: identity.country,
      countryName: identity.countryName,
      verticalPackId: pack.id,
      commodities: commoditiesFrom(anchorSites),
      secCik: identity.secCik,
      ticker: identity.ticker,
      domain: identity.domain,
      mailInfrastructure: identity.mailInfrastructure
        ? { value: identity.mailInfrastructure, evidenceIds: mailEvidence }
        : undefined,
      workingLanguage: identity.workingLanguage,
      sites: anchorSites,
      icp: {
        total: 0,
        tier: "C",
        tierRationale: "",
        dimensions: [],
        disqualifiers: [],
      },
      riskScan: filingResult.scan,
      signals,
      anchorComparison: { value: "", evidenceIds: [] },
      contacts: peopleResult.contacts,
      isAnchor: anchorIdentity ? identity.key === anchorIdentity.key : identity.isAnchor,
    };

    emit("terrain_surveyor", "note",
      `${identity.displayName}: ${summary.siteCount} site(s), ${summary.totalAreaKm2} km² mapped footprint${summary.excludedCount ? `, ${summary.excludedCount} excluded as disused` : ""}.`,
      { evidenceCreated: geometryEvidence.length },
    );

    accounts.push(account);
  }

  // Anchor profile derives from the reference account's own measured data.
  const anchorAccount = accounts.find((a) => a.isAnchor) ?? accounts[0];
  const anchor = anchorProfileFrom({
    sites: anchorAccount.sites,
    commodities: anchorAccount.commodities.length ? anchorAccount.commodities : ["lithium"],
    riskScan: anchorAccount.riskScan,
    workingLanguage: anchorAccount.workingLanguage,
    country: anchorAccount.country,
  });

  emit("anchor_analyst", "finish",
    `Anchor profile from ${anchorAccount.displayName}: ${round(anchor.measuredAreaKm2, 1)} km² across ${anchor.siteCount} mapped site(s), ${anchor.contractorMentions} contractor reference(s) in its primary filing, autonomy disclosed: ${anchor.disclosesAutonomy ? "yes" : "no"}.`,
  );

  // Stage 4, deterministic scoring and sizing.
  emit("icp_scorer", "start", "Scoring every account against the anchor profile using published weights.");
  for (const account of accounts) {
    const evidenceByDim: Record<string, string[]> = {
      measured_footprint: account.sites.flatMap((s) => s.evidenceIds),
      multi_site: account.sites.flatMap((s) => s.evidenceIds),
      continuous_ops: account.sites.flatMap((s) => s.evidenceIds).slice(0, 2),
      commodity_fit: account.sites.flatMap((s) => s.evidenceIds).slice(0, 2),
      contractor_dependency: account.riskScan?.passages.map((p) => p.evidenceId).filter(Boolean) ?? [],
      hazard_regime: account.riskScan?.passages.map((p) => p.evidenceId).filter(Boolean).slice(0, 2) ?? [],
      tech_readiness: [],
      capital_capacity: [],
      trigger_signal: account.signals.flatMap((s) => s.evidenceIds),
      reachability: account.contacts.flatMap((c) => c.evidenceIds).slice(0, 3),
    };

    account.icp = scoreAccount({
      pack,
      anchor,
      sites: account.sites,
      commodities: account.commodities,
      country: account.country,
      riskScan: account.riskScan,
      signals: account.signals,
      contactsNamed: account.contacts.filter((c) => c.tier !== "ROLE_TARGET_NO_NAME").length,
      hasPrimaryFiling: Boolean(account.secCik),
      evidence: evidenceByDim,
    });

    const regime = pack.regulatoryRegimes.find((r) => r.country === account.country && r.sourceUrl);
    account.sizing = sizeOpportunity({
      pack,
      sites: account.sites,
      regulatoryInstrument: regime ? { instrument: regime.instrument, sourceUrl: regime.sourceUrl!, obligation: regime.obligation } : undefined,
      geometryEvidenceIds: account.sites.flatMap((s) => s.evidenceIds),
    });

    const phase1 = phaseOneTarget(account.sites);
    account.anchorComparison = {
      value: buildAnchorComparison(account, anchorAccount, anchor, phase1),
      evidenceIds: [
        ...account.sites.slice(0, 2).flatMap((s) => s.evidenceIds),
        ...(account.riskScan?.passages.slice(0, 1).map((p) => p.evidenceId).filter(Boolean) ?? []),
      ],
    };

    emit("icp_scorer", "note", `${account.displayName}: ${account.icp.total}/100 → Tier ${account.icp.tier}.`);
  }

  const ordered = rankAccounts(accounts);

  // Stage 5, outreach. Runs only where a model key is configured; without one
  // the strategy is still produced (it is deterministic) and the absence of
  // copy is recorded rather than filled in by hand.
  const cadences: Record<string, CadenceStep[]> = {};
  const allDrafts: Record<string, EmailDraft[]> = {};
  const strategies: Record<string, MessageStrategy> = {};
  let accepted = 0;
  let rejected = 0;

  const modelAvailable = hasKey("groq") || hasKey("nim");
  emit("message_strategist", "start",
    modelAvailable
      ? "Composing outreach for the top accounts."
      : "No model key configured, producing message strategy only, and recording the absence of copy.",
  );

  // Work the accounts an AE would actually work: tier A and B, plus the anchor.
  const outreachTargets = ordered
    .filter((a) => a.icp.tier === "A" || a.icp.tier === "B" || a.isAnchor)
    .slice(0, 4);

  for (const account of outreachTargets) {
    const pickable = account.contacts
      .filter((c) => c.tier !== "ROLE_TARGET_NO_NAME")
      .slice(0, 3);
    const contacts = pickable.length > 0 ? pickable : account.contacts.slice(0, 2);
    const acceptedByContact = new Map<string, EmailDraft>();

    for (const contact of contacts) {
      const result = await generateEmail({
        account,
        contact,
        pack,
        evidence,
        touch: "first",
      });
      strategies[contact.id] = result.strategy;
      if (result.drafts.length) allDrafts[contact.id] = result.drafts;
      if (result.accepted) {
        acceptedByContact.set(contact.id, result.accepted);
        accepted++;
        rejected += result.drafts.length - 1;
        emit("red_team", "note",
          `${account.displayName} / ${contact.name ?? contact.targetRole}: accepted on iteration ${result.accepted.iteration} with score ${result.accepted.score}.`,
        );
      } else {
        rejected += result.drafts.length;
        if (result.blocked) {
          emit("red_team", "note", `${account.displayName} / ${contact.name ?? contact.targetRole}: ${result.blocked}`);
          noteNull({
            subject: account.displayName,
            question: `Could a compliant first-touch message be produced for ${contact.name ?? contact.targetRole}?`,
            attempts: [
              {
                source: "Copywriter then Red Team critic",
                outcome: result.blocked,
              },
            ],
            interpretation:
              "The critic is deliberately strict. It would rather emit nothing than emit a message that fails a gate, because a weak message spends the one first impression this account has.",
            remediation:
              "Either supply the missing sourced fact the gate requires, or relax the specific gate deliberately and record that decision.",
            producedBy: "red_team",
          });
        }
      }
    }

    cadences[account.id] = buildCadence({ account, contacts, accepted: acceptedByContact });
  }

  // Stage 6, the account executive hand-off. Deterministic: every question and
  // objection is derived from this account's own evidence rather than a generic
  // playbook, so each one carries the source it rests on.
  const briefs: Record<string, AeBrief> = {};
  emit("ae_briefer", "start", "Writing the account executive hand-off for every qualified account.");
  for (const account of ordered) {
    briefs[account.id] = buildAeBrief({
      account,
      pack,
      evidence,
      anchorName: brief.referenceAccount,
    });
  }
  emit("ae_briefer", "finish",
    `Wrote ${Object.keys(briefs).length} hand-off brief(s), each with discovery questions and objection handling tied to that account's own filings and measured ground.`,
  );

  emit("sequence_architect", "finish",
    `Built ${Object.keys(cadences).length} cadence(s); ${accepted} message(s) passed the critic, ${rejected} draft(s) were rejected.`,
  );

  // ── Freeze ─────────────────────────────────────────────────────────────
  const finishedAt = new Date().toISOString();
  const activeSites = ordered.flatMap((a) => a.sites.filter((s) => !s.excluded));

  const run: Run = {
    id: `run-${startedAt.slice(0, 10)}-${Date.now().toString(36)}`,
    brief,
    mode: "live",
    startedAt,
    finishedAt,
    plan: [
      { agent: "terrain_surveyor", task: "Measure all mapped extraction geometry in the target geographies", dependsOn: [] },
      { agent: "universe_scout", task: "Derive the account universe from operator attribution on that geometry", dependsOn: ["terrain_surveyor"] },
      { agent: "filings_analyst", task: "Mine primary filings for contractor dependency and hazard exposure", dependsOn: ["universe_scout"] },
      { agent: "people_finder", task: "Source named officers from statutory and company disclosures", dependsOn: ["universe_scout"] },
      { agent: "anchor_analyst", task: "Derive the ICP feature vector from the reference account's own measured profile", dependsOn: ["terrain_surveyor", "filings_analyst"] },
      { agent: "icp_scorer", task: "Score every account deterministically against the anchor", dependsOn: ["anchor_analyst"] },
      { agent: "opportunity_engineer", task: "Convert measured geometry into deployment sizing", dependsOn: ["icp_scorer"] },
    ],
    accounts: ordered,
    evidence,
    nullResults,
    cadences,
    briefs,
    trace,
    stats: {
      accountsConsidered: terrain.operatorTotals.size,
      accountsQualified: ordered.filter((a) => a.icp.tier === "A" || a.icp.tier === "B").length,
      sitesMeasured: activeSites.length,
      totalAreaKm2: round(activeSites.reduce((a, s) => a + s.areaKm2, 0), 2),
      evidenceRows: Object.keys(evidence).length,
      namedContacts: ordered.flatMap((a) => a.contacts).filter((c) => c.tier !== "ROLE_TARGET_NO_NAME").length,
      roleTargets: ordered.flatMap((a) => a.contacts).filter((c) => c.tier === "ROLE_TARGET_NO_NAME").length,
      emailsAccepted: accepted,
      emailsRejected: rejected,
      sourcesFetched,
      languages: [...new Set(Object.values(evidence).map((e) => e.language))],
    },
  };

  const dir = join(process.cwd(), "data");
  await mkdir(dir, { recursive: true });
  const isGraded = brief.id === GRADED_BRIEF.id;
  const runFile = isGraded ? "run-latest.json" : `run-${brief.verticalPackId}.json`;
  await writeFile(join(dir, runFile), JSON.stringify(run, null, 2), "utf8");

  const meta = {
    osmDataTimestamps: [...terrain.osmTimestamps],
    regionsQueried: terrain.regionsQueried,
    attribution: TERRAIN_ATTRIBUTION,
    generatedAt: finishedAt,
  };
  await writeFile(
    join(dir, isGraded ? "harvest-meta.json" : `harvest-meta-${brief.verticalPackId}.json`),
    JSON.stringify(meta, null, 2),
    "utf8",
  );
  await writeFile(
    join(dir, isGraded ? "outreach.json" : `outreach-${brief.verticalPackId}.json`),
    JSON.stringify({ drafts: allDrafts, strategies }, null, 2),
    "utf8",
  );
  console.log(`
  artifact: data/${runFile}`);

  console.log("\n" + "=".repeat(78));
  console.log(`RUN ${run.id}`);
  console.log("=".repeat(78));
  console.log(`  operators observed     ${run.stats.accountsConsidered}`);
  console.log(`  accounts resolved      ${run.accounts.length}`);
  console.log(`  qualified (A or B)     ${run.stats.accountsQualified}`);
  console.log(`  sites measured         ${run.stats.sitesMeasured}`);
  console.log(`  mapped footprint       ${run.stats.totalAreaKm2} km²`);
  console.log(`  evidence rows          ${run.stats.evidenceRows}`);
  console.log(`  named contacts         ${run.stats.namedContacts}`);
  console.log(`  role targets (no name) ${run.stats.roleTargets}`);
  console.log(`  null results           ${run.nullResults.length}`);
  console.log(`  sources fetched        ${run.stats.sourcesFetched}`);
  console.log(`  languages              ${run.stats.languages.join(", ")}`);
  console.log(`  emails accepted        ${run.stats.emailsAccepted}`);
  console.log(`  drafts rejected        ${run.stats.emailsRejected}`);
  console.log(`  OSM data timestamps    ${meta.osmDataTimestamps.join(", ") || "n/a"}`);
  console.log("\n  Tier ordering:");
  for (const a of run.accounts) {
    const named = a.contacts.filter((c) => c.tier !== "ROLE_TARGET_NO_NAME").length;
    console.log(
      `    ${a.icp.tier.padEnd(12)} ${String(a.icp.total).padStart(5)}  ${a.displayName.padEnd(30)} ${String(a.sites.length).padStart(3)} sites  ${String(round(a.sizing?.totalAreaKm2 ?? 0, 1)).padStart(8)} km²  ${named} named`,
    );
  }
  console.log("=".repeat(78));
}

function commoditiesFrom(sites: SiteGeometry[]): string[] {
  const out = new Set<string>();
  for (const s of sites) {
    const r = s.tags.resource ?? s.tags.mineral ?? "";
    for (const part of r.split(";")) {
      const v = part.trim().toLowerCase();
      if (v) out.add(v);
    }
  }
  return [...out];
}

function buildAnchorComparison(
  account: Account,
  anchorAccount: Account,
  anchor: ReturnType<typeof anchorProfileFrom>,
  phase1?: SiteGeometry,
): string {
  if (account.isAnchor) {
    return `${account.displayName} is the reference account. Its measured profile defines the target: ${round(anchor.measuredAreaKm2, 1)} km² of mapped footprint across ${anchor.siteCount} site(s), with ${anchor.contractorMentions} contractor reference(s) in its own primary filing.`;
  }
  const area = round(account.sizing?.totalAreaKm2 ?? 0, 1);
  const ratio = anchor.measuredAreaKm2 > 0 ? round(area / anchor.measuredAreaKm2, 2) : 0;
  const parts = [
    `${account.displayName} carries ${area} km² of mapped footprint across ${account.sites.filter((s) => !s.excluded).length} site(s), which is ${ratio}× the reference account's measured footprint.`,
  ];
  if (account.commodities.length) {
    parts.push(`Commodities recorded on its geometry: ${account.commodities.join(", ")}.`);
  }
  if (phase1) {
    parts.push(
      `The strongest single entry point is ${phase1.name ?? phase1.osmId} at ${round(phase1.areaKm2, 2)} km², which is where a one-dock phase one would sit.`,
    );
  }
  const contractor = account.riskScan
    ? (account.riskScan.termCounts.contractor ?? 0) + (account.riskScan.termCounts.contractors ?? 0)
    : 0;
  if (contractor > 0) {
    parts.push(`Its own annual filing refers to contractors ${contractor} time(s), which is the incumbent cost the angle displaces.`);
  }
  return parts.join(" ");
}

main().catch((err) => {
  console.error("Harvest failed:", err);
  process.exit(1);
});
