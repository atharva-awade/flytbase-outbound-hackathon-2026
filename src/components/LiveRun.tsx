"use client";

import { useCallback, useRef, useState } from "react";

import { AGENTS } from "@/lib/agents";
import { cx } from "./ui";

interface StreamEvent {
  seq: number;
  at: string;
  agent?: string;
  phase?: "start" | "tool" | "note" | "finish" | "error";
  message?: string;
  tool?: string;
  url?: string;
  latencyMs?: number;
  evidenceCreated?: number;
  done?: boolean;
  error?: boolean;
  tier?: string;
  total?: number;
  evidenceCount?: number;
}

/**
 * Re-runs the pipeline for one account against live sources and streams it.
 *
 * A recorded result and a fabricated one look identical on a page, so this exists
 * to remove the doubt: the reviewer presses a button and watches the system open
 * real URLs and derive the same figures in front of them. Failures are shown as
 * they happen rather than retried into silence, because a live run against public
 * endpoints is exactly where a pipeline hits a wall and that is worth seeing.
 */
export function LiveRun({ slug, displayName }: { slug: string; displayName: string }) {
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [state, setState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [summary, setSummary] = useState<StreamEvent | null>(null);
  const abort = useRef<AbortController | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);

  const run = useCallback(async () => {
    setEvents([]);
    setSummary(null);
    setState("running");
    const ctrl = new AbortController();
    abort.current = ctrl;

    try {
      const res = await fetch(`/api/run?account=${encodeURIComponent(slug)}`, {
        signal: ctrl.signal,
        headers: { Accept: "text/event-stream" },
      });
      if (!res.ok || !res.body) throw new Error(`Stream failed with ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE frames are separated by a blank line.
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const line = frame.split("\n").find((l) => l.startsWith("data:"));
          if (!line) continue;
          try {
            const ev = JSON.parse(line.slice(5).trim()) as StreamEvent;
            if (ev.done) {
              setSummary(ev);
              setState(ev.error ? "error" : "done");
            } else {
              setEvents((prev) => [...prev, ev]);
              requestAnimationFrame(() => {
                logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
              });
            }
          } catch {
            /* a partial frame is not an error */
          }
        }
      }
      setState((s) => (s === "running" ? "done" : s));
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setEvents((prev) => [
          ...prev,
          {
            seq: 9_999,
            at: new Date().toISOString(),
            phase: "error",
            message: (err as Error).message,
          },
        ]);
        setState("error");
      }
    }
  }, [slug]);

  const stop = useCallback(() => {
    abort.current?.abort();
    setState("idle");
  }, []);

  return (
    <div className="rounded-[14px] bg-[var(--color-panel)] p-4 shadow-[var(--shadow-panel)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <p className="t-label">Prove it · live run</p>
          <p className="t-small mt-1.5">
            A recorded result and an invented one look the same on a page. Press this and the pipeline
            re-executes for {displayName} against live sources right now, opening the same URLs, measuring the
            same geometry and reaching the same score, in front of you.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {state === "running" ? (
            <button
              type="button"
              onClick={stop}
              className="rounded-[8px] bg-[var(--color-panel-sunk)] px-3 py-2 text-[0.84rem] font-[520]"
            >
              Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={run}
              className="rounded-[8px] bg-[var(--color-accent)] px-3 py-2 text-[0.84rem] font-[520] text-white transition-opacity hover:opacity-88"
            >
              {state === "idle" ? "Run it now" : "Run again"}
            </button>
          )}
        </div>
      </div>

      {(state !== "idle" || events.length > 0) && (
        <div className="mt-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {state === "running" && (
                <span className="pulse-ring inline-block h-2 w-2 rounded-full bg-[var(--color-accent)]" />
              )}
              <span className="t-micro">
                {state === "running"
                  ? "executing against live sources…"
                  : state === "done"
                    ? "run complete"
                    : state === "error"
                      ? "run ended with an error"
                      : ""}
              </span>
            </div>
            <span className="t-micro tnum">{events.length} steps</span>
          </div>

          <div
            ref={logRef}
            className="slim-scroll mt-2 max-h-80 overflow-y-auto rounded-[10px] bg-[var(--color-panel-sunk)] p-3 font-[family-name:var(--font-mono)] text-[0.74rem] leading-[1.6]"
          >
            {events.map((e) => {
              const agentTitle = AGENTS.find((a) => a.id === e.agent)?.title ?? e.agent ?? "system";
              return (
                <div key={e.seq} className="flex gap-2 py-0.5">
                  <span className="shrink-0 tabular-nums opacity-45">{e.at.slice(11, 19)}</span>
                  <span
                    className={cx(
                      "shrink-0 w-[9.5rem] truncate",
                      e.phase === "error" ? "text-[var(--color-conflict)]" : "text-[var(--color-ink-3)]",
                    )}
                  >
                    {agentTitle}
                  </span>
                  <span
                    className={cx(
                      "min-w-0 flex-1",
                      e.phase === "error"
                        ? "text-[var(--color-conflict)]"
                        : e.phase === "tool"
                          ? "text-[var(--color-accent)]"
                          : "text-[var(--color-ink-2)]",
                    )}
                  >
                    {e.message}
                    {e.url && (
                      <a
                        href={e.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-1 break-all underline opacity-60 hover:opacity-100"
                      >
                        {e.url.replace(/^https?:\/\//, "").slice(0, 52)}
                      </a>
                    )}
                    {e.latencyMs !== undefined && (
                      <span className="ml-1 tabular-nums opacity-50">{e.latencyMs}ms</span>
                    )}
                  </span>
                </div>
              );
            })}
            {state === "running" && events.length === 0 && (
              <p className="opacity-60">opening the first source…</p>
            )}
          </div>

          {summary && !summary.error && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="chip chip-verified">
                live score {summary.total} → tier {summary.tier}
              </span>
              <span className="chip chip-accent">{summary.evidenceCount} evidence rows created just now</span>
              <span className="t-micro">
                These were derived during this request. Compare them with the figures on this page.
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
