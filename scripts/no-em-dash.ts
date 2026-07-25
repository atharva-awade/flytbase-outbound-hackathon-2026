/**
 * Build guard: no em dashes in anything we wrote.
 *
 * The character is the clearest signature of generated prose there is, so it is
 * banned from source, copy and any text this system produces itself. Runs before
 * the build, and fails it.
 *
 * Two deliberate exemptions, both about honesty rather than convenience:
 *
 *  - The `verbatim` field of an evidence row holds a quotation from a source
 *    document. An SEC filing writes what it writes. Editing a quote to suit our
 *    house style would make the citation not match the page it points at, which
 *    is exactly the failure the evidence ledger exists to prevent. So verbatim
 *    text is skipped, and any em dash inside one is the source's, not ours.
 *  - One regex literal in the critic, which is the detector that enforces this
 *    rule on generated email copy.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";

const EM = "—";
const HORIZONTAL_BAR = "―";

/** Fields that carry someone else's words rather than ours. */
const QUOTED_FIELDS = new Set(["verbatim", "titleVerbatim", "snippet", "quote", "failed_generation"]);

const CODE_EXEMPT = [
  // the detector that implements this policy
  "const emDashes = (body.match(",
];

interface Finding {
  file: string;
  line: number;
  text: string;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry === ".git") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function scanCode(file: string): Finding[] {
  const found: Finding[] = [];
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    if (!line.includes(EM) && !line.includes(HORIZONTAL_BAR)) return;
    if (CODE_EXEMPT.some((x) => line.includes(x))) return;
    found.push({ file, line: i + 1, text: line.trim().slice(0, 120) });
  });
  return found;
}

/** Walk parsed JSON so a quoted field can be exempted by name, not by guessing. */
function scanJson(file: string): Finding[] {
  const found: Finding[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return found;
  }
  const visit = (node: unknown, path: string, quoted: boolean) => {
    if (typeof node === "string") {
      if (!quoted && (node.includes(EM) || node.includes(HORIZONTAL_BAR))) {
        found.push({ file, line: 0, text: `${path}: ${node.slice(0, 110)}` });
      }
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((v, i) => visit(v, `${path}[${i}]`, quoted));
      return;
    }
    if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node)) {
        visit(v, path ? `${path}.${k}` : k, quoted || QUOTED_FIELDS.has(k));
      }
    }
  };
  visit(parsed, "", false);
  return found;
}

const roots = ["src", "scripts", "data"];
const findings: Finding[] = [];

const SELF = "no-em-dash";

for (const root of roots) {
  for (const file of walk(root)) {
    // This file has to name the character in order to look for it.
    if (file.includes(SELF)) continue;
    const ext = extname(file);
    if (ext === ".json") findings.push(...scanJson(file));
    else if ([".ts", ".tsx", ".css", ".js", ".mjs"].includes(ext)) findings.push(...scanCode(file));
  }
}
for (const file of ["README.md"]) {
  try {
    findings.push(...scanCode(file));
  } catch {
    /* absent is fine */
  }
}

if (findings.length === 0) {
  console.log("no em dashes outside quoted source text");
  process.exit(0);
}

console.error(`\n${findings.length} em dash(es) found in text we wrote:\n`);
for (const f of findings.slice(0, 40)) {
  console.error(`  ${f.file}${f.line ? `:${f.line}` : ""}  ${f.text}`);
}
if (findings.length > 40) console.error(`  ... and ${findings.length - 40} more`);
console.error(
  "\nUse a comma, a colon or a full stop. Quotations from source documents are exempt" +
    " and are matched by field name, so a real quote never has to be edited.\n",
);
process.exit(1);
