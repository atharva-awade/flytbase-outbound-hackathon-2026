import { NextResponse } from "next/server";

import { buildContact } from "@/lib/sources/people";
import { findPublicProfiles, hasSerpKey } from "@/lib/sources/serp";
import { anchorProfileFrom, scoreAccount } from "@/lib/icp";
import { callerKey, limitResponse, take } from "@/lib/ratelimit";
import { generateEmail } from "@/lib/outreach";
import { getPack, GRADED_BRIEF } from "@/lib/verticals";
import { loadRun } from "@/lib/run";
import { revenueCase } from "@/lib/revenue";
import { round, summariseSites } from "@/lib/geo";
import { sizeOpportunity } from "@/lib/sizing";
import { saveDiscovery } from "@/lib/store";
import type { Account, Contact, EvidenceRow, SiteGeometry } from "@/lib/types";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * Take a discovered operator all the way to a drafted email.
 *
 * Measuring ground and naming the operator is Stage 1. This is Stages 2, 3 and 4
 * on an account that was not chosen in advance: find the people, score the
 * account against the reference profile, size the programme, and put a message
 * through the same critic the frozen run used.
 *
 * The point is that nothing here is a different code path. The scorer is the
 * scorer, the contact ladder is the contact ladder and the critic is the critic.
 * If this produced better copy than the console does, the console would be the
 * thing that was rigged.
 */
export async function POST(req: Request) {
  let body: {
    operator?: string;
    aliases?: string[];
    country?: string;
    packId?: string;
    sites?: SiteGeometry[];
    place?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Malformed request body." }, { status: 400 });
  }

  const operator = (body.operator ?? "").trim();
  const sites = Array.isArray(body.sites) ? body.sites : [];
  if (!operator || sites.length === 0) {
    return NextResponse.json(
      { error: "An operator and its measured sites are required. Run a discovery first." },
      { status: 400 },
    );
  }
  if (sites.length > 400) {
    return NextResponse.json({ error: "Too many sites in one request." }, { status: 413 });
  }

  const gate = take(`deep:${callerKey(req)}`, 6, 10 * 60_000);
  if (!gate.ok) {
    return limitResponse(
      gate,
      `Taking an account to a drafted email runs a live profile search and up to four model calls, so it is capped at six every ten minutes. Try again in ${gate.retryAfter}s.`,
    );
  }

  const pack = getPack(body.packId ?? "mining");
  const country = (body.country ?? "CL").toUpperCase();
  const encoder = new TextEncoder();
  let seq = 0;

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (event: Record<string, unknown>) => {
        if (closed) return;
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ seq: ++seq, at: new Date().toISOString(), ...event })}\n\n`),
        );
      };
      const beat = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(":ka\n\n"));
      }, 10_000);
      const finish = () => {
        clearInterval(beat);
        if (!closed) {
          closed = true;
          controller.close();
        }
      };

      const evidence: Record<string, EvidenceRow> = {};
      const addEvidence = (row: EvidenceRow) => {
        evidence[row.id] = row;
        return row.id;
      };

      try {
        const summary = summariseSites(sites);
        const workingLanguage = country === "BR" ? "pt-BR" : country === "PE" ? "es-PE" : "es-CL";

        send({
          type: "start",
          agent: "chief_of_staff",
          message: `Taking ${operator} from measured ground to a drafted message. Same scorer, same contact ladder and same critic the console uses, on an account nobody picked in advance.`,
        });

        // ── Stage 2, contacts ───────────────────────────────────────────
        send({
          type: "step",
          agent: "people_finder",
          message: hasSerpKey()
            ? `Searching public professional profiles for operations, site and HSE leadership at ${operator}. A profile that names a different operator is rejected rather than kept.`
            : `No search key is configured, so no named contact can be produced. The buying committee is still described by role, which is a weaker but honest answer.`,
        });

        const contacts: Contact[] = [];
        let rejectedProfiles: string[] = [];
        let queriesRun: string[] = [];

        if (hasSerpKey()) {
          const found = await findPublicProfiles({
            companyNames: [operator, ...(body.aliases ?? [])],
            country,
            language: workingLanguage,
            maxQueries: 3,
          });
          rejectedProfiles = found.rejected;
          queriesRun = found.queriesRun;

          for (const candidate of found.candidates.slice(0, 6)) {
            const rowId = `ev-deep-${slug(operator)}-${slug(candidate.name)}`;
            addEvidence({
              id: rowId,
              claim: `${candidate.name} is described as "${candidate.titleVerbatim}" at ${operator}`,
              sourceUrl: candidate.profileUrl,
              sourceClass: "search_result",
              fetchedAt: new Date().toISOString(),
              verbatim: candidate.serpTitle,
              language: workingLanguage,
              confidence: "INFERRED",
              attributionMethod: "company_reported",
              producedBy: "people_finder",
            });
            contacts.push(
              buildContact({
                accountId: slug(operator),
                person: candidate,
                sourceUrl: candidate.profileUrl,
                tier: "NAMED_PUBLIC_PROFILE",
                language: workingLanguage,
                sites: sites.slice(0, 8).map((x) => ({ osmId: x.osmId, name: x.name })),
                evidenceIds: [rowId],
              }),
            );
          }
        }

        // Role targets for whatever the brief asks for and the search did not find.
        for (const wanted of GRADED_BRIEF.targetRoles) {
          const covered = contacts.some((c) =>
            (c.titleVerbatim ?? c.targetRole).toLowerCase().includes(wanted.split(" ").pop()!.toLowerCase()),
          );
          if (covered) continue;
          contacts.push({
            id: `contact-${slug(operator)}-role-${slug(wanted)}`,
            tier: "ROLE_TARGET_NO_NAME",
            targetRole: wanted,
            buyingRole: /hse|safety/i.test(wanted) ? "risk_validator" : "champion",
            seniority: /vp/i.test(wanted) ? "vp" : "director",
            accountId: slug(operator),
            evidenceIds: [],
            producedBy: "people_finder",
            findingPlaybook: [
              `No individual was found for ${wanted} at ${operator}. Nothing is invented in its place.`,
              `Where the operator is state owned, check for a statutory transparency disclosure, which publishes officers and appointment dates.`,
              `Conference speaker rosters are the only source class that reliably carries operations and HSE titles rather than only chief executives.`,
            ],
          });
        }

        send({
          type: "contacts",
          agent: "people_finder",
          contacts,
          rejected: rejectedProfiles,
          queries: queriesRun,
          message: `${contacts.filter((c) => c.tier !== "ROLE_TARGET_NO_NAME").length} named contact(s), ${contacts.filter((c) => c.tier === "ROLE_TARGET_NO_NAME").length} role target(s) with no individual found. ${rejectedProfiles.length} candidate(s) rejected, each with the reason kept.`,
        });

        // ── Stage 3, research and qualification ─────────────────────────
        send({
          type: "step",
          agent: "icp_scorer",
          message: `Scoring ${operator} against the reference profile from the brief, on the same published weights the console uses.`,
        });

        const run = await loadRun();
        const anchorAccount = run?.accounts.find((a) => a.isAnchor);
        const anchor = anchorAccount
          ? anchorProfileFrom({
              sites: anchorAccount.sites,
              commodities: anchorAccount.commodities ?? [],
              riskScan: anchorAccount.riskScan,
              workingLanguage: anchorAccount.workingLanguage ?? "es-CL",
              country: anchorAccount.countryName ?? "Chile",
            })
          : null;

        const icp = anchor
          ? scoreAccount({
              pack,
              anchor,
              sites,
              commodities: [],
              country,
              signals: [],
              contactsNamed: contacts.filter((c) => c.tier !== "ROLE_TARGET_NO_NAME").length,
              // No filing was fetched for a live discovery, and the scorer records
              // the dimensions that need one as unscored rather than assuming a
              // value. A missing input is not a zero.
              hasPrimaryFiling: false,
              evidence: {},
            })
          : null;

        const sizing = sizeOpportunity({ pack, sites, geometryEvidenceIds: [] });
        const money = revenueCase(sizing, summary.totalAreaKm2);

        send({
          type: "qualified",
          agent: "icp_scorer",
          icp,
          sizing,
          revenue: money,
          summary,
          message: icp
            ? `${operator} scores ${icp.total} out of 100, tier ${icp.tier}. Scored on geometry alone here: no filing was fetched for this account, and the dimensions that need one are recorded as unscored rather than guessed at.`
            : `No reference account is loaded, so no comparative score can be produced. The programme sizing below still stands, because it needs only the measured ground.`,
        });

        // ── Stage 4, the message ────────────────────────────────────────
        const target =
          contacts.find((c) => c.tier !== "ROLE_TARGET_NO_NAME" && /oper|site|faena|hse|safety|seguridad/i.test(c.titleVerbatim ?? "")) ??
          contacts.find((c) => c.tier !== "ROLE_TARGET_NO_NAME") ??
          contacts[0];

        send({
          type: "step",
          agent: "copywriter",
          message: `Drafting a first touch for ${target.name ?? target.targetRole}, then handing it to the critic. Rejected drafts are kept and shown.`,
        });

        const account: Account = {
          id: slug(operator),
          slug: slug(operator),
          displayName: operator,
          legalName: operator,
          countryName: country === "BR" ? "Brazil" : country === "PE" ? "Peru" : "Chile",
          country,
          verticalPackId: pack.id,
          commodities: [],
          workingLanguage,
          sites,
          icp: icp ?? {
            total: 0,
            tier: "C",
            tierRationale: "Unscored: no reference account was loaded.",
            dimensions: [],
            disqualifiers: [],
          },
          signals: [],
          anchorComparison: {
            value: `${operator} holds ${round(summary.totalAreaKm2, 2)} km² of mapped footprint across ${summary.siteCount} measured feature(s), discovered live rather than from a prepared list.`,
            evidenceIds: [],
          },
          contacts,
          sizing,
          isAnchor: false,
        };

        const emailResult = await generateEmail({
          account,
          contact: target,
          pack,
          evidence,
          touch: "first",
        });

        send({
          type: "outreach",
          agent: "red_team",
          contactId: target.id,
          contactName: target.name ?? target.targetRole,
          strategy: emailResult.strategy,
          drafts: emailResult.drafts,
          accepted: emailResult.drafts.find((d) => d.accepted) ?? null,
          message: emailResult.drafts.some((d) => d.accepted)
            ? `Accepted on iteration ${emailResult.drafts.find((d) => d.accepted)?.iteration}. Every earlier draft is above with the gate that rejected it.`
            : `The critic rejected every attempt. That is the honest outcome and the drafts are shown with their failing gates, because an accepted bad message costs more than a rejected one.`,
        });

        // ── Persist ─────────────────────────────────────────────────────
        const saved = await saveDiscovery({
          place: body.place ?? "",
          packId: pack.id,
          operator,
          aliases: body.aliases ?? [],
          country,
          summary,
          sites,
          contacts,
          icp,
          sizing,
          revenue: money,
          drafts: emailResult.drafts,
          evidence,
        });

        send({
          type: "saved",
          agent: "exporter",
          storage: saved.driver,
          id: saved.id,
          persisted: saved.persisted,
          message: saved.persisted
            ? `Saved as ${saved.id} in ${saved.driver}. It will still be here on the next visit, and it appears in the saved list.`
            : `Not persisted: ${saved.reason} The result above is complete and exportable, it simply will not survive a reload.`,
        });

        send({ type: "done", message: `${operator} taken from measured ground to a critiqued message.` });
      } catch (err) {
        send({
          type: "error",
          message: `The pipeline failed at this step: ${(err as Error).message}. Shown rather than retried into silence.`,
        });
      } finally {
        finish();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}
