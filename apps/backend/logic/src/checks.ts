// Forecast checks: each farm's location goes to the weather API's /assess for
// every crop, and each disease's status goes through the trigger. A change into
// "flag" raises a flag. A farm's new flags go out together as one alert, and
// the farmer picks which at-risk plant to report on.
//
// Scenario mode puts a made-up wet or dry spell through the same rule code
// (imported from the weather API, not copied), so a flag can be shown firing
// on demand. Flags it raises are marked source "scenario".

import { assess } from "../../api/src/assess";
import type { Soil } from "../../api/src/soil";
import { windowMetrics } from "../../api/src/window";
import type { Hour } from "../../api/src/summarize";
import type { Conversations } from "./conversation";
import { CROPS, type DiseaseId } from "./questionnaires";
import type { Raise } from "./conversation";
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
  const raised: Raise[] = [];
  for (const result of assessment.results) {
    const key = trackKey(farmer.id, result.disease);
    const { track, alert } = evaluate(known.get(key), result.status, severity(result.disease, assessment.window), now);
    known.set(key, track);
    saves.push({ farmerId: farmer.id, disease: result.disease, track });
    if (alert) {
      const details: FlagDetails = {
        conditions: result.conditions,
        air_temp: assessment.window.air_temp_mean,
        soil_temp: assessment.window.soil_temp_mean,
        leaf_wet_hours: assessment.window.leaf_wet_run_max,
        rain_mm: assessment.window.rain_total,
        drainage: assessment.soil?.drainage ?? null,
      };
      raised.push({ disease: result.disease, reason: alert, source, details });
    }
    out.push({ farmer: farmer.id, disease: result.disease, status: result.status, alert });
  }
  await store.saveTracks(saves, now.toISOString());
  if (raised.length) {
    const flags = await conversations.raise(farmer, raised);
    for (const r of out) {
      const flag = flags.find((f) => f.disease === r.disease);
      if (flag) r.flag = flag.id;
    }
  }
  return out;
}

export type ScenarioWeather = "wet" | "dry";

/**
 * A made-up 72-hour spell, assessed for every crop with the weather API's own
 * rules. "wet" is a mild wet spell on poorly drained soil, which puts all four
 * crops at risk (late blight, maize leaf blights, bean leaf diseases and
 * clubroot); "dry" clears every disease, which re-arms the trigger for the next
 * wet spell.
 */
export function scenarioAssessment(weather: ScenarioWeather, now: Date): Assessment {
  const wet = weather === "wet";
  const hours: Hour[] = [];
  const start = Math.floor(now.getTime() / 3_600_000) * 3_600_000 + 2 * 3_600_000; // Malawi local time
  for (let i = 0; i < CHECK_HOURS; i++) {
    const rain = wet && i % 3 === 0 ? 1.2 : 0;
    hours.push({
      time: new Date(start + i * 3_600_000).toISOString().slice(0, 16),
      temperature_2m: wet ? 20 : 33,
      relative_humidity_2m: wet ? 95 : 40,
      precipitation: rain,
      rain,
      soil_temperature_6cm: wet ? 23 : 26,
      leaf_wetness_probability: wet ? 85 : 0,
    });
  }
  const soil: Soil = wet
    ? { ph: 6.2, clay_pct: 38, sand_pct: 30, silt_pct: 32, drainage: "poor", drainage_basis: "Scenario, not measured." }
    : { ph: 7.5, clay_pct: 12, sand_pct: 70, silt_pct: 18, drainage: "good", drainage_basis: "Scenario, not measured." };
  const window = windowMetrics(hours);
  return { window, soil, results: assess([...CROPS], { weather: window, soil }) as Assessment["results"] };
}
