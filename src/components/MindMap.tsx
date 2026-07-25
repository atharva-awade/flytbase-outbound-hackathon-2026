"use client";

import { useMemo, useState } from "react";

import { AGENTS, DESKS, KIND_LABEL, type AgentNode } from "@/lib/agents";
import type { AgentId, TraceEvent } from "@/lib/types";
import { cx } from "./ui";

const KIND_STYLE: Record<AgentNode["kind"], string> = {
  deterministic: "chip-verified",
  model: "chip-inferred",
  fetch: "chip-accent",
  orchestration: "chip-null",
};

/**
 * The thought-process artefact.
 *
 * Built as an org chart on purpose. A reviewer from a revenue team should be
 * able to see six named specialists, understand what each one does from a single
 * sentence, and — critically — see the one edge that runs backwards, where the
 * critic rejects the writer's work and sends it back. A static diagram cannot
 * show refusal, and refusal is the clearest proof that this is a real division
 * of labour rather than one prompt with extra steps.
 */
export default function MindMap({
  trace,
  counts,
}: {
  trace: TraceEvent[];
  counts: { evidence: number; nulls: number; accounts: number; sites: number };
}) {
  const [selected, setSelected] = useState<AgentId | null>("terrain_surveyor");

  const byAgent = useMemo(() => {
    const m = new Map<AgentId, TraceEvent[]>();
    for (const e of trace) {
      const arr = m.get(e.agent) ?? [];
      arr.push(e);
      m.set(e.agent, arr);
    }
    return m;
  }, [trace]);

  const active = selected ? AGENTS.find((a) => a.id === selected) : null;
  const activeEvents = selected ? (byAgent.get(selected) ?? []) : [];

  return (
    <div>
      {/* ── Legend ────────────────────────────────────────────────── */}
      <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="t-label">Trust boundary</span>
        {(Object.keys(KIND_LABEL) as AgentNode["kind"][]).map((k) => (
          <span key={k} className={cx("chip", KIND_STYLE[k])}>
            {KIND_LABEL[k]}
          </span>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.45fr_1fr]">
        {/* ── The chart ───────────────────────────────────────────── */}
        <div className="space-y-4">
          {DESKS.map((desk) => {
            const agents = AGENTS.filter((a) => a.desk === desk.id);
            if (agents.length === 0) return null;
            return (
              <div key={desk.id}>
                <div className="mb-2 flex items-baseline gap-2.5">
                  <span
                    className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: desk.accent }}
                  />
                  <div>
                    <p className="text-[0.9rem] font-[600]">{desk.label}</p>
                    <p className="t-micro">{desk.purpose}</p>
                  </div>
                </div>

                <div
                  className="grid gap-2 border-l-2 pl-4 sm:grid-cols-2"
                  style={{ borderColor: `color-mix(in oklab, ${desk.accent} 26%, transparent)` }}
                >
                  {agents.map((a) => {
                    const events = byAgent.get(a.id) ?? [];
                    const ran = events.length > 0;
                    const isSelected = selected === a.id;
                    const isRedTeam = a.id === "red_team";
                    return (
                      <button
                        key={a.id}
                        onClick={() => setSelected(a.id)}
                        className={cx(
                          "group relative rounded-[11px] p-3 text-left transition-all duration-200",
                          isSelected
                            ? "bg-[var(--color-panel)] shadow-[var(--shadow-lift)]"
                            : "bg-[var(--color-panel)] shadow-[var(--shadow-hair)] hover:shadow-[var(--shadow-panel)]",
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-[0.86rem] font-[560] leading-[1.25]">{a.title}</span>
                          {ran ? (
                            <span
                              className="mt-0.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-verified)]"
                              title={`${events.length} trace events in the recorded run`}
                            />
                          ) : (
                            <span
                              className="mt-0.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-hair-2)]"
                              title="Did not emit trace events in this run"
                            />
                          )}
                        </div>
                        <p className="t-micro mt-1 line-clamp-2">{a.produces}</p>
                        <div className="mt-1.5 flex items-center gap-1">
                          <span className={cx("chip", KIND_STYLE[a.kind])}>
                            {a.kind === "deterministic"
                              ? "computed"
                              : a.kind === "model"
                                ? "model"
                                : a.kind === "fetch"
                                  ? "fetched"
                                  : "plans"}
                          </span>
                          {ran && <span className="t-micro tnum">{events.length} steps</span>}
                        </div>

                        {/* The backwards edge: the critic returns work. */}
                        {isRedTeam && (
                          <span className="t-micro absolute -top-2 right-2 rounded-[5px] bg-[var(--color-inferred-wash)] px-1.5 py-0.5 text-[0.6rem] font-medium text-[var(--color-inferred)] ring-1 ring-inset ring-[rgba(154,98,18,0.2)]">
                            ↩ rejects &amp; returns to Copywriter
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Detail ──────────────────────────────────────────────── */}
        <div className="lg:sticky lg:top-20 lg:self-start">
          {active ? (
            <div className="panel p-5">
              <p className="t-label">{DESKS.find((d) => d.id === active.desk)?.label}</p>
              <h3 className="t-h2 mt-1.5">{active.title}</h3>

              <p className="t-body mt-3">{active.plainJob}</p>

              <div className="mt-4 border-t border-[var(--color-hair)] pt-3">
                <p className="t-label">Hands on</p>
                <p className="mt-1 text-[0.86rem]">{active.produces}</p>
              </div>

              <div className="mt-3">
                <p className="t-label">Works with</p>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {active.tools.map((t) => (
                    <span key={t} className="chip chip-null">
                      {t}
                    </span>
                  ))}
                </div>
              </div>

              <div className="mt-3">
                <p className="t-label">Depends on</p>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {active.dependsOn.length === 0 ? (
                    <span className="t-micro">nothing — this is the entry point</span>
                  ) : (
                    active.dependsOn.map((d) => {
                      const dep = AGENTS.find((x) => x.id === d);
                      return (
                        <button
                          key={d}
                          onClick={() => setSelected(d)}
                          className="chip chip-accent hover:underline"
                        >
                          {dep?.title ?? d}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="mt-3 rounded-[9px] bg-[var(--color-panel-sunk)] p-2.5">
                <p className="t-label">Trust</p>
                <p className="t-micro mt-1">{KIND_LABEL[active.kind]}</p>
                {active.kind === "deterministic" && (
                  <p className="t-micro mt-1.5">
                    Because this is arithmetic rather than generation, its output is reproducible and can be
                    re-checked by hand.
                  </p>
                )}
                {active.kind === "model" && (
                  <p className="t-micro mt-1.5">
                    A model writes here, but only over facts that already carry a source. It is not permitted
                    to introduce a claim of its own.
                  </p>
                )}
              </div>

              {/* Real trace from the recorded run. */}
              <div className="mt-4 border-t border-[var(--color-hair)] pt-3">
                <div className="flex items-baseline justify-between">
                  <p className="t-label">What it actually did</p>
                  <span className="t-micro tnum">{activeEvents.length} events</span>
                </div>
                {activeEvents.length === 0 ? (
                  <p className="t-micro mt-2">
                    This desk did not emit events in the recorded run. Its logic is present and exercised when
                    the stage it depends on produces work for it.
                  </p>
                ) : (
                  <div className="slim-scroll mt-2 max-h-72 space-y-1.5 overflow-y-auto pr-1">
                    {activeEvents.slice(0, 40).map((e) => (
                      <div key={e.seq} className="text-[0.78rem] leading-[1.45]">
                        <span className="t-micro font-[family-name:var(--font-mono)] tnum opacity-60">
                          {e.at.slice(11, 19)}
                        </span>{" "}
                        <span
                          className={cx(
                            e.phase === "error"
                              ? "text-[var(--color-conflict)]"
                              : e.phase === "tool"
                                ? "text-[var(--color-accent)]"
                                : "text-[var(--color-ink-2)]",
                          )}
                        >
                          {e.message}
                        </span>
                        {e.url && (
                          <a
                            href={e.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="t-micro ml-1 break-all underline opacity-60 hover:opacity-100"
                          >
                            {shortUrl(e.url)}
                          </a>
                        )}
                        {e.latencyMs !== undefined && (
                          <span className="t-micro ml-1 tnum opacity-55">{e.latencyMs}ms</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : null}

          <div className="panel-sunk mt-4 p-4">
            <p className="t-label">What this run produced</p>
            <div className="mt-2 grid grid-cols-2 gap-3">
              <Num k="accounts" v={counts.accounts} />
              <Num k="sites measured" v={counts.sites} />
              <Num k="evidence rows" v={counts.evidence} />
              <Num k="gaps recorded" v={counts.nulls} />
            </div>
            <p className="t-micro mt-3">
              Every number here is the count of real artefacts in the recorded run, not a target.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Num({ k, v }: { k: string; v: number }) {
  return (
    <div>
      <p className="tnum text-[1.25rem] font-[560] leading-none">{v}</p>
      <p className="t-micro mt-1">{k}</p>
    </div>
  );
}

function shortUrl(u: string): string {
  try {
    const url = new URL(u);
    const p = url.pathname.length > 26 ? `${url.pathname.slice(0, 25)}…` : url.pathname;
    return `${url.hostname}${p}`;
  } catch {
    return u.slice(0, 40);
  }
}
