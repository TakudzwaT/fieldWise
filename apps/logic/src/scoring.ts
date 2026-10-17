// Turns a farmer's answers into one of the five outcomes Felix acts on
// ("What Felix receives" in the questionnaire document):
//
//   confirmed_urgent  flagged disease confirmed, worse and spreading  -> go now
//   confirmed         flagged disease confirmed, spread limited       -> go this week
//   wrong_flag        the answers point to a different problem         -> go, for that problem
//   early_signs       nothing confirmed, but something worth a look    -> re-check next forecast
//   clear             nothing confirmed on any branch                  -> no action
//
// A no is the farmer's judgement from memory, not proof of absence, so
// partial and clear results are reported as such rather than as healthy.

import { QUESTIONNAIRES, type Answers, type DiseaseId, type FlagContext, type FollowUp } from "./questionnaires";

export type Outcome = "confirmed_urgent" | "confirmed" | "wrong_flag" | "early_signs" | "clear";
export type Priority = "go_now" | "this_week" | "recheck" | "none";

export interface Report {
  flagged: string;
  outcome: Outcome;
  priority: Priority;
  urgent: boolean;
  /** What the answers point to, if anything. Shown as "ANSWERS SAY". */
  answersSay: string[];
  /** The answers point away from the flag without naming another problem. */
  likelyWrongFlag: boolean;
  /** Worrying answers that did not confirm anything on their own. */
  signs: string[];
  notes: string[];
  /** Ask the same questionnaire again after this many days. */
  recheckInDays: number | null;
  /** All eight answers given. */
  complete: boolean;
  /** "Q1 wet patches N | Q2 white fuzz Y, stem marks N | ..." */
  answerLine: string;
}

const PRIORITY_RANK: Record<Priority, number> = { go_now: 0, this_week: 1, recheck: 2, none: 3 };

export function score(disease: DiseaseId, answers: Answers, ctx: FlagContext = {}): Report {
  const q = QUESTIONNAIRES[disease];
  const confirmed = q.confirms(answers);
  const otherConfirmed = q.otherConfirmed(answers);
  const spreading = answers[2]?.main === true && answers[2]?.follow === true;

  const signs: string[] = [];
  const notes: string[] = [];
  const suggests: string[] = [];
  let pointsAway = false;

  q.questions.forEach((question, i) => {
    const answer = answers[i];
    if (!answer) return;
    // Any yes to a main question is a worrying answer, except "worse", which
    // only matters together with what is getting worse.
    if (answer.main && question.key !== "worse") signs.push(question.key);
    if (answer.follow === undefined) return;
    const follow: FollowUp = answer.main ? question.yes : question.no;
    if (answer.follow !== (follow.concern ?? true)) return;
    if (follow.role === "sign") signs.push(follow.key);
    if (follow.role === "elsewhere") {
      pointsAway = true;
      if (follow.suggests) suggests.push(follow.suggests);
    }
    if (follow.note) notes.push(follow.note);
  });

  const contextNote = q.context?.(ctx);
  if (contextNote) notes.push(contextNote);

  let outcome: Outcome;
  let answersSay: string[] = [];
  let urgent = false;

  if (otherConfirmed && (q.otherOutranks || !confirmed)) {
    outcome = "wrong_flag";
    answersSay = [q.other];
    urgent = spreading || !!q.otherUrgent;
  } else if (confirmed) {
    outcome = spreading ? "confirmed_urgent" : "confirmed";
    answersSay = otherConfirmed ? [confirmed, q.other] : [confirmed];
    urgent = spreading || (otherConfirmed && !!q.otherUrgent);
  } else if (suggests.length) {
    outcome = "wrong_flag";
    answersSay = suggests;
  } else if (signs.length) {
    outcome = "early_signs";
  } else {
    outcome = "clear";
  }

  const priority: Priority = urgent
    ? "go_now"
    : outcome === "confirmed" || outcome === "wrong_flag"
      ? "this_week"
      : outcome === "early_signs"
        ? "recheck"
        : "none";

  const recheckInDays = outcome === "clear" ? (q.recheckWhenClear ?? null) : null;
  if (recheckInDays) notes.push(`A clear answer may only mean it is too early to see. Ask again in ${recheckInDays} days.`);

  return {
    flagged: q.name,
    outcome,
    priority,
    urgent,
    answersSay,
    likelyWrongFlag: pointsAway && !confirmed,
    signs,
    notes,
    recheckInDays,
    complete: q.questions.every((_, i) => answers[i]?.follow !== undefined),
    answerLine: answerLine(disease, answers),
  };
}

export function answerLine(disease: DiseaseId, answers: Answers): string {
  const yn = (value: boolean) => (value ? "Y" : "N");
  return QUESTIONNAIRES[disease].questions
    .map((question, i) => {
      const answer = answers[i];
      if (!answer) return null;
      let part = `Q${i + 1} ${question.key} ${yn(answer.main)}`;
      if (answer.follow !== undefined) part += `, ${(answer.main ? question.yes : question.no).key} ${yn(answer.follow)}`;
      return part;
    })
    .filter(Boolean)
    .join(" | ");
}

/** Sorts reports for Felix's list: most urgent first. */
export function byPriority(a: Pick<Report, "priority">, b: Pick<Report, "priority">): number {
  return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
}
