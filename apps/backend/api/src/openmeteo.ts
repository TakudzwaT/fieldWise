const URL = "https://api.open-meteo.com/v1/forecast";
export const TIMEZONE = "Africa/Blantyre";
export const HOURLY = [
  "temperature_2m",
  "relative_humidity_2m",
  "precipitation",
  "rain",
  "soil_temperature_6cm",
  "leaf_wetness_probability",
] as const;
// Seven days back is what the 7-day disease score needs for today; seven ahead
// gives the outlook.
export const PAST_DAYS = 7;
export const FORECAST_DAYS = 7;
// Open-Meteo takes many coordinates in one call, so one request covers a batch.
export const BATCH_SIZE = 25;
const ATTEMPTS = 3;

export interface Forecast {
  hourly: { time: string[] } & Record<string, (number | null)[]>;
}

/** Fetch hourly forecasts for up to BATCH_SIZE points, in the same order. */
export async function fetchForecasts(points: [number, number][]): Promise<Forecast[]> {
  if (points.length < 1 || points.length > BATCH_SIZE) {
    throw new Error(`fetchForecasts takes 1 to ${BATCH_SIZE} points, got ${points.length}`);
  }
  const params = new URLSearchParams({
    latitude: points.map(([lat]) => lat).join(","),
    longitude: points.map(([, lon]) => lon).join(","),
    hourly: HOURLY.join(","),
    timezone: TIMEZONE,
    past_days: String(PAST_DAYS),
    forecast_days: String(FORECAST_DAYS),
  });

  let lastError: unknown;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const response = await fetch(`${URL}?${params}`);
      if (response.ok) {
        const data = (await response.json()) as Forecast | Forecast[];
        return Array.isArray(data) ? data : [data];
      }
      lastError = new Error(`Open-Meteo returned ${response.status}: ${await response.text()}`);
      // Only rate limits and server errors are worth retrying.
      if (response.status !== 429 && response.status < 500) break;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** (attempt - 1)));
  }
  throw lastError;
}
