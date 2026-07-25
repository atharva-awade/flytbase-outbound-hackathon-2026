import Discover from "@/components/Discover";
import { Footer, Nav, SectionHead } from "@/components/ui";
import { GEOCODER_ATTRIBUTION } from "@/lib/sources/geocode";
import { TERRAIN_ATTRIBUTION } from "@/lib/geo";
import { VERTICAL_PACKS } from "@/lib/verticals";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Aerion · discover any ground, anywhere",
  description:
    "Name a place and a vertical. Aerion resolves it, measures every mapped feature inside it, reads the operators off the tags and puts a money case on each one, live.",
};

/**
 * The page that answers the only question a frozen demonstration cannot.
 *
 * Everything else here shows what the pipeline produced for one campaign brief.
 * A reviewer has no way to tell that from a spreadsheet somebody filled in the
 * night before. This takes a place nobody chose in advance and runs the
 * measurement in front of them.
 */
export default function DiscoverPage() {
  const packs = VERTICAL_PACKS.map((p) => ({
    id: p.id,
    label: p.label,
    coverageNote: p.coverageNote,
  }));

  // Chosen because each one demonstrates something different, including failure.
  const examples = [
    {
      place: "Antofagasta",
      vertical: "mining",
      why: "The densest mining district on earth. Returns SQM, Albemarle, Escondida and Codelco with operator tags on almost everything.",
    },
    {
      place: "Atacama",
      vertical: "solar",
      why: "The richest operator tag coverage of any region tested, at 88 per cent.",
    },
    {
      place: "Rajasthan",
      vertical: "solar",
      why: "Thousands of mapped arrays and almost no operator tags. Shows what sparse tagging looks like instead of hiding it.",
    },
    {
      place: "Rotterdam",
      vertical: "ports",
      why: "Europe's largest port. Terminal operators are tagged at the terminal, not the port.",
    },
    {
      place: "Pilbara",
      vertical: "mining",
      why: "Australian iron ore, a different continent and a different tagging culture from Chile.",
    },
    {
      place: "Permian Basin",
      vertical: "oil_gas",
      why: "Fourteen thousand industrial polygons and four operator tags. The hardest attribution case found.",
    },
  ];

  return (
    <>
      <Nav current="/discover" />
      <main className="wash grain mx-auto max-w-[1340px] px-6 pt-10">
        <div className="max-w-3xl">
          <p className="t-label">Live discovery</p>
          <h1 className="t-h1 mt-2">Pick ground nobody chose in advance.</h1>
          <p className="t-body mt-4">
            Every other page here shows what this pipeline produced for one campaign brief. You cannot tell that from
            a spreadsheet filled in the night before, so this page does the measuring in front of you. Name a place
            and a vertical. Aerion resolves the place against OpenStreetMap, queries every feature inside it that
            matches the vertical, computes each footprint geodesically from the returned boundary, reads the operator
            off the tags, and puts a costed programme against each operator it can name.
          </p>
          <p className="t-small mt-3">
            Two things it will not do. It will not name a company that no feature is tagged to, and it will not find
            something in a region that has nothing mapped. Both outcomes appear below when they happen, because a
            discovery tool that always finds something is not measuring anything.
          </p>
        </div>

        <div className="mt-8">
          <Discover packs={packs} maptilerKey={process.env.MAPTILER_KEY} examples={examples} />
        </div>

        <section className="mt-14">
          <SectionHead
            label="Why this is the harder claim"
            title="A measured region cannot be prepared beforehand"
            note="The account list on the console came out of this same query, run over nine regions. Nothing on this page is cached against a fixture, and the only reason a repeat search is fast is that the answer from the public endpoint is cached for a day, which is what its usage policy asks for."
          />
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <Note
              title="The place is resolved, not assumed"
              body="Nominatim returns the boundary of whatever you typed. A country wider than about 330 km is cropped around its own centre, and the interface says so, because the public Overpass endpoint answers a continental query with a timeout rather than an answer."
            />
            <Note
              title="Area is computed, never read"
              body="Each footprint is the spherical excess of the returned ring, and the perimeter is the sum of its haversine edges. No description, article or model output contributes a single figure."
            />
            <Note
              title="Operators come from the tag, not from inference"
              body="Grouping here uses the exact operator tag. The wider attribution ladder, which also matches site names and adjacency, is reserved for accounts already under research, where a neighbour can be reasoned about rather than guessed at."
            />
          </div>
        </section>
      </main>
      <Footer attribution={`${TERRAIN_ATTRIBUTION} ${GEOCODER_ATTRIBUTION}`} />
    </>
  );
}

function Note({ title, body }: { title: string; body: string }) {
  return (
    <div className="panel p-4">
      <p className="text-[0.92rem] font-[600]">{title}</p>
      <p className="t-small mt-1.5">{body}</p>
    </div>
  );
}
