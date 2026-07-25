# Aerion

**Outbound account and contact generation, grounded in measured ground.**

Live: **https://flytbase-outbound-hackathon-2026.vercel.app**

Aerion takes a campaign brief — a target vertical and a reference account — and produces the account list,
the buying committee and the outreach a human outbound rep would produce. What makes it different is what it
stands on. Accounts are not proposed by a language model; they are discovered by measuring real industrial
sites and reading the operator off the geometry. Every figure in the interface links to the document it came
from, and the questions the pipeline could not answer are published rather than hidden.

---

## The problem this is built against

Ask a language model for mining companies in Latin America and you get a list that looks right. Some of it is
right. Nobody — including the rep who sends the email — can tell which parts. Every downstream claim inherits
that uncertainty: the pain point, the number in the subject line, the person's name.

So the organising rule is a **trust boundary**. Measuring, counting and scoring are ordinary code, which makes
them reproducible and checkable by hand. A language model is only allowed to phrase things, and it only ever
sees facts that already carry a source. That is why a number here can be argued with, and a sentence in an
email can be traced.

---

## What it produced on the assigned brief

The brief: large-scale lithium, copper and iron ore mining in Latin America, anchored on SQM, targeting Head
of Operations / VP HSE / Site Director, with the angle of autonomous inspection replacing contracted crews at
hazardous 24/7 extraction sites.

| | |
|---|---|
| Operators observed from mapped geometry | **127** |
| Resolved to corporate identities | **12** accounts |
| Sites measured and individually citable | **157** |
| Mapped footprint, computed geodesically | **964 km²** |
| Evidence rows, each with a source URL and verbatim snippet | **158** |
| Named contacts, none invented | **55** |
| Role targets where no individual could be sourced | **6** |
| Messages that passed the critic, after 4 were rejected | **3** |
| Questions the pipeline could not answer, published | **13** |
| Languages read and written | **en · es-CL · pt-BR** |

Numbers move between runs because the sources are live. These come from the run frozen in
[`data/run-latest.json`](data/run-latest.json), and every page states which run it is showing and when that
run executed.

---

## Six things that cannot be faked

**1 · Accounts are discovered from terrain, not memory.** Every mapped extraction site in the target
geographies is measured and the operator is read off the `operator` tag. A hallucinated account is
structurally impossible: if a company appears, someone mapped its pit and we measured it. Operators that could
not be resolved to a corporate identity are excluded and listed rather than assigned a guessed parent.

**2 · Footprint is measured, not estimated.** Area and perimeter are computed geodesically from each polygon's
coordinates. Rajo Escondida comes out at 9.811 km² and Mina Chuquicamata at 9.744 km², both agreeing with
published pit dimensions. Figures are labelled *mapped footprint* throughout, because a digitised pit outline
is not a lease boundary and calling it one would be wrong.

**3 · The angle comes from the prospect's own words.** A deterministic scan of each company's annual filing
counts and quotes its contractor and hazard language. SQM's own 20-F names contractor safety incidents and
contractor work stoppages as risks to production, refers to contractors thirty times, and mentions drones or
autonomy zero times. That is the pitch, stated by the buyer, quotable verbatim.

**4 · Qualification is arithmetic.** Ten weighted dimensions with published weights, and per-dimension
contributions rendered so they visibly sum to the total. No model opinion enters the score. A dimension with
no evidence contributes zero rather than an estimate, and says so on screen.

**5 · Real names or none at all.** A person appears only if their name and verbatim title were read from a
page we fetched. Where nobody could be found the role is targeted instead, with a documented way to find the
individual. Derived addresses are labelled inferred and excluded from the sendable column of every export,
because a guessed address in a CRM becomes a real send later by someone who never saw the warning.

**6 · The critic rejects work.** A deterministic Red Team scores each draft against seven mechanical gates and
returns it until it passes. Rejected drafts are kept and displayed — simultaneously the proof that a machine
wrote the copy and the proof that something adversarial checked it before a prospect would have seen it.

---

## Architecture

Nineteen specialists across five desks, arranged the way an outbound team is, under an orchestrator that
writes the plan before any work begins. The plan is stored with the run, so the division of labour is
inspectable rather than asserted. **/how-it-thinks** on the live site animates the recorded run and lets each
specialist be opened to see what it actually did.

```
Campaign brief
      │
      ▼
Chief of Staff ── writes the run plan, delegates, merges, resolves conflicts
      │
      ├─ Research desk       Anchor Analyst · Universe Scout · Terrain Surveyor
      │                      Filings Analyst · Signals Desk · Regulatory Analyst
      │
      ├─ Qualification desk  Cross-Verification Officer · ICP Scorer
      │                      Opportunity Engineer
      │
      ├─ Contact desk        Org Cartographer · People Finder · Reachability Analyst
      │
      ├─ Outreach desk       Message Strategist · Copywriter · Red Team · Sequence Architect
      │
      └─ Handoff desk        AE Briefer · Exporter
                │
                ▼
      Evidence ledger  ·  Null-result register
```

**Deterministic, no model involved** — Universe Scout, ICP Scorer, Opportunity Engineer, Red Team critic,
Sequence Architect, Cross-Verification Officer, Message Strategist, Exporter.
**Model, prose only** — Copywriter, AE Briefer.
**Fetches from a named source** — Terrain Surveyor, Filings Analyst, People Finder, Signals Desk, Regulatory
Analyst, Reachability Analyst.

### Opportunity sizing

The piece that turns "here is a company" into "here is the size of the programme":

```
measured area + perimeter        (OpenStreetMap, cited, km²)
  × inspection cadence           (operating band; a regulatory floor only where the instrument was fetched)
  ÷ dock coverage behaviour      (radius and efficiency, stated as assumptions)
  = docks required, missions/month, flight hours, contracted crew-days displaced
```

Every input is a labelled assumption with a stated basis, and outputs are ranges. A single confident number
derived from assumptions is false precision, and false precision is how a good pitch dies under questioning.
Phase one is modelled as one dock on the highest-value cluster, because that is how the published reference
deployment actually began.

---

## Vertical packs

A pack is data, not code: the tag signatures that find the asset in the physical world, the local job titles
that find the people, the regulatory instruments that force the inspection, and the weights that matter for
that industry. The same agent graph runs any of them.

To prove that rather than claim it, a second pack was executed end to end. **/generality** shows both runs
side by side with a table of exactly what differed — all of it pack data.

| Pack | Status | Anchor |
|---|---|---|
| Mining & extraction | **run** — the assigned brief | SQM |
| Solar generation | **run** — 322 operators observed, 2,182 features measured | Atacama Generación |
| Oil & gas · Ports · Rail · Electric transmission | defined, signatures probed against live data | Shell · Hutchison · CSX · Statnett |

Packs that have not been executed are listed as *defined*, because a pack that has not run is a claim rather
than a result.

---

## Data sources

Public, and most of it needs no credentials at all.

| Source | Used for | Auth |
|---|---|---|
| OpenStreetMap Overpass | Site geometry, operator attribution, measured area | none |
| SEC EDGAR (full-text + submissions) | Primary filings, risk-factor mining | descriptive User-Agent |
| Chile Ley 20.285 transparency disclosures | Named officers, appointment dates, interim status | none |
| Company leadership pages | Named executives | none |
| Public professional profiles via search | The operations and HSE tier company pages omit | search API key |
| Live DNS (MX records) | Mail infrastructure, as evidence of stack | none |
| Satellite imagery | Verifying the polygons visually | none, or MapTiler when keyed |

Measured footprints come from OpenStreetMap, © OpenStreetMap contributors, under the Open Database Licence.

---

## Running it

```bash
pnpm install
pnpm harvest          # executes the assigned brief against live sources
pnpm harvest solar    # executes a different vertical pack through the same graph
pnpm dev
```

Terrain, primary filings and statutory officer discovery need **no API keys**. Model keys add the outreach
copy; without them the message strategy is still produced (it is deterministic) and the absence of copy is
recorded rather than filled in by hand.

| Variable | Needed for | Without it |
|---|---|---|
| `GROQ_API_KEY` | Outreach copy | Strategy still produced, no email written |
| `NVIDIA_API_KEY` | Failover | Groq used alone |
| `SERPER_API_KEY` | Public-profile discovery | Statutory and company sources only |
| `MAPTILER_KEY` | Sharper satellite tiles | Esri World Imagery, no key needed |
| `GMAIL_USER`, `GMAIL_APP_PASSWORD` | Consent-first send | Exports work; send reports it is unconfigured |

---

## What went wrong, and what it cost

Kept because these failures shaped the design more than the successes did.

**Footprints were overstated by nearly two to one.** Region bounding boxes overlap deliberately so no operator
falls between them, but features inside an overlap were counted once per query. SQM read 1,025 km² against an
actual 548 km². Fixed by deduplicating on OSM id and recomputing operator totals from the deduplicated set.

**A truncated response poisoned the cache and dropped the anchor account.** Overpass answered HTTP 200 with a
partial element set, that got cached, and every later run reused it — SQM vanished from its own campaign. The
cache now refuses to serve an empty geometry result and re-fetches instead.

**A quarry-only query cannot find SQM at all.** The anchor is tagged `landuse=industrial` with
`industrial=solution_mine`, not `landuse=quarry`. Found while investigating why the reference account had no
sites. The mining pack now unions quarry with resource-tagged industrial features.

**Compound tag filters were silently discarding sites.** Two bracket groups in one filter string matched none
of the classifier's anchored patterns, so brine ponds and tailings basins were fetched and then dropped. The
query was correct; only classification failed, which is the hardest kind of bug to notice.

**Public-profile search attributed real people to the wrong employer.** A person surnamed Vale was matched to
Vale S.A.; a Codelco operations manager was attributed to Sierra Gorda. Both are worse than returning no name.
Single-token company names must now appear after an employer preposition, any profile naming a different
operator in the run is discarded, and a leadership rank is required rather than a domain keyword. The rules
are unit-tested against those exact cases.

**The writer fabricated numbers by restating facts it was given.** Handed "refers to contractors 30
times", it wrote "27 safety incidents cited". Handed a total system investment of USD 70–80k, it wrote
"saving over 70k". It also misspelled a company name in the body. All three passed the original gates, because
those checked that facts were *cited*, not that the paraphrase was *faithful* — the most dangerous gap in the
whole system, since every claim looked sourced. Fixed three ways: mention counts are now withheld from the
writer entirely (a frequency is a scoring signal, not a claim), reference-customer outcomes are supplied as a
fixed set of quotable phrasings that may not be restated, and two gates were added — every numeral in a draft
must trace to a supplied fact, and the account name must be spelled correctly. Acceptance dropped from six
messages to three, which is the correct trade.

**Server-side search returns 413 on this tier.** `groq/compound` rejects any request in which it actually
searches — it reads as a malformed query but is a plan limit. Supplementary search moved to a direct provider;
the core pipeline never depended on it.

**Every free email sandbox refuses arbitrary recipients.** Resend, Mailgun and MailerSend all restrict
delivery to the account owner, so none can mail a reviewer. Sending is therefore consent-first: the recipient
is whatever address the operator types on the page.

**Globe markers landed in arcs off the edge of the sphere.** Reproducing a renderer's own projection by hand
is a losing game. The overlay now reads the position the renderer already publishes for each marker.

---

## Honesty constraints, enforced in code

- A fact cannot render without an evidence row carrying a source URL and a verbatim snippet.
- A contact without a source URL renders as a nameless role target, never as a name.
- An inferred email address is excluded from every sendable column.
- A regulatory instrument is withheld from generated copy until its text has been fetched — a wrong decree
  number is worse than none.
- Proximity-inferred geometry is reported separately from operator-attributed geometry, and drawn dashed.
- Sizing outputs are ranges, and every assumption behind them is listed with its basis.
- Runs state their execution time. Replay means re-serving a recorded real run, never synthesising one.
- **/api/run** re-executes the pipeline for one account live and streams every step, so the recorded figures
  can be checked against a fresh run on demand.

---

## Repository

```
src/lib/          geo · icp · sizing · critic · outreach · briefing · llm · agents · verticals
src/lib/sources/  sec · people · serp
scripts/harvest   the pipeline; writes a frozen run artifact to ./data
src/app/          landing · console · account brief · how-it-thinks · generality · evidence
src/app/api/      run (live SSE) · export (CRM CSV and JSON) · send (consent-first)
data/             frozen run artifacts — real outputs, original timestamps preserved
```
