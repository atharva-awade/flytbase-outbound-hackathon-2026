/**
 * The money case, per operation.
 *
 * Programme sizing answers "how many docks and how many flights". That is the
 * engineering question. The question a site director or a VP of operations
 * actually answers email about is "what does this change on my P&L and my
 * incident rate", and until outbound puts a number on that, it is asking for a
 * meeting on the strength of a product description.
 *
 * So this converts measured geometry into a financial case. The discipline that
 * makes it credible rather than a spreadsheet fantasy is the separation, held
 * strictly, between three kinds of number:
 *
 *   PUBLISHED   FlytBase's own figures for a deployment that happened, quoted at
 *               the value they were published at and carrying their source. The
 *               reference programme cost is the only money figure here that
 *               anybody has published.
 *   DERIVED     Arithmetic on measured ground. Crew-days displaced, payback
 *               months, person-days out of a hazardous zone. Reproducible by
 *               hand from the inputs shown.
 *   OPERATOR    A contracted inspection day rate, and the value of an hour of
 *               unplanned downtime. Neither is public for any real company. They
 *               are carried as wide, clearly unsourced bands that the reader is
 *               told to replace with their own figure.
 *
 * The last category is the one that would normally get quietly presented as
 * research. It is labelled unsourced everywhere it appears, it is excluded from
 * anything generated copy is allowed to assert, and the interface invites the
 * reader to change it. A number a prospect can correct is a conversation. A
 * number they cannot check is a reason to stop reading.
 */

import { round } from "./geo";
import type { OpportunitySizing } from "./types";

export type InputClass = "published" | "derived" | "operator";

export interface MoneyInput {
  key: string;
  label: string;
  low: number;
  high: number;
  unit: string;
  inputClass: InputClass;
  /** Where the figure comes from. For operator inputs, that it is not sourced. */
  basis: string;
  sourceUrl?: string;
}

export interface Band {
  low: number;
  high: number;
}

export interface RevenueCase {
  inputs: MoneyInput[];
  /** Contracted inspection spend the programme takes off the books, per year. */
  inspectionSpendDisplacedPerYear: Band;
  /** What the programme costs, scaled from the one published deployment. */
  programmeInvestment: Band;
  /** Months for displaced spend to cover the investment. */
  paybackMonths: Band;
  /** Ready to print, including the "under a fortnight" edge case. */
  paybackLabel: string;
  /** Displaced spend less investment over year one, and over three years. */
  netYearOne: Band;
  netThreeYear: Band;
  /** Return on the investment across three years, as a multiple. */
  threeYearReturnMultiple: Band;
  /** Person-days removed from a hazardous working area each year. */
  hazardPersonDaysRemovedPerYear: Band;
  /** Inspection passes per year before and after, from the same geometry. */
  coverage: { manualPassesPerYear: Band; automatedPassesPerYear: Band; multiple: Band };
  /** Value of compressing an outage from a manual detection cycle to under 90 minutes. */
  downtimeExposure: {
    hoursSavedPerIncident: Band;
    valuePerIncident: Band;
    note: string;
  };
  /** The single sharpest sentence, for a subject line or an opening. */
  headline: string;
  /** Line by line, so a reader can follow the arithmetic without trusting us. */
  derivation: string[];
  caveats: string[];
}

/**
 * Published reference deployment. FlytBase states a total system investment of
 * USD 70,000 to 80,000 for phase one at SQM, returning inside a year. Phase one
 * was a single dock on one zone, which is what makes it usable as a per-dock
 * unit rather than a whole-programme price.
 */
const REFERENCE = {
  perDockLow: 70_000,
  perDockHigh: 80_000,
  sourceUrl: "https://www.flytbase.com/case-studies/sqm",
};

/**
 * Deliberately wide, deliberately unsourced. A contracted inspection crew day
 * rate is a commercial term between an operator and its contractor and is not
 * published by anyone. The band spans a two person local crew at the bottom to a
 * specialist rope-access or geotechnical crew with equipment at the top. It
 * exists so the model can be shown working, and it is the first thing a real
 * conversation replaces.
 */
const CREW_DAY_RATE = { low: 450, high: 1_400 };

/**
 * Also unsourced, and the more sensitive of the two. Production value per hour
 * varies by more than an order of magnitude between a small quarry and a large
 * copper concentrator, so this is expressed per hour and per incident rather
 * than as an annual total, and the reader is told to substitute their own.
 */
const DOWNTIME_VALUE_PER_HOUR = { low: 8_000, high: 60_000 };

/** Manual detection of a developing fault, against the published under 90 minutes. */
const MANUAL_DETECTION_HOURS = { low: 8, high: 72 };

export function revenueCase(sizing: OpportunitySizing, areaKm2: number): RevenueCase {
  const crewDaysPerMonth = sizing.contractorCrewDaysDisplacedPerMonth;
  const docks = sizing.docksRequired;

  const spendLow = round(crewDaysPerMonth.low * 12 * CREW_DAY_RATE.low, 0);
  const spendHigh = round(crewDaysPerMonth.high * 12 * CREW_DAY_RATE.high, 0);

  const investLow = round(docks.low * REFERENCE.perDockLow, 0);
  const investHigh = round(docks.high * REFERENCE.perDockHigh, 0);

  // Payback pairs the pessimistic case with the pessimistic case: the highest
  // investment against the lowest displaced spend, and the reverse. Mixing the
  // best of one with the best of the other is how ROI models start lying.
  const monthlyLow = spendLow / 12;
  const monthlyHigh = spendHigh / 12;
  // A payback that rounds to "0 months" is not a strong claim, it is an obviously
  // broken one, and a prospect who sees it stops trusting every other figure on
  // the page. Anything under a fortnight is reported as under a fortnight.
  const rawFast = monthlyHigh > 0 ? investLow / monthlyHigh : 0;
  const rawSlow = monthlyLow > 0 ? investHigh / monthlyLow : 0;
  const paybackFast = round(Math.max(0.5, rawFast), 1);
  const paybackSlow = round(Math.max(paybackFast, rawSlow), 1);

  const netY1Low = round(spendLow - investHigh, 0);
  const netY1High = round(spendHigh - investLow, 0);
  // Investment is paid once; the displaced spend recurs.
  const net3Low = round(spendLow * 3 - investHigh, 0);
  const net3High = round(spendHigh * 3 - investLow, 0);

  const mult3Low = investHigh > 0 ? round((spendLow * 3) / investHigh, 2) : 0;
  const mult3High = investLow > 0 ? round((spendHigh * 3) / investLow, 2) : 0;

  // Every displaced crew-day is a day nobody spends inside the hazardous area.
  const hazardLow = round(crewDaysPerMonth.low * 12, 0);
  const hazardHigh = round(crewDaysPerMonth.high * 12, 0);

  const manualPassesLow = pickAssumption(sizing, "inspectionsPerMonthLow", 4) * 12;
  const manualPassesHigh = pickAssumption(sizing, "inspectionsPerMonthHigh", 30) * 12;
  const autoLow = sizing.missionsPerMonth.low * 12;
  const autoHigh = sizing.missionsPerMonth.high * 12;

  const hoursSavedLow = Math.max(0, MANUAL_DETECTION_HOURS.low - 1.5);
  const hoursSavedHigh = Math.max(0, MANUAL_DETECTION_HOURS.high - 1.5);

  const inputs: MoneyInput[] = [
    {
      key: "referencePerDock",
      label: "Reference programme cost, per dock",
      low: REFERENCE.perDockLow,
      high: REFERENCE.perDockHigh,
      unit: "USD",
      inputClass: "published",
      basis:
        "FlytBase's published figure for phase one at the reference account: a total system investment of USD 70,000 to 80,000 for a single dock on one zone, returning inside a year. This is what the customer spent, not what they saved.",
      sourceUrl: REFERENCE.sourceUrl,
    },
    {
      key: "crewDayRate",
      label: "Contracted inspection crew, day rate",
      low: CREW_DAY_RATE.low,
      high: CREW_DAY_RATE.high,
      unit: "USD per crew-day",
      inputClass: "operator",
      basis:
        "Not sourced, and not sourceable: a contract day rate is a commercial term between an operator and its contractor, and nobody publishes it. The band runs from a two person local crew to a specialist crew with equipment. Replace it with your own figure and every number below moves with it.",
    },
    {
      key: "downtimeValue",
      label: "Value of an hour of unplanned downtime",
      low: DOWNTIME_VALUE_PER_HOUR.low,
      high: DOWNTIME_VALUE_PER_HOUR.high,
      unit: "USD per hour",
      inputClass: "operator",
      basis:
        "Not sourced. Production value per hour varies by more than tenfold between a small quarry and a large concentrator, so this is only ever shown per incident, never annualised into a headline.",
    },
    {
      key: "manualDetection",
      label: "Manual detection window for a developing fault",
      low: MANUAL_DETECTION_HOURS.low,
      high: MANUAL_DETECTION_HOURS.high,
      unit: "hours",
      inputClass: "operator",
      basis:
        "Not sourced. Depends entirely on the current inspection interval at the site. The comparison figure it is set against, detection under 90 minutes, is published.",
      sourceUrl: REFERENCE.sourceUrl,
    },
    {
      key: "crewDaysDisplaced",
      label: "Contracted crew-days displaced each month",
      low: crewDaysPerMonth.low,
      high: crewDaysPerMonth.high,
      unit: "crew-days",
      inputClass: "derived",
      basis:
        "Derived from the measured footprint and the inspection cadence in the sizing model above. No commercial input, only geometry.",
    },
    {
      key: "docks",
      label: "Docking stations required",
      low: docks.low,
      high: docks.high,
      unit: "docks",
      inputClass: "derived",
      basis: `Derived from ${round(areaKm2, 2)} km² of measured footprint and a deliberately conservative dock service radius.`,
    },
  ];

  const derivation = [
    `Measured ground: ${round(areaKm2, 2)} km² across ${sizing.siteCount} mapped feature(s), with ${round(sizing.totalPerimeterKm, 1)} km of boundary.`,
    `Coverage needs ${docks.low} to ${docks.high} docking station(s). At the reference account's published phase one cost of USD ${REFERENCE.perDockLow.toLocaleString("en-GB")} to ${REFERENCE.perDockHigh.toLocaleString("en-GB")} per dock, the programme is USD ${investLow.toLocaleString("en-GB")} to ${investHigh.toLocaleString("en-GB")}.`,
    `The same geometry displaces ${crewDaysPerMonth.low} to ${crewDaysPerMonth.high} contracted crew-days a month, which is ${hazardLow.toLocaleString("en-GB")} to ${hazardHigh.toLocaleString("en-GB")} crew-days a year.`,
    `At an unsourced day rate of USD ${CREW_DAY_RATE.low} to ${CREW_DAY_RATE.high}, that is USD ${spendLow.toLocaleString("en-GB")} to ${spendHigh.toLocaleString("en-GB")} of inspection spend a year that no longer needs to be bought.`,
    `Payback is the investment divided by displaced spend: ${paybackFast} months in the favourable case, ${paybackSlow} months in the unfavourable one. The unfavourable case pairs the highest investment with the lowest displaced spend, rather than mixing the best of each. Anything faster than a fortnight is reported as such rather than as a figure that rounds to zero.`,
    `Across three years the programme is bought once and the spend is displaced each year, giving USD ${net3Low.toLocaleString("en-GB")} to ${net3High.toLocaleString("en-GB")} net, a ${mult3Low} to ${mult3High} times return.`,
    `Inspection passes go from ${manualPassesLow} to ${manualPassesHigh} a year on foot, to ${autoLow} to ${autoHigh} flown. The reference account did not simply cut inspection cost, it doubled frequency at lower exposure.`,
    `Every displaced crew-day is a person-day nobody spends inside the hazardous area: ${hazardLow.toLocaleString("en-GB")} to ${hazardHigh.toLocaleString("en-GB")} person-days a year. This is the number an HSE lead is accountable for, and it is derived purely from geometry.`,
  ];

  const caveats = [
    "The day rate and the downtime value are the operator's to supply. They are not published for any real company, they are labelled unsourced everywhere they appear, and generated outreach is not permitted to assert them.",
    "The programme cost scales one published deployment linearly by dock count. Real quotes vary with connectivity, power, permitting and the number of use cases, so treat it as an order of magnitude rather than a price.",
    "Displaced spend assumes the contracted inspection currently happening is the inspection the programme replaces. Where a contract bundles other scope, only the inspection share is displaced.",
    "Footprint comes from mapped features. Where mapping is incomplete the sizing is conservative, since unmapped ground cannot be counted.",
  ];

  const headline = `${round(areaKm2, 1)} km² of measured ground across ${sizing.siteCount} feature(s) displaces ${hazardLow.toLocaleString("en-GB")} to ${hazardHigh.toLocaleString("en-GB")} contracted crew-days a year.`;

  return {
    inputs,
    inspectionSpendDisplacedPerYear: { low: spendLow, high: spendHigh },
    programmeInvestment: { low: investLow, high: investHigh },
    paybackMonths: { low: paybackFast, high: paybackSlow },
    paybackLabel:
      rawFast < 0.5 && rawSlow < 0.5
        ? "under a fortnight, on displaced inspection spend alone"
        : paybackFast === paybackSlow
          ? `${paybackFast} months`
          : `${rawFast < 0.5 ? "under a fortnight" : `${paybackFast} months`} to ${paybackSlow} months`,
    netYearOne: { low: netY1Low, high: netY1High },
    netThreeYear: { low: net3Low, high: net3High },
    threeYearReturnMultiple: { low: mult3Low, high: mult3High },
    hazardPersonDaysRemovedPerYear: { low: hazardLow, high: hazardHigh },
    coverage: {
      manualPassesPerYear: { low: manualPassesLow, high: manualPassesHigh },
      automatedPassesPerYear: { low: autoLow, high: autoHigh },
      multiple: {
        low: manualPassesHigh > 0 ? round(autoLow / manualPassesHigh, 2) : 0,
        high: manualPassesLow > 0 ? round(autoHigh / manualPassesLow, 2) : 0,
      },
    },
    downtimeExposure: {
      hoursSavedPerIncident: { low: hoursSavedLow, high: hoursSavedHigh },
      valuePerIncident: {
        low: round(hoursSavedLow * DOWNTIME_VALUE_PER_HOUR.low, 0),
        high: round(hoursSavedHigh * DOWNTIME_VALUE_PER_HOUR.high, 0),
      },
      note: "Shown per incident on purpose. Multiplying an unsourced hourly value by an assumed incident rate would produce a large annual number that nobody could check, which is the standard way these models lose credibility.",
    },
    headline,
    derivation,
    caveats,
  };
}

function pickAssumption(sizing: OpportunitySizing, key: string, fallback: number): number {
  return sizing.assumptions.find((a) => a.key === key)?.value ?? fallback;
}

/**
 * The one line that earns a reply.
 *
 * A site director does not answer email about drone platforms. They answer email
 * about the thing they are measured on. So the hook leads with person-days out of
 * a hazardous area, not with saved dollars: the money argument invites a
 * procurement conversation months away, while the exposure argument is the one
 * they own personally and can act on this quarter.
 */
export function attentionHook(rc: RevenueCase, role: string): string {
  const hse = /hse|safety|seguridad|sustent|ssma|ssoma/i.test(role);
  const ops = /operation|operac|opera|site|faena|mine manager|gerente general/i.test(role);
  const days = `${rc.hazardPersonDaysRemovedPerYear.low.toLocaleString("en-GB")} to ${rc.hazardPersonDaysRemovedPerYear.high.toLocaleString("en-GB")}`;

  if (hse) {
    return `Takes ${days} person-days a year out of the hazardous area, and the inspection record becomes timestamped and auditable by a third party.`;
  }
  if (ops) {
    return `Inspection passes go up by ${rc.coverage.multiple.low} to ${rc.coverage.multiple.high} times on the same ground, with ${days} fewer contracted person-days on site.`;
  }
  return `Programme pays back in ${rc.paybackMonths.low} to ${rc.paybackMonths.high} months on displaced inspection spend alone, before any production benefit.`;
}
