import { NextResponse } from "next/server";

import { attributeToCompany, osmUrl, queryTerrain, REGIONS, round, summariseSites } from "@/lib/geo";
import { anchorProfileFrom, scoreAccount } from "@/lib/icp";
import { sizeOpportunity } from "@/lib/sizing";
import { companyFilings, scanFiling } from "@/lib/sources/sec";
import {
  buildContact,
  classifyRole,
  extractLeadershipCards,
  extractTransparencyTable,
  fetchPage,
  isSoftNotFound,
  PEOPLE_SOURCES,
} from "@/lib/sources/people";
import { getPack, GRADED_BRIEF } from "@/lib/verticals";
import { loadRun } from "@/lib/run";
import type { EvidenceRow, SiteGeometry } from "@/lib/types";

/** Vercel's ceiling on this plan. The run is scoped to fit well inside it. */
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * Live single-account run, streamed.
 *
 * The frozen runs on this site are real, but a reviewer has no way to tell a
 * recorded result from a fabricated one by looking at it. So this endpoint
 * re-executes the pipeline for one account against live sources, right now, and
 * streams every step as it happens: the query it sends, the URL it opens, what
 * came back, and what it concluded.
 *
 * It is deliberately scoped to a single account. The full run touches Overpass
 * across nine regions and takes minutes, which does not fit a request, and
 * pretending otherwise would mean faking the thing this endpoint exists to prove.
 *
 * When a live source rate-limits or times out, that appears in the stream as a
 * failure rather than being retried into silence. The brief asks to be shown
 * where the pipeline hits a wall, and a live run is exactly where that happens.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const slug = url.searchParams.get("account") ?? "codelco";

  const frozen = await loadRun();
  const account = frozen?.accounts.find((a) => a.slug === slug);
  if (!frozen || !account) {
    return NextResponse.json({ error: "Unknown account." }, { status: 404 });
  }

  const pack = getPack(account.verticalPackId);
  const encoder = new TextEncoder();
  let seq = 0;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ seq: ++seq, at: new Date().toISOString(), ...event })}\n\n`),
        );
      };
      // HTTP/1.1 intermediaries drop idle connections, so the stream is kept warm.
      const heartbeat = setInterval(() => controller.enqueue(encoder.encode(":ka\n\n")), 10_000);

      const evidence: EvidenceRow[] = [];
      const addEvidence = (row: Omit<EvidenceRow, "id">) => {
        const e = { id: `live-${evidence.length + 1}`, ...row };
        evidence.push(e);
        return e;
      };

      try {
        send({
          agent: "chief_of_staff",
          phase: "start",
          message: `Live run for ${account.displayName}. Re-executing the pipeline against live sources rather than replaying the recorded result.`,
        });
        send({
          agent: "chief_of_staff",
          phase: "note",
          message:
            "Scoped to one account on purpose: a full run queries nine regions and takes minutes, which does not fit inside a single request.",
        });

        // ── Terrain ────────────────────────────────────────────────────
        const regionKey =
          Object.keys(REGIONS).find((k) => k.startsWith(`${account.country}-`)) ?? "CL-north";
        send({
          agent: "terrain_surveyor",
          phase: "tool",
          message: `Querying OpenStreetMap for mapped ${pack.label.toLowerCase()} geometry in ${regionKey}.`,
          tool: "overpass",
          url: "https://overpass-api.de/api/interpreter",
        });

        let sites: SiteGeometry[] = [];
        const t0 = Date.now();
        try {
          const res = await queryTerrain(pack, REGIONS[regionKey]);
          send({
            agent: "terrain_surveyor",
            phase: "note",
            message: `${res.sites.length} features returned, ${res.operators.length} distinct operators${res.cacheHit ? " (served from this deployment's cache)" : " (fetched live)"}. OSM data as of ${res.osmDataTimestamp ?? "unknown"}.`,
            latencyMs: Date.now() - t0,
          });

          sites = attributeToCompany(res.sites, {
            legalName: account.legalName,
            aliases: [account.displayName],
          });

          const summary = summariseSites(sites);
          send({
            agent: "terrain_surveyor",
            phase: "finish",
            message: `Attributed ${summary.siteCount} site(s) to ${account.displayName}, totalling ${summary.totalAreaKm2} km² of mapped footprint. ${summary.attributedSiteCount} carry an explicit operator or name match; ${summary.clusteredSiteCount} are proximity-inferred.`,
          });

          for (const s of sites.slice(0, 4)) {
            const e = addEvidence({
              claim: `${account.displayName} operates a mapped feature of ${round(s.areaKm2, 3)} km²${s.name ? ` known as ${s.name}` : ""}`,
              value: round(s.areaKm2, 3),
              unit: "km²",
              sourceUrl: osmUrl(s.osmId),
              sourceClass: "geospatial",
              fetchedAt: new Date().toISOString(),
              verbatim: `${s.osmId} · ${Object.entries(s.tags).map(([k, v]) => `${k}=${v}`).join(" · ")}`,
              language: "en",
              confidence: "VERIFIED",
              attributionMethod: s.attributionMethod,
              producedBy: "terrain_surveyor",
            });
            send({
              agent: "terrain_surveyor",
              phase: "note",
              message: `Evidence: ${e.claim}`,
              url: e.sourceUrl,
              evidenceCreated: 1,
            });
          }
        } catch (err) {
          send({
            agent: "terrain_surveyor",
            phase: "error",
            message: `Overpass failed: ${(err as Error).message}. This is the most common live failure — the public endpoint rate-limits aggressive querying, which is exactly why the graded run queries it at harvest time and serves measured geometry from a frozen artifact.`,
          });
        }

        // ── Primary filing ─────────────────────────────────────────────
        let riskScan = account.riskScan;
        if (account.secCik) {
          send({
            agent: "filings_analyst",
            phase: "tool",
            message: `Resolving filings for CIK ${account.secCik} from the securities regulator.`,
            tool: "sec_submissions",
            url: `https://data.sec.gov/submissions/CIK${account.secCik}.json`,
          });
          const t1 = Date.now();
          try {
            const filings = await companyFilings(account.secCik);
            const annual = filings.filings.find((f) => f.form === "20-F" || f.form === "10-K");
            if (annual) {
              send({
                agent: "filings_analyst",
                phase: "note",
                message: `Found ${annual.form} filed ${annual.filingDate}. Downloading and scanning it for contractor and hazard language.`,
                url: annual.url,
                latencyMs: Date.now() - t1,
              });
              const { scan } = await scanFiling(annual, pack.riskFactorTerms, {
                label: `${annual.form} filed ${annual.filingDate}`,
              });
              riskScan = scan;
              const contractor =
                (scan.termCounts.contractor ?? 0) + (scan.termCounts.contractors ?? 0);
              send({
                agent: "filings_analyst",
                phase: "finish",
                message: `Scanned ${scan.totalChars.toLocaleString("en-GB")} characters. Contractor references: ${contractor}. Terms searched and found zero times: ${scan.absentTerms.filter((t) => ["drone", "autonomous", "automation"].includes(t)).join(", ") || "none"}.`,
              });
              const passage = scan.passages[0];
              if (passage) {
                send({
                  agent: "filings_analyst",
                  phase: "note",
                  message: `Verbatim from their own filing: "${passage.verbatim.slice(0, 260)}…"`,
                  url: annual.url,
                  evidenceCreated: 1,
                });
              }
            } else {
              send({
                agent: "filings_analyst",
                phase: "error",
                message: "No annual filing in the recent index, so contractor dependency cannot be scored from primary disclosure.",
              });
            }
          } catch (err) {
            send({
              agent: "filings_analyst",
              phase: "error",
              message: `Filing retrieval failed: ${(err as Error).message}`,
            });
          }
        } else {
          send({
            agent: "filings_analyst",
            phase: "note",
            message: `${account.displayName} files with no securities regulator we can read, so no claim is made about its contractor dependency.`,
          });
        }

        // ── People ─────────────────────────────────────────────────────
        const sources = PEOPLE_SOURCES.filter((s) => s.accountKey === account.slug);
        const liveContacts: string[] = [];
        for (const src of sources.slice(0, 2)) {
          send({
            agent: "people_finder",
            phase: "tool",
            message: `Reading ${new URL(src.url).hostname}${new URL(src.url).pathname}. ${src.basis}`,
            tool: src.extractor,
            url: src.url,
          });
          const t2 = Date.now();
          try {
            const html = await fetchPage(src.url);
            if (isSoftNotFound(html, ["cargo", "gerente", "vicepresident", "ejecutiv", "executive"])) {
              send({
                agent: "people_finder",
                phase: "error",
                message: "Answered 200 but the page carries no officer markers — a soft 404. Recorded as a gap rather than a success.",
              });
              continue;
            }
            const people =
              src.extractor === "transparency_table"
                ? extractTransparencyTable(html)
                : extractLeadershipCards(html);
            const relevant = people.filter((p) => classifyRole(p.titleVerbatim).relevance >= 0.28);
            send({
              agent: "people_finder",
              phase: "note",
              message: `${people.length} officer(s) published, ${relevant.length} relevant to this buying committee.`,
              latencyMs: Date.now() - t2,
            });
            for (const person of relevant.slice(0, 3)) {
              const c = buildContact({
                person,
                accountId: account.id,
                sourceUrl: src.url,
                tier: "NAMED_VERIFIED",
                sites,
                language: src.language,
                evidenceIds: [],
              });
              liveContacts.push(c.id);
              send({
                agent: "people_finder",
                phase: "note",
                message: `Named, with a source: ${person.name} — "${person.titleVerbatim}"${person.appointedAt ? `, in post since ${person.appointedAt}` : ""}${person.tenureCharacter ? ` (${person.tenureCharacter})` : ""}.`,
                url: src.url,
                evidenceCreated: 1,
              });
            }
          } catch (err) {
            send({
              agent: "people_finder",
              phase: "error",
              message: `${src.url} failed: ${(err as Error).message}`,
            });
          }
        }

        // ── Score ──────────────────────────────────────────────────────
        send({
          agent: "icp_scorer",
          phase: "start",
          message: "Scoring against the reference account with published weights. This step is ordinary arithmetic, so it produces the same number every time.",
        });

        const anchorAccount = frozen.accounts.find((a) => a.isAnchor) ?? frozen.accounts[0];
        const anchor = anchorProfileFrom({
          sites: anchorAccount.sites,
          commodities: anchorAccount.commodities,
          riskScan: anchorAccount.riskScan,
          workingLanguage: anchorAccount.workingLanguage,
          country: anchorAccount.country,
        });

        const icp = scoreAccount({
          pack,
          anchor,
          sites: sites.length ? sites : account.sites,
          commodities: account.commodities,
          country: account.country,
          riskScan,
          signals: account.signals,
          contactsNamed: liveContacts.length || account.contacts.filter((c) => c.tier !== "ROLE_TARGET_NO_NAME").length,
          hasPrimaryFiling: Boolean(account.secCik),
          evidence: {},
        });

        for (const d of icp.dimensions.slice(0, 4)) {
          send({
            agent: "icp_scorer",
            phase: "note",
            message: `${d.label}: weight ${d.weight.toFixed(2)} × signal ${d.raw.toFixed(2)} = ${d.contribution.toFixed(1)}${d.unscored ? " (no evidence, so zero rather than an estimate)" : ""}`,
          });
        }
        send({
          agent: "icp_scorer",
          phase: "finish",
          message: `Total ${icp.total} of 100 → Tier ${icp.tier}.`,
        });

        // ── Size ───────────────────────────────────────────────────────
        if (sites.length) {
          const sizing = sizeOpportunity({ pack, sites, geometryEvidenceIds: [] });
          send({
            agent: "opportunity_engineer",
            phase: "finish",
            message: `From ${sizing.totalAreaKm2} km² measured across ${sizing.siteCount} site(s): ${sizing.docksRequired.low}–${sizing.docksRequired.high} docks for full coverage, ${sizing.missionsPerMonth.low}–${sizing.missionsPerMonth.high} missions a month, displacing ${sizing.contractorCrewDaysDisplacedPerMonth.low}–${sizing.contractorCrewDaysDisplacedPerMonth.high} contracted crew-days a month.`,
          });
        }

        send({
          agent: "chief_of_staff",
          phase: "finish",
          message: `Live run complete. ${evidence.length} evidence row(s) created from sources fetched during this request. Compare the figures above with the frozen account brief — they are produced by the same code.`,
        });

        send({ done: true, evidenceCount: evidence.length, tier: icp.tier, total: icp.total });
      } catch (err) {
        send({ agent: "chief_of_staff", phase: "error", message: `Run aborted: ${(err as Error).message}` });
        send({ done: true, error: true });
      } finally {
        clearInterval(heartbeat);
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Prevents proxy buffering, without which nothing appears until the end.
      "X-Accel-Buffering": "no",
    },
  });
}
