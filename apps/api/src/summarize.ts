// Turn Open-Meteo's hourly forecast into daily summaries and a disease risk score.
//
// The risk rule is the one in Lindokuhle's plant disease report (commit b9e6acf).
// Each day scores one point for each of:
//   - at least 6 hours with relative humidity above 90%
//   - any rain
//   - a mean temperature between 18 and 27 °C
// The 7-day total gives the risk level. It covers maize and groundnut leaf
// diseases; cassava mosaic needs whitefly sightings, which weather can't supply.

import { HOURLY, type Forecast } from "./openmeteo";

const HUMID_RH = 90;
const HUMID_HOURS = 6;
const TEMP_RANGE = [18, 27];
const WINDOW = 7;

export type Hour = { time: string } & Partial<Record<(typeof HOURLY)[number], number>>;
export type Day = Record<string, number | string>;

/** Hourly rows, leaving out any field Open-Meteo had no value for. */
export function hourlyRows(forecast: Forecast): Hour[] {
  const { hourly } = forecast;
  return hourly.time.map((time, i) => {
    const row: Hour = { time };
    for (const name of HOURLY) {
      const value = hourly[name]?.[i];
      if (value !== null && value !== undefined) row[name] = value;
    }
    return row;
  });
}

export function riskLevel(score: number): string {
  if (score >= 13) return "high";
  if (score >= 8) return "medium";
  return "low";
}

export function groupByDay(hours: Hour[]): Map<string, Hour[]> {
  const days = new Map<string, Hour[]>();
  for (const hour of hours) {
    const date = hour.time.slice(0, 10);
    days.set(date, [...(days.get(date) ?? []), hour]);
  }
  return new Map([...days].sort(([a], [b]) => a.localeCompare(b)));
}

/** One row per full local day. risk_7d is only set once 7 days are available. */
export function dailyRows(hours: Hour[]): Day[] {
  const days: Day[] = [];
  for (const [date, rows] of groupByDay(hours)) {
    // A partial day would understate rain and humid hours.
    if (rows.length < 24) continue;
    const temp = stats(rows, "temperature_2m");
    const soil = stats(rows, "soil_temperature_6cm");
    const humidity = values(rows, "relative_humidity_2m");
    const precipitation = total(rows, "precipitation");
    const humidHours = humidity.filter((rh) => rh > HUMID_RH).length;

    const score =
      Number(humidHours >= HUMID_HOURS) +
      Number(precipitation !== undefined && precipitation > 0) +
      Number(temp && temp.mean >= TEMP_RANGE[0] && temp.mean <= TEMP_RANGE[1]);

    days.push(
      compact({
        date,
        precipitation_sum: precipitation,
        rain_sum: total(rows, "rain"),
        relative_humidity_2m_mean: humidity.length ? round(sum(humidity) / humidity.length) : undefined,
        humid_hours: humidHours,
        leaf_wetness_probability_mean: stats(rows, "leaf_wetness_probability")?.mean,
        temperature_2m_mean: temp?.mean,
        temperature_2m_min: temp?.min,
        temperature_2m_max: temp?.max,
        soil_temperature_6cm_mean: soil?.mean,
        soil_temperature_6cm_min: soil?.min,
        soil_temperature_6cm_max: soil?.max,
        disease_score: score,
      }),
    );
  }

  for (let i = WINDOW - 1; i < days.length; i++) {
    const risk = sum(days.slice(i - WINDOW + 1, i + 1).map((day) => day.disease_score as number));
    days[i].risk_7d = risk;
    days[i].risk_level = riskLevel(risk);
  }
  return days;
}

function values(rows: Hour[], name: (typeof HOURLY)[number]): number[] {
  return rows.map((row) => row[name]).filter((value): value is number => value !== undefined);
}

function stats(rows: Hour[], name: (typeof HOURLY)[number]) {
  const found = values(rows, name);
  if (!found.length) return undefined;
  return { mean: round(sum(found) / found.length), min: round(Math.min(...found)), max: round(Math.max(...found)) };
}

function total(rows: Hour[], name: (typeof HOURLY)[number]): number | undefined {
  const found = values(rows, name);
  return found.length ? round(sum(found)) : undefined;
}

function sum(numbers: number[]): number {
  return numbers.reduce((a, b) => a + b, 0);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function compact(row: Record<string, number | string | undefined>): Day {
  return Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined)) as Day;
}
