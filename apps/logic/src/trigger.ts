// Decides when a farmer is alerted. An alert follows a change in the weather,
// not a state: a farm is messaged when its conditions newly favour a disease,
// not on every forecast run while they stay favourable.
//
//   clear/watch -> flag            alert ("new")
//   flag -> flag, much worse       alert again ("worse"), at most once a day
//   flag -> flag or watch          no alert; still the same spell
//   anything -> clear              re-armed, so the next spell alerts again
//
// "watch" (one condition short) never alerts and never re-arms. That gap stops
// a farm that wobbles between flag and watch from being messaged each time.

import type { DiseaseId } from "./questionnaires";

export type Status = "flag" | "watch" | "clear";

/** The /assess `window` fields that measure how bad a spell is. */
export interface WindowMetrics {
  leaf_wet_run_max: number;
  wet_or_humid_run_max: number;
  rain_total: number;
}

/** Stored per farm and disease between runs. */
export interface Track {
  status: Status;
  /** True when the next flag should alert. */
  armed: boolean;
  /** The severity measure at the last alert. */
  peak: number | null;
  alertedAt: string | null;
}

export type Alert = "new" | "worse";

// A spell counts as much worse when its measure grows by half and by at least
// this much, for example leaves wet 10 h -> 24 h.
const WORSE_MIN_INCREASE = 6;
const WORSE_RATIO = 1.5;
const MIN_REALERT_MS = 24 * 60 * 60 * 1000;

/**
 * How bad a spell is, for each disease's weather branch. Soil-branch diseases
 * have no measure (soil drainage does not change), so they never re-alert.
 */
export function severity(disease: DiseaseId, window: WindowMetrics): number | null {
  switch (disease) {
    case "late_blight":
    case "bean_leaf_diseases":
      return window.leaf_wet_run_max;
    case "maize_leaf_blights":
      return window.wet_or_humid_run_max;
    case "black_rot":
      return window.rain_total;
    case "bacterial_wilt":
    case "clubroot":
      return null;
  }
}

export function evaluate(
  previous: Track | undefined,
  status: Status,
  measure: number | null,
  now: Date,
): { track: Track; alert: Alert | null } {
  const armed = previous?.armed ?? true;
  const base = { peak: previous?.peak ?? null, alertedAt: previous?.alertedAt ?? null };

  if (status === "clear") return { track: { status, armed: true, peak: null, alertedAt: base.alertedAt }, alert: null };
  if (status === "watch") return { track: { status, armed, ...base }, alert: null };

  if (armed) {
    return { track: { status, armed: false, peak: measure, alertedAt: now.toISOString() }, alert: "new" };
  }

  const { peak, alertedAt } = base;
  const muchWorse =
    measure !== null && peak !== null && measure - peak >= WORSE_MIN_INCREASE && measure >= peak * WORSE_RATIO;
  const longEnough = !alertedAt || now.getTime() - Date.parse(alertedAt) >= MIN_REALERT_MS;
  if (muchWorse && longEnough) {
    return { track: { status, armed: false, peak: measure, alertedAt: now.toISOString() }, alert: "worse" };
  }
  // Peak stays at the alerted level, so a spell held back by the daily limit
  // still alerts on a later run.
  return { track: { status, armed: false, ...base }, alert: null };
}
