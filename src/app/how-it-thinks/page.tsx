import MindMapClient from "@/components/MindMapClient";
import { Footer, Nav, Panel, SectionHead } from "@/components/ui";
import { fmtDateTime, loadMeta, loadRun } from "@/lib/run";
import { AGENTS } from "@/lib/agents";

export const dynamic = "force-dynamic";

export default async function HowItThinksPage() {
  const run = await loadRun();
  const meta = await loadMeta();

  const deterministic = AGENTS.filter((a) => a.kind === "deterministic").length;
  const modelBacked = AGENTS.filter((a) => a.kind === "model").length;

  return (
    <>
      <Nav current="/how-it-thinks" />
      <main className="wash grain mx-auto max-w-[1340px] px-6 pt-12">
        <div className="max-w-3xl">
          <p className="t-label">Thought process</p>
          <h1 className="t-h1 mt-2.5">I did not build one AI that does everything.</h1>
          <p className="t-body mt-5">
            I hired a desk. {AGENTS.length} specialists, each with one job, arranged the way an outbound team
            actually works: research establishes what is true, qualification decides who is worth a day,
            contact works out who to call, outreach writes it, and handoff packages it for an account
            executive.
          </p>
          <p className="t-body mt-4">
            The organising principle is a trust boundary. {deterministic} of these are ordinary code
            measuring, counting, scoring, so their output is reproducible and can be re-checked by hand.
            Only {modelBacked} are allowed to write, and they may only write over facts that already carry a
            source. That is why a number in this system can be argued with, and a sentence in an email can be
            traced to the document it came from.
          </p>
        </div>

        {/* ── The flow in one line ─────────────────────────────────── */}
        <div className="x-scroll slim-scroll mt-10">
          <div className="flex min-w-[52rem] items-center gap-2">
            {[
              { l: "Brief", s: "the assignment, unchanged" },
              { l: "Measure the ground", s: "operators read off the map" },
              { l: "Read the filings", s: "their own words about contractors" },
              { l: "Score it", s: "published weights, no model" },
              { l: "Find the people", s: "named, or honestly nameless" },
              { l: "Write it", s: "in their language" },
              { l: "Reject it", s: "critic sends it back" },
              { l: "Hand it over", s: "an AE can act" },
            ].map((step, i, arr) => (
              <div key={step.l} className="flex flex-1 items-center gap-2">
                <div className="min-w-0 flex-1 rounded-[10px] bg-[var(--color-panel)] px-3 py-2.5 shadow-[var(--shadow-hair)]">
                  <p className="t-micro font-[family-name:var(--font-mono)] opacity-55 [overflow-wrap:anywhere]">
                    {String(i + 1).padStart(2, "0")}
                  </p>
                  <p className="mt-0.5 text-[0.82rem] font-[560] leading-tight">{step.l}</p>
                  <p className="t-micro mt-0.5 leading-tight">{step.s}</p>
                </div>
                {i < arr.length - 1 && (
                  <span className="shrink-0 text-[var(--color-hair-2)]" aria-hidden>
                    →
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* ── The org chart ────────────────────────────────────────── */}
        <section className="mt-14">
          <SectionHead
            label="The desk"
            title="Click any specialist to see its job and what it actually did"
            note="A green dot means that specialist emitted steps in the recorded run. The panel on the right shows the real trace: which sources it opened, in what order, and how long each took."
            aside={
              run ? (
                <p className="t-micro">
                  run <span className="font-[family-name:var(--font-mono)]">{run.id}</span> ·{" "}
                  {fmtDateTime(run.startedAt)}
                </p>
              ) : undefined
            }
          />

          <MindMapClient
            trace={run?.trace ?? []}
            counts={{
              evidence: run?.stats.evidenceRows ?? 0,
              nulls: run?.nullResults.length ?? 0,
              accounts: run?.accounts.length ?? 0,
              sites: run?.stats.sitesMeasured ?? 0,
            }}
          />
        </section>

        {/* ── The plan, verbatim ───────────────────────────────────── */}
        {run && run.plan.length > 0 && (
          <section className="mt-14">
            <SectionHead
              label="Delegation, as recorded"
              title="The plan the Chief of Staff wrote before any work started"
              note="Stored with the run rather than reconstructed afterwards, so the division of labour is inspectable rather than asserted."
            />
            <Panel className="p-5">
              <ol className="space-y-3">
                {run.plan.map((p, i) => (
                  <li key={p.agent} className="flex gap-3">
                    <span className="t-micro mt-1 shrink-0 font-[family-name:var(--font-mono)] tnum opacity-55">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <div>
                      <p className="text-[0.88rem] font-[560]">
                        {AGENTS.find((a) => a.id === p.agent)?.title ?? p.agent}
                      </p>
                      <p className="t-small mt-0.5">{p.task}</p>
                      {p.dependsOn.length > 0 && (
                        <p className="t-micro mt-1">
                          waits for{" "}
                          {p.dependsOn
                            .map((d) => AGENTS.find((a) => a.id === d)?.title ?? d)
                            .join(", ")}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            </Panel>
          </section>
        )}

        {/* ── Why this shape ───────────────────────────────────────── */}
        <section className="mt-14">
          <SectionHead label="Design decisions" title="Why it is split this way" />
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            <Decision
              title="Discovery runs on geometry, not memory"
              body="If a model proposes the account list, every downstream fact inherits its uncertainty. Reading operator names off measured polygons means the list is a consequence of the physical world, so an invented account cannot enter the pipeline at all."
            />
            <Decision
              title="Scoring is code, not judgement"
              body="A score decides whether a rep spends a day on an account. That decision has to be arguable, so it is a pure function with visible weights. A model is never asked how good an account is."
            />
            <Decision
              title="The writer cannot introduce facts"
              body="The Copywriter receives a short brief containing only already-sourced facts and writes prose over them. Separating what is true from how it is phrased is what keeps a persuasive email honest."
            />
            <Decision
              title="A critic that can say no"
              body="The Red Team runs mechanical checks and returns work that fails any of them. Rejected drafts are kept and displayed. Without a component that refuses, a pipeline is just a chain of generations."
            />
            <Decision
              title="Absence is an output"
              body="When nobody can be found, the system emits a role target with a documented way to find the person. A nameless record is auditable; a plausible invented name is not, and is the single fastest way to lose trust."
            />
            <Decision
              title="Every desk is replaceable"
              body="Each specialist has one input shape and one output shape, so a better source or model can be swapped in without touching the rest. The vertical packs work the same way, which is how the same graph runs mining, solar, ports or rail."
            />
          </div>
        </section>
      </main>
      <Footer attribution={meta?.attribution} />
    </>
  );
}

function Decision({ title, body }: { title: string; body: string }) {
  return (
    <Panel className="p-4">
      <p className="text-[0.92rem] font-[600] leading-[1.3]">{title}</p>
      <p className="t-small mt-2">{body}</p>
    </Panel>
  );
}
