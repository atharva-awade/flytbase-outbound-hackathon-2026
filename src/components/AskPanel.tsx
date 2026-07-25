"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { cx } from "./ui";
import { fmtDate } from "@/lib/format";

interface AskEvidence {
  id: string;
  claim: string;
  sourceUrl: string;
  sourceClass: string;
  confidence: string;
  fetchedAt: string;
  verbatim?: string;
  language?: string;
}

interface AskFact {
  ref: string;
  text: string;
  kind: string;
  accountSlug?: string;
  evidence: AskEvidence[];
}

interface Answer {
  question: string;
  answer: string;
  facts: AskFact[];
  accounts: { slug: string; displayName: string }[];
  suggestsDiscovery: { place: string; vertical: string } | null;
  grounded: boolean;
  groundingNote?: string;
  model: string | null;
}

const SUGGESTIONS = [
  "Which account should I call first and why?",
  "Who runs Chuquicamata?",
  "What is the strongest reason to contact Codelco right now?",
  "What did SQM's own filing say about contractors?",
  "How much ground does Albemarle hold?",
  "Where did this pipeline fail?",
];

/**
 * Ask the run a question.
 *
 * The point of this box is not that it can chat. It is that it cannot answer
 * beyond what was measured. Retrieval happens in ordinary code on the server and
 * hands the model a numbered list of established facts, so every answer arrives
 * with the rows it was written from, and a question about ground this run never
 * touched gets a refusal and an offer to go and measure it.
 *
 * Which is why the sources sit under every answer by default rather than behind
 * a disclosure. In a tool whose entire argument is that the output is checkable,
 * hiding the evidence one click away would be the wrong default.
 */
export default function AskPanel() {
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [thread, setThread] = useState<Answer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (thread.length > 0) end.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [thread.length]);

  const ask = useCallback(
    async (q: string) => {
      const trimmed = q.trim();
      if (trimmed.length < 3 || busy) return;
      setBusy(true);
      setError(null);
      setQuestion("");
      try {
        const res = await fetch("/api/ask", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ question: trimmed }),
        });
        const data = (await res.json()) as Partial<Answer> & { error?: string };
        if (!res.ok) {
          setError(data.error ?? `The request failed with HTTP ${res.status}.`);
          return;
        }
        setThread((t) => [
          ...t,
          {
            question: trimmed,
            answer: data.answer ?? "",
            facts: data.facts ?? [],
            accounts: data.accounts ?? [],
            suggestsDiscovery: data.suggestsDiscovery ?? null,
            grounded: data.grounded ?? true,
            groundingNote: data.groundingNote,
            model: data.model ?? null,
          },
        ]);
      } catch (err) {
        setError(`The request failed: ${(err as Error).message}`);
      } finally {
        setBusy(false);
      }
    },
    [busy],
  );

  return (
    <div className="panel overflow-hidden">
      <div className="border-b border-[var(--color-hair)] px-5 py-4">
        <p className="t-label">Ask the run</p>
        <p className="t-small mt-1 max-w-2xl">
          Answers are written only from rows this run established. The retrieval that picks those rows is ordinary
          code and happens before the model is called, so the model has nothing else to draw on. Ask about ground it
          has not measured and it will say so, then offer to measure it.
        </p>
      </div>

      <div className="max-h-[30rem] overflow-y-auto px-5 py-4">
        {thread.length === 0 && (
          <div className="flex flex-wrap gap-1.5">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => void ask(s)}
                disabled={busy}
                className="rounded-[7px] bg-[var(--color-panel-sunk)] px-2.5 py-1.5 text-left text-[0.79rem] font-[500] transition-shadow hover:shadow-[var(--shadow-hair)] disabled:opacity-40"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        <div className="space-y-5">
          {thread.map((t, i) => (
            <div key={i}>
              <p className="text-[0.9rem] font-[600]">{t.question}</p>

              <p className="t-body mt-2 [overflow-wrap:anywhere]">{t.answer}</p>

              {!t.grounded && t.groundingNote && (
                <p className="mt-2 rounded-[8px] bg-[var(--color-conflict-wash)] px-2.5 py-1.5 text-[0.78rem] text-[var(--color-conflict-ink)]">
                  {t.groundingNote}
                </p>
              )}

              {t.suggestsDiscovery && (
                <Link
                  href="/discover"
                  className="mt-2 inline-block rounded-[8px] bg-[var(--color-ink)] px-3 py-1.5 text-[0.8rem] font-[520] text-white transition-opacity hover:opacity-88"
                >
                  Measure {t.suggestsDiscovery.place} live
                </Link>
              )}

              {t.facts.length > 0 && (
                <div className="mt-3 space-y-2 border-l-2 border-[var(--color-hair-2)] pl-3">
                  <p className="t-label">What that answer was written from</p>
                  {t.facts.map((f) => (
                    <div key={f.ref}>
                      <p className="t-micro [overflow-wrap:anywhere]">
                        <span className="tnum mr-1 font-[560] opacity-50">{f.ref}</span>
                        {f.text}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        {f.evidence.slice(0, 3).map((e) => (
                          <a
                            key={e.id}
                            href={e.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={`${e.claim}${e.verbatim ? `: "${e.verbatim.slice(0, 180)}"` : ""} · retrieved ${fmtDate(e.fetchedAt)}`}
                            className={cx(
                              "chip",
                              e.confidence === "verified" ? "chip-verified" : "chip-inferred",
                            )}
                          >
                            {e.sourceClass.replace(/_/g, " ")}
                          </a>
                        ))}
                        {f.accountSlug && (
                          <Link href={`/console/account/${f.accountSlug}`} className="chip chip-accent">
                            open the account
                          </Link>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {t.model && <p className="t-micro mt-2 opacity-55">prose by {t.model}, facts by retrieval</p>}
            </div>
          ))}
          <div ref={end} />
        </div>

        {busy && <p className="t-micro mt-3 shimmer inline-block rounded px-1">reading the run…</p>}
        {error && (
          <p className="mt-3 rounded-[8px] bg-[var(--color-conflict-wash)] px-2.5 py-1.5 text-[0.8rem] text-[var(--color-conflict-ink)]">
            {error}
          </p>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void ask(question);
        }}
        className="flex gap-2 border-t border-[var(--color-hair)] px-5 py-3"
      >
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask about an account, a person, a footprint, a signal or a gap"
          maxLength={400}
          className="min-w-0 flex-1 rounded-[9px] bg-[var(--color-panel-sunk)] px-3 py-2 text-[0.9rem] outline-none ring-1 ring-inset ring-transparent transition-shadow focus:ring-[var(--color-accent)]"
        />
        <button
          type="submit"
          disabled={busy || question.trim().length < 3}
          className="shrink-0 rounded-[9px] bg-[var(--color-ink)] px-3.5 py-2 text-[0.87rem] font-[530] text-white transition-opacity hover:opacity-88 disabled:opacity-35"
        >
          Ask
        </button>
      </form>
    </div>
  );
}
