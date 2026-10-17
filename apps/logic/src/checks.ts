// Forecast checks: each farm's crop and location go to the weather API's
// /assess, and each disease's status goes through the trigger. A change into
// "flag" raises a flag, which alerts the farmer.
//
// Scenario mode puts a made-up wet or dry spell through the same rule code
// (imported from the weather API, not copied), so a flag can be shown firing
// on demand. Flags it raises are marked source "scenario".

import { assess } from "../../api/src/assess";
import type { Soil } from "../../api/src/soil";
import { windowMetrics } from "../../api/src/window";
import type { Hour } from "../../api/src/summarize";
import type { Conversations } from "./conversation";
import type { DiseaseId } from "./questionnaires";
import { trackKey, type Farmer, type FlagDetails, type FlagSource, type Store } from "./store";
import { evaluate, severity, type Alert, type Status, type Track } from "./trigger";

/** Forecast hours ahead that each check looks at. */
export const CHECK_HOURS = 72;

/** The parts of the weather API's /assess response used here. */
export interface Assessment {
  window: {
    air_temp_mean: number | null;
    soil_temp_mean: number | null;
    leaf_wet_run_max: number;
    wet_or_humid_run_max: number;
    rain_total: number;
  };
  soil: { drainage?: string } | null;
  results: { disease: DiseaseId; status: Status; conditions: FlagDetails["conditions"] }[];
}

export interface WeatherClient {
  assess(farmer: Farmer): Promise<Assessment>;
}

export interface CheckResult {
  farmer: string;
  disease?: DiseaseId;
  status?: Status;
  alert?: Alert | null;
  flag?: string;
  error?: string;
}

/** A client for the deployed weather API. */
export function weatherApi(baseUrl: string): WeatherClient {
  return {
    async assess(farmer) {
      const params = new URLSearchParams({
        lat: String(farmer.latitude),
        lon: String(farmer.longitude),
        crop: farmer.crop,
        hours: String(CHECK_HOURS),
      });
      const response = await fetch(`${baseUrl}/assess?${params}`);
      if (!response.ok) throw new Error(`Weather API returned ${response.status}: ${await response.text()}`);
      return (await response.json()) as Assessment;
    },
  };
}

export async function runChecks(
  store: Store,
  conversations: Conversations,
  client: WeatherClient,
  now: Date,
  farmers?: Farmer[],
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const tracks = await store.listTracks();
  for (const farmer of farmers ?? (await store.listFarmers())) {
    try {
      results.push(...(await apply(store, conversations, farmer, await client.assess(farmer), "forecast", now, tracks)));
    } catch (err) {
      // One farm failing shouldn't stop the rest; the next run retries it.
      console.error(`Check failed for ${farmer.id}`, err);
      results.push({ farmer: farmer.id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return results;
}

/**
 * Put one assessment through the trigger, raising flags where it alerts. Pass
 * `tracks` (from store.listTracks) when applying many, to read them once.
 */
export async function apply(
  store: Store,
  conversations: Conversations,
  farmer: Farmer,
  assessment: Assessment,
  source: FlagSource,
  now: Date,
  tracks?: Map<string, Track>,
): Promise<CheckResult[]> {
  const known = tracks ?? (await store.listTracks());
  const out: CheckResult[] = [];
  const saves: { farmerId: string; disease: DiseaseId; track: Track }[] = [];
  for (const result of assessment.results) {
    const key = trackKey(farmer.id, result.disease);
    const { track, alert } = evaluate(known.get(key), result.status, severity(result.disease, assessment.window), now);
    known.set(key, track);
    saves.push({ farmerId: farmer.id, disease: result.disease, track });
    let flag: string | undefined;
    if (alert) {
      const details: FlagDetails = {
        conditions: result.conditions,
        air_temp: assessment.window.air_temp_mean,
        soil_temp: assessment.window.soil_temp_mean,
        leaf_wet_hours: assessment.window.leaf_wet_run_max,
        rain_mm: assessment.window.rain_total,
        drainage: assessment.soil?.drainage ?? null,
      };
      flag = (await conversations.raise(farmer, result.disease, alert, source, details)).id;
    }
    out.push({ farmer: farmer.id, disease: result.disease, status: result.status, alert, ...(flag ? { flag } : {}) });
  }
  await store.saveTracks(saves, now.toISOString());
  return out;
}

export type ScenarioWeather = "wet" | "dry";

/**
 * A made-up 72-hour spell for a farm's crop, assessed with the weather API's
 * own rules. "wet" is set to raise every flag for that crop; "dry" clears them
 * all, which re-arms the trigger for the next wet spell.
 */
export function scenarioAssessment(farmer: Farmer, weather: ScenarioWeather, now: Date): Assessment {
  const wet = weather === "wet";
  // Each crop's diseases want different temperatures (late blight 16-21 °C,
  // black rot 25-35 °C), so the wet spell is tuned per crop.
  const temps: Record<Farmer["crop"], { air: number; soil: number }> = {
    tomato: { air: 19, soil: 30 },
    maize: { air: 22, soil: 24 },
    beans: { air: 20, soil: 23 },
    cabbage: { air: 27, soil: 22 },
  };
  const hours: Hour[] = [];
  const start = Math.floor(now.getTime() / 3_600_000) * 3_600_000 + 2 * 3_600_000; // Malawi local time
  for (let i = 0; i < CHECK_HOURS; i++) {
    const rain = wet && i % 3 === 0 ? 1.2 : 0;
    hours.push({
      time: new Date(start + i * 3_600_000).toISOString().slice(0, 16),
      temperature_2m: wet ? temps[farmer.crop].air : 33,
      relative_humidity_2m: wet ? 95 : 40,
      precipitation: rain,
      rain,
      soil_temperature_6cm: wet ? temps[farmer.crop].soil : 26,
      leaf_wetness_probability: wet ? 85 : 0,
    });
  }
  const soil: Soil = wet
    ? { ph: 6.2, clay_pct: 38, sand_pct: 30, silt_pct: 32, drainage: "poor", drainage_basis: "Scenario, not measured." }
    : { ph: 7.5, clay_pct: 12, sand_pct: 70, silt_pct: 18, drainage: "good", drainage_basis: "Scenario, not measured." };
  const window = windowMetrics(hours);
  return { window, soil, results: assess([farmer.crop], { weather: window, soil }) as Assessment["results"] };
}
