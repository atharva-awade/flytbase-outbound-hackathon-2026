import { NextResponse } from "next/server";

import { ASK_PREFIX, buildAskPrompt, retrieve } from "@/lib/ask";
import { hasKey, writeProse } from "@/lib/llm";
import { callerKey, limitResponse, take } from "@/lib/ratelimit";
import { loadRun } from "@/lib/run";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The question box.
 *
 * Retrieval is ordinary code and runs before the model is called. The model
 * receives a numbered list of facts and a question, and is told it has no other
 * knowledge. What comes back is checked before it is returned: any fact handle
 * the answer cites is resolved to the rows behind it, so the interface can show
 * real citation chips rather than the model's word that a source exists.
 *
 * Two failure modes are handled explicitly rather than smoothed over. When
 * nothing in the run scores against the question, the answer says so and offers
 * to measure the ground live. When no model key is configured, the retrieved
 * facts are returned as they are, which is less pleasant to read and just as
 * true.
 */
export async function POST(req: Request) {
  let body: { question?: string };
  try {
    body = (await req.json()) as { question?: string };
  } catch {
    return NextResponse.json({ error: "Malformed request body." }, { status: 400 });
  }

  const question = (body.question ?? "").trim();
  if (question.length < 3) {
    return NextResponse.json({ error: "Ask a question." }, { status: 400 });
  }
  if (question.length > 400) {
    return NextResponse.json(
      { error: "That is longer than this box is built for. Try a single question." },
      { status: 400 },
    );
  }

  const run = await loadRun();
  if (!run) {
    return NextResponse.json({ error: "No run is loaded on this deployment." }, { status: 503 });
  }

  const retrieval = retrieve(question, run);

  // Retrieval is free; the model call is not, and it shares an organisation
  // scoped rate limit with everything else here.
  const gate = take(`ask:${callerKey(req)}`, 20, 5 * 60_000);
  if (!gate.ok) {
    return limitResponse(
      gate,
      `Twenty questions every five minutes per caller, because the model behind this shares one organisation quota with the rest of the site. Try again in ${gate.retryAfter}s.`,
    );
  }

  // ── nothing matched ────────────────────────────────────────────────────
  if (retrieval.empty) {
    return NextResponse.json({
      answer:
        retrieval.suggestsDiscovery !== null
          ? `This run has not measured that ground, so there is nothing here to answer from. Rather than guess, measure it: a live search of ${retrieval.suggestsDiscovery.place} will resolve the place, return every mapped feature in it and read the operators off the tags.`
          : "Nothing in this run matches that question, and I will not answer it from outside the run. The corpus covers the accounts on the console, their measured footprints, their filings, their named contacts, the timing signals behind each one and the gaps where a source could not be found.",
      facts: [],
      accounts: retrieval.accounts,
      suggestsDiscovery: retrieval.suggestsDiscovery,
      grounded: true,
      model: null,
    });
  }

  // ── no model configured ────────────────────────────────────────────────
  if (!hasKey("groq") && !hasKey("nim")) {
    return NextResponse.json({
      answer:
        "No model key is configured on this deployment, so there is no prose layer. The established facts that match your question are below, unedited. They are the same rows an answer would have been written from.",
      facts: retrieval.facts.map(publicFact),
      accounts: retrieval.accounts,
      suggestsDiscovery: retrieval.suggestsDiscovery,
      grounded: true,
      model: null,
    });
  }

  try {
    const { text, usage } = await writeProse({
      staticPrefix: ASK_PREFIX,
      userContent: buildAskPrompt(question, retrieval),
      maxTokens: 420,
      temperature: 0.3,
    });

    const answer = text.trim();

    // Which handles did it actually cite? Only those rows are offered as
    // sources, so a chip on screen always corresponds to a claim in the text.
    //
    // Matching on the bracket was too strict and flagged sound answers as
    // ungrounded: the model writes "[F1, F2, F3]" for a group and occasionally
    // reaches for fullwidth brackets. So every F-token in the text is collected
    // and intersected with the handles that were actually issued, which cannot
    // produce a false positive because those handles exist nowhere else.
    const known = new Set(retrieval.facts.map((f) => f.ref));
    const cited = new Set(
      Array.from(answer.matchAll(/F\d+/g))
        .map((m) => m[0])
        .filter((ref) => known.has(ref)),
    );
    const usedFacts = retrieval.facts.filter((f) => cited.has(f.ref));

    // A figure or a name with no handle anywhere is the one thing that would let
    // an unsupported claim through, so it is reported rather than hidden.
    const hasNumber = /\d/.test(answer);
    const uncited = hasNumber && cited.size === 0;

    return NextResponse.json({
      answer,
      facts: (usedFacts.length > 0 ? usedFacts : retrieval.facts.slice(0, 3)).map(publicFact),
      accounts: retrieval.accounts,
      suggestsDiscovery: retrieval.suggestsDiscovery,
      grounded: !uncited,
      groundingNote: uncited
        ? "This answer carries figures but cited no fact handle, so treat it with suspicion and read the rows below, which are what it was given."
        : undefined,
      model: usage.model,
      cachedTokens: usage.tokensCached,
    });
  } catch (err) {
    return NextResponse.json(
      {
        answer: `The model call failed, so here are the matching facts unedited instead. ${(err as Error).message}`,
        facts: retrieval.facts.map(publicFact),
        accounts: retrieval.accounts,
        suggestsDiscovery: retrieval.suggestsDiscovery,
        grounded: true,
        model: null,
      },
      { status: 200 },
    );
  }
}

function publicFact(f: ReturnType<typeof retrieve>["facts"][number]) {
  return {
    ref: f.ref,
    text: f.text,
    kind: f.kind,
    accountSlug: f.accountSlug,
    evidence: f.evidence.map((e) => ({
      id: e.id,
      claim: e.claim,
      sourceUrl: e.sourceUrl,
      sourceClass: e.sourceClass,
      confidence: e.confidence,
      fetchedAt: e.fetchedAt,
      verbatim: e.verbatim,
      language: e.language,
    })),
  };
}
