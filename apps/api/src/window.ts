// Weather summaries over a chosen run of hours, for rules like "leaves wet for
// at least 10 hours". Durations are the longest unbroken run of hours, not a
// total, because disease needs leaves to stay wet, not to get wet now and then.

import type { Hour } from "./summarize";

// Open-Meteo gives leaf wetness as a probability; at or above this, the hour
// counts as wet.
export const LEAF_WET_PROBABILITY = 50;
export const HUMID_RH = 90;

export interface WindowMetrics {
  start: string | null;
  end: string | null;
  hours: number;
  air_temp_mean: number | null;
  air_temp_min: number | null;
  air_temp_max: number | null;
  soil_temp_mean: number | null;
  soil_temp_min: number | null;
  soil_temp_max: number | null;
  rh_max: number | null;
  humid_hours: number;
  humid_run_max: number;
  leaf_wet_hours: number;
  leaf_wet_run_max: number;
  wet_or_humid_run_max: number;
  rain_total: number;
  rain_hours: number;
}

export function windowMetrics(hours: Hour[]): WindowMetrics {
  const air = numbers(hours, "temperature_2m");
  const soil = numbers(hours, "soil_temperature_6cm");
  const rh = numbers(hours, "relative_humidity_2m");
  const humid = (h: Hour) => (h.relative_humidity_2m ?? 0) >= HUMID_RH;
  const leafWet = (h: Hour) => (h.leaf_wetness_probability ?? 0) >= LEAF_WET_PROBABILITY;
  const rainy = (h: Hour) => (h.precipitation ?? 0) > 0;

  return {
    start: hours[0]?.time ?? null,
    end: hours.at(-1)?.time ?? null,
    hours: hours.length,
    air_temp_mean: mean(air),
    air_temp_min: air.length ? Math.min(...air) : null,
    air_temp_max: air.length ? Math.max(...air) : null,
    soil_temp_mean: mean(soil),
    soil_temp_min: soil.length ? Math.min(...soil) : null,
    soil_temp_max: soil.length ? Math.max(...soil) : null,
    rh_max: rh.length ? Math.max(...rh) : null,
    humid_hours: hours.filter(humid).length,
    humid_run_max: longestRun(hours, humid),
    leaf_wet_hours: hours.filter(leafWet).length,
    leaf_wet_run_max: longestRun(hours, leafWet),
    wet_or_humid_run_max: longestRun(hours, (h) => leafWet(h) || humid(h)),
    rain_total: round(numbers(hours, "precipitation").reduce((a, b) => a + b, 0)),
    rain_hours: hours.filter(rainy).length,
  };
}

/** Longest run of consecutive hours where `test` holds. */
function longestRun(hours: Hour[], test: (hour: Hour) => boolean): number {
  let best = 0;
  let current = 0;
  for (const hour of hours) {
    current = test(hour) ? current + 1 : 0;
    best = Math.max(best, current);
  }
  return best;
}

function numbers(hours: Hour[], name: keyof Hour): number[] {
  return hours.map((h) => h[name]).filter((v): v is number => typeof v === "number");
}

function mean(values: number[]): number | null {
  return values.length ? round(values.reduce((a, b) => a + b, 0) / values.length) : null;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
