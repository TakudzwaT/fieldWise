// What Felix sees: one line per flagged farm, most urgent first, and a summary
// of what the flags and answers add up to ("What Felix receives" in the
// questionnaire document).
//
// A questionnaire still being answered is scored on the answers so far and
// marked provisional, so an urgent answer (maize streak virus, say) reaches
// the top of the list before the farmer finishes. A farmer who never answers
// is listed as "no response", above routine re-checks: a silent farm is not a
// healthy farm.

import { QUESTIONNAIRES, type DiseaseId } from "./questionnaires";
import { score, type Outcome, type Priority, type Report } from "./scoring";
import type { FlagRow } from "./store";

export type State = "answered" | "answering" | "waiting" | "no_response";
export type Rank = Priority | "no_response" | "waiting";

const RANKS: Rank[] = ["go_now", "this_week", "no_response", "recheck", "waiting", "none"];

export const RANK_LABEL: Record<Rank, string> = {
  go_now: "Go now",
  this_week: "Go this week",
  no_response: "No response: chase",
  recheck: "Re-check at next forecast",
  waiting: "Waiting for answers",
  none: "No action",
};

export interface Entry {
  flag_id: string;
  disease: DiseaseId;
  flagged: string;
  raised_at: string;
  reason: string;
  source: string;
  state: State;
  /** Answers given so far, out of 8. */
  answered: number;
  /** Waiting its turn behind another questionnaire, so not yet sent. */
  queued: boolean;
  rank: Rank;
  /** True while the questionnaire is unfinished and the report is on part of the answers. */
  provisional: boolean;
  report: Report | null;
  conditions: string;
}

export interface FarmLine extends Entry {
  farmer: { id: string; name: string; farm_name: string | null; crop: string };
  label: string;
  /** The document's three-line format. */
  text: string;
  /** Other flags on the same farm in the window, less urgent than this one. */
  also: Pick<Entry, "flag_id" | "flagged" | "rank" | "state" | "queued">[];
}

export function entry({ flag, session }: FlagRow): Entry {
  const answers = session?.state.answers ?? [];
  const given = answers.reduce((n, a) => n + (a ? 1 + Number(a.follow !== undefined) : 0), 0);
  const done = session?.status === "done";
  const state: State = done ? "answered" : flag.status === "no_response" ? "no_response" : given ? "answering" : "waiting";
  const report = done ? session!.report : given ? score(flag.disease, answers, { leafWetHours: flag.details.leaf_wet_hours ?? undefined }) : null;

  let rank: Rank;
  if (report && (done || report.priority === "go_now")) rank = report.priority;
  else if (state === "no_response") rank = "no_response";
  else if (report && report.priority !== "none") rank = report.priority;
  else rank = "waiting";

  return {
    flag_id: flag.id,
    disease: flag.disease,
    flagged: QUESTIONNAIRES[flag.disease].name,
    raised_at: flag.raised_at,
    reason: flag.reason,
    source: flag.source,
    state,
    answered: given,
    queued: session?.status === "queued",
    rank,
    provisional: !!report && !done,
    report,
    conditions: conditionsLine(flag.details),
  };
}

/** One line per farm with a flag raised since `since`, most urgent first. */
export function priorityList(rows: FlagRow[]): FarmLine[] {
  const byFarm = new Map<string, { farmer: FlagRow["farmer"]; entries: Entry[] }>();
  for (const row of rows) {
    if (row.flag.status === "merged") continue;
    const farm = byFarm.get(row.farmer.id) ?? { farmer: row.farmer, entries: [] };
    farm.entries.push(entry(row));
    byFarm.set(row.farmer.id, farm);
  }

  const lines: FarmLine[] = [];
  for (const { farmer, entries } of byFarm.values()) {
    entries.sort(compareEntries);
    const [top, ...rest] = entries;
    lines.push({
      ...top,
      farmer,
      label: RANK_LABEL[top.rank],
      text: textLine(farmer, top),
      also: rest.map(({ flag_id, flagged, rank, state, queued }) => ({ flag_id, flagged, rank, state, queued })),
    });
  }
  return lines.sort(compareEntries);
}

export interface Summary {
  farmers: number;
  flagged_farms: number;
  flags: number;
  scenario_flags: number;
  states: Record<State, number>;
  /** Answered out of those asked; null before anyone has been asked. */
  response_rate: number | null;
  outcomes: Record<Outcome, number>;
  urgent: number;
  /** Wrong flags out of answered questionnaires: what question 4 catches. */
  wrong_flag_rate: number | null;
  by_disease: { disease: DiseaseId; name: string; crop: string; flags: number; answered: number; confirmed: number; wrong_flag: number }[];
  /** What the finished answers point to, most common first. */
  answers_say: { problem: string; count: number }[];
}

export function summary(rows: FlagRow[], farmers: number): Summary {
  const live = rows.filter((r) => r.flag.status !== "merged");
  const entries = live.map(entry);
  const states: Record<State, number> = { answered: 0, answering: 0, waiting: 0, no_response: 0 };
  const outcomes: Record<Outcome, number> = { confirmed_urgent: 0, confirmed: 0, wrong_flag: 0, early_signs: 0, clear: 0 };
  const answersSay = new Map<string, number>();
  const diseases = new Map<DiseaseId, Summary["by_disease"][number]>();

  for (const e of entries) {
    states[e.state]++;
    const d = diseases.get(e.disease) ?? {
      disease: e.disease,
      name: e.flagged,
      crop: QUESTIONNAIRES[e.disease].crop,
      flags: 0,
      answered: 0,
      confirmed: 0,
      wrong_flag: 0,
    };
    d.flags++;
    if (e.state === "answered" && e.report) {
      outcomes[e.report.outcome]++;
      d.answered++;
      if (e.report.outcome === "confirmed" || e.report.outcome === "confirmed_urgent") d.confirmed++;
      if (e.report.outcome === "wrong_flag") d.wrong_flag++;
      for (const problem of e.report.answersSay) answersSay.set(problem, (answersSay.get(problem) ?? 0) + 1);
    }
    diseases.set(e.disease, d);
  }

  // Asked means the questionnaire reached the farmer, not merely queued.
  const asked = live.filter((r) => r.session?.started_at).length;
  return {
    farmers,
    flagged_farms: new Set(live.map((r) => r.farmer.id)).size,
    flags: live.length,
    scenario_flags: live.filter((r) => r.flag.source === "scenario").length,
    states,
    response_rate: asked ? round(states.answered / asked) : null,
    outcomes,
    urgent: entries.filter((e) => e.rank === "go_now").length,
    wrong_flag_rate: states.answered ? round(outcomes.wrong_flag / states.answered) : null,
    by_disease: [...diseases.values()].sort((a, b) => b.flags - a.flags || a.name.localeCompare(b.name)),
    answers_say: [...answersSay]
      .map(([problem, count]) => ({ problem, count }))
      .sort((a, b) => b.count - a.count || a.problem.localeCompare(b.problem)),
  };
}

/** Most urgent first; among equals, the questionnaire in front of the farmer, then the newest. */
function compareEntries(a: Entry, b: Entry): number {
  return RANKS.indexOf(a.rank) - RANKS.indexOf(b.rank) || Number(a.queued) - Number(b.queued) || b.raised_at.localeCompare(a.raised_at);
}

/** "BANDA J. | Tomato | Flagged: late blight | ANSWERS SAY: bacterial wilt | Urgent", then answers and weather. */
function textLine(farmer: FlagRow["farmer"], e: Entry): string {
  const first = [shortName(farmer.name), capitalize(farmer.crop), `Flagged: ${e.flagged}`];
  if (e.report?.answersSay.length) first.push(`ANSWERS SAY: ${e.report.answersSay.join(" + ")}`);
  else if (e.report?.likelyWrongFlag) first.push(`ANSWERS SAY: likely not ${e.flagged}`);
  first.push(e.rank === "go_now" ? "Urgent" : RANK_LABEL[e.rank]);
  if (e.provisional) first.push(`provisional, ${e.answered}/8 answered`);
  const lines = [first.join(" | ")];
  if (e.report?.answerLine) lines.push(e.report.answerLine);
  lines.push([e.conditions, `Flagged ${shortDate(e.raised_at)}`].filter(Boolean).join(" | "));
  return lines.join("\n");
}

/** "Air 19C, soil 31C, drainage poor, 14 h wet, rain 8 mm" from what the flag recorded. */
export function conditionsLine(details: FlagRow["flag"]["details"]): string {
  const parts: string[] = [];
  if (details.air_temp != null) parts.push(`Air ${Math.round(details.air_temp)}C`);
  if (details.soil_temp != null) parts.push(`soil ${Math.round(details.soil_temp)}C`);
  if (details.drainage) parts.push(`drainage ${details.drainage}`);
  if (details.leaf_wet_hours) parts.push(`${details.leaf_wet_hours} h wet`);
  if (details.rain_mm) parts.push(`rain ${Math.round(details.rain_mm)} mm`);
  return capitalize(parts.join(", "));
}

/** "John Banda" -> "BANDA J." */
export function shortName(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length < 2) return name.toUpperCase();
  const last = words.pop()!;
  return `${last.toUpperCase()} ${words.map((w) => `${w[0].toUpperCase()}.`).join(" ")}`;
}

/** "12 Oct" in Malawi time. */
function shortDate(iso: string): string {
  const local = new Date(Date.parse(iso) + 2 * 60 * 60 * 1000);
  return `${local.getUTCDate()} ${local.toLocaleString("en", { month: "short", timeZone: "UTC" })}`;
}

function capitalize(text: string): string {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
