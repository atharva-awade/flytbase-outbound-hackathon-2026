/**
 * The employer check, pinned down by test.
 *
 * This function decides whether a public profile actually belongs to the company
 * we think it does, and it is the single guard standing between a real contact
 * list and an invented one. It has now been wrong in both directions, so both
 * directions are asserted here.
 *
 * It was once too loose: a person named Vanessa Vale was attributed to Vale S.A.
 * on her surname, and a Codelco manager to Sierra Gorda because that operation
 * appeared somewhere in the snippet.
 *
 * Then it was too strict in a way that was much harder to see. Company names
 * shorter than four characters were discarded before any test ran, so "SQM", the
 * anchor account of the whole campaign, could never match anything. A live
 * discovery found twenty eight genuine profiles and rejected all twenty eight for
 * "company not named as the employer", when the name it was checking for had
 * already been thrown away. That is the third time a length filter in this
 * project has swallowed that particular acronym, which is why it is now a test
 * rather than a comment.
 */

import { employerMatches } from "../src/lib/sources/serp";

interface Case {
  name: string;
  expect: boolean;
  title: string;
  snippet: string;
  companyNames: string[];
  otherCompanies?: string[];
  personName: string;
}

const CASES: Case[] = [
  // ── must match ─────────────────────────────────────────────────────────
  {
    name: "three letter acronym named as employer, Spanish preposition",
    expect: true,
    personName: "Jose Miguel Berguno",
    title: "Jose Miguel Berguno - Gerente de Operaciones - LinkedIn",
    snippet: "Gerente de Operaciones en SQM, Antofagasta, Chile",
    companyNames: ["SQM S.A.", "SQM"],
  },
  {
    name: "three letter acronym named as employer, English preposition",
    expect: true,
    personName: "Ana Rojas",
    title: "Ana Rojas - Superintendente de Seguridad | LinkedIn",
    snippet: "Superintendente de Seguridad at SQM",
    companyNames: ["SQM S.A."],
  },
  {
    name: "full multi word company name present",
    expect: true,
    personName: "Mario Ortiz",
    title: "Mario Ortiz - Gerente de Operaciones - LinkedIn",
    snippet: "Gerente de Operaciones en Teck Quebrada Blanca",
    companyNames: ["Teck Quebrada Blanca"],
  },
  {
    name: "operation referred to by its distinctive part",
    expect: true,
    personName: "Aldo Tosetti",
    title: "Aldo Tosetti - Jefe de Mantencion | LinkedIn",
    snippet: "Jefe de Mantencion, Quebrada Blanca, Region de Tarapaca",
    companyNames: ["Teck Quebrada Blanca"],
  },
  {
    name: "accents in the snippet do not defeat the match",
    expect: true,
    personName: "Ruben Zubicueta",
    title: "Rubén Zubicueta - Gerente de Operaciones | LinkedIn",
    snippet: "Gerente de Operaciones en Minera Escondida Ltda.",
    companyNames: ["Minera Escondida Ltda."],
  },

  // ── must not match ─────────────────────────────────────────────────────
  {
    name: "surname collision alone is not employment",
    expect: false,
    personName: "Vanessa Vale",
    title: "Vanessa Vale - Analista de Recursos Humanos | LinkedIn",
    snippet: "Analista de Recursos Humanos, Belo Horizonte",
    companyNames: ["Vale S.A."],
  },
  {
    name: "a profile naming a different operator belongs to that operator",
    expect: false,
    personName: "Carlos Diaz",
    title: "Carlos Diaz - Gerente de Operaciones | LinkedIn",
    snippet: "Gerente de Operaciones en Sierra Gorda SCM",
    companyNames: ["Codelco Chile"],
    otherCompanies: ["Sierra Gorda SCM"],
  },
  {
    name: "acronym appearing loose in text, with no employer preposition",
    expect: false,
    personName: "Pedro Lagos",
    title: "Pedro Lagos - Consultor independiente | LinkedIn",
    snippet: "Ex proveedor de SQM y otras companias, ahora consultor en Santiago",
    companyNames: ["Codelco Chile"],
  },
  {
    name: "a legal suffix must not be carved out of an unrelated surname",
    expect: false,
    personName: "Maria Casanova",
    title: "Maria Casanova - Ingeniera de Procesos | LinkedIn",
    snippet: "Ingeniera de Procesos, Region Metropolitana",
    companyNames: ["Canova Minerals"],
  },
];

let failed = 0;
for (const c of CASES) {
  const got = employerMatches({
    title: c.title,
    personName: c.personName,
    snippet: c.snippet,
    companyNames: c.companyNames,
    otherCompanies: c.otherCompanies ?? [],
  });
  const ok = got.matched === c.expect;
  if (!ok) failed += 1;
  console.log(
    `${ok ? "pass" : "FAIL"}  ${c.expect ? "match   " : "reject  "} ${c.name}\n        got ${got.matched ? "match" : "reject"}: ${got.reason}`,
  );
}

console.log(`\n${CASES.length - failed}/${CASES.length} passed`);
if (failed > 0) process.exit(1);
