// FieldWise weather API (Cloudflare Worker).
//
// An hourly cron trigger refreshes every tracked cell from Open-Meteo and
// prunes old rows. The HTTP routes only read from D1, so traffic never reaches
// Open-Meteo, except the first request for a new cell, which fetches it once.

import { MAX_CELLS, NAMED, inBounds, namedCells, snap, type Cell } from "./cells";
import { BATCH_SIZE, FORECAST_DAYS, TIMEZONE, fetchForecasts } from "./openmeteo";
import { docsPage, openapi } from "./openapi";
import { Store, type StoredCell } from "./store";
import { dailyRows, hourlyRows } from "./summarize";

interface Env {
  DB: D1Database;
}

// Malawi is UTC+2 all year, so a fixed offset is enough.
const MALAWI_OFFSET_MS = 2 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const HOURLY_KEEP_DAYS = 90;
const DAILY_KEEP_DAYS = 730;
// Data changes hourly, so callers and caches may reuse a response this long.
const CACHE_SECONDS = 300;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });
    if (request.method !== "GET") return error(405, "Only GET is supported.");

    // Serve repeat requests from Cloudflare's cache. (This only takes effect on
    // a custom domain; on workers.dev the cache is skipped.)
    const cache = caches.default;
    const cached = await cache.match(request);
    if (cached) return cached;

    let response: Response;
    try {
      response = await route(new URL(request.url), new Store(env.DB));
    } catch (err) {
      console.error("Request failed", err);
      response = error(500, "Something went wrong. Try again shortly.");
    }
    if (response.status === 200 && response.headers.get("Cache-Control")?.startsWith("public")) {
      ctx.waitUntil(cache.put(request, response.clone()));
    }
    return response;
  },

  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    const store = new Store(env.DB);
    const tracked = new Map<string, StoredCell | Cell>((await store.listCells()).map((cell) => [cell.id, cell]));
    for (const cell of namedCells()) if (!tracked.has(cell.id)) tracked.set(cell.id, cell);
    const refreshed = await refresh(store, [...tracked.values()]);

    const pruned = await store.prune(localDate(-HOURLY_KEEP_DAYS), localDate(-DAILY_KEEP_DAYS));
    console.log(`Refreshed ${refreshed} of ${tracked.size} cells, pruned ${pruned} old rows`);
  },
} satisfies ExportedHandler<Env>;

async function route(url: URL, store: Store): Promise<Response> {
  switch (url.pathname) {
    case "/":
      return Response.redirect(new URL("/docs", url).toString(), 302);
    case "/docs":
      return new Response(docsPage, {
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": `public, max-age=${CACHE_SECONDS}` },
      });
    case "/openapi.json":
      return json(openapi);
    case "/health/live":
      return json({ status: "ok" }, 200, false);
    case "/locations":
      return json({
        named: Object.keys(NAMED).sort(),
        cells: (await store.listCells()).map(({ id, ...cell }) => ({ cell: id, ...cell })),
      });
    case "/weather/daily":
      return weatherDaily(url, store);
    case "/weather/hourly":
      return weatherHourly(url, store);
    case "/risk":
      return risk(url, store);
    default:
      return error(404, "Not found. See /docs for the available routes.");
  }
}

async function weatherDaily(url: URL, store: Store): Promise<Response> {
  const cell = await resolve(url, store);
  if (cell instanceof Response) return cell;
  const days = intParam(url, "days", 7, 1, 7);
  const pastDays = intParam(url, "past_days", 0, 0, DAILY_KEEP_DAYS);
  if (days instanceof Response) return days;
  if (pastDays instanceof Response) return pastDays;
  const daily = await store.readDaily(cell.id, localDate(-pastDays), localDate(days));
  return json({ ...header(cell), daily });
}

async function weatherHourly(url: URL, store: Store): Promise<Response> {
  const cell = await resolve(url, store);
  if (cell instanceof Response) return cell;
  const hours = intParam(url, "hours", 48, 1, 24 * FORECAST_DAYS);
  const pastHours = intParam(url, "past_hours", 0, 0, 24 * HOURLY_KEEP_DAYS);
  if (hours instanceof Response) return hours;
  if (pastHours instanceof Response) return pastHours;
  const thisHour = Math.floor(Date.now() / HOUR_MS) * HOUR_MS;
  const hourly = await store.readHourly(
    cell.id,
    localTime(thisHour - pastHours * HOUR_MS),
    localTime(thisHour + hours * HOUR_MS),
  );
  return json({ ...header(cell), hourly });
}

async function risk(url: URL, store: Store): Promise<Response> {
  const cell = await resolve(url, store);
  if (cell instanceof Response) return cell;
  const today = localDate(0);
  const days = await store.readDaily(cell.id, today, localDate(7));
  const outlook = days
    .filter((day) => "risk_7d" in day)
    .map(({ date, risk_7d, risk_level, disease_score }) => ({ date, risk_7d, risk_level, disease_score }));
  return json({
    ...header(cell),
    crops: ["maize", "groundnut"],
    rule:
      "Each day scores 1 point each for 6+ hours above 90% humidity, any rain, " +
      "and a mean temperature of 18-27 °C. The 7-day total gives the level: " +
      "0-7 low, 8-12 medium, 13-21 high.",
    note: "Decision support from weather alone, not a diagnosis. Confirm with field checks.",
    today: outlook[0]?.date === today ? outlook[0] : null,
    outlook,
  });
}

/** Find the cell for ?location=name or ?lat=..&lon=.., fetching it if new. */
async function resolve(url: URL, store: Store): Promise<StoredCell | Response> {
  const name = url.searchParams.get("location");
  const latParam = url.searchParams.get("lat");
  const lonParam = url.searchParams.get("lon");
  let lat: number;
  let lon: number;
  if (name) {
    if (!(name in NAMED)) return error(404, `Unknown location '${name}'. Known: ${Object.keys(NAMED).sort().join(", ")}.`);
    [lat, lon] = NAMED[name];
  } else if (latParam !== null && lonParam !== null) {
    lat = Number(latParam);
    lon = Number(lonParam);
    if (latParam.trim() === "" || lonParam.trim() === "" || !Number.isFinite(lat) || !Number.isFinite(lon)) {
      return error(400, "lat and lon must be numbers.");
    }
  } else {
    return error(400, "Pass lat and lon, or location.");
  }

  const target: Cell = { ...snap(lat, lon), ...(name ? { name } : {}) };
  const existing = await store.getCell(target.id);
  if (existing) return existing;
  if (!inBounds(lat, lon)) return error(400, "That point is outside the area FieldWise covers (Malawi).");
  if ((await store.listCells()).length >= MAX_CELLS) return error(503, "FieldWise is tracking its maximum number of locations.");
  await refresh(store, [target]);
  return (await store.getCell(target.id)) ?? error(502, "Couldn't fetch weather for this location. Try again shortly.");
}

/** Fetch and save each cell; returns how many were saved. */
async function refresh(store: Store, targets: (StoredCell | Cell)[]): Promise<number> {
  // Cells fetched before only need days from yesterday on; older days are stored.
  const yesterday = localDate(-1);
  let saved = 0;
  for (let i = 0; i < targets.length; i += BATCH_SIZE) {
    const batch = targets.slice(i, i + BATCH_SIZE);
    try {
      const forecasts = await fetchForecasts(batch.map((cell) => [cell.latitude, cell.longitude]));
      const fetchedAt = new Date().toISOString().slice(0, 19) + "Z";
      for (const [j, cell] of batch.entries()) {
        const hours = hourlyRows(forecasts[j]);
        const since = "fetched_at" in cell && cell.fetched_at ? yesterday : undefined;
        await store.save(cell, hours, dailyRows(hours), fetchedAt, since);
        saved++;
      }
    } catch (err) {
      // One failed batch shouldn't stop the rest; the next hour retries it.
      console.error(`Refresh failed for ${batch.length} cells`, err);
    }
  }
  return saved;
}

function header(cell: StoredCell) {
  const { id, name, latitude, longitude, fetched_at } = cell;
  return {
    location: { cell: id, ...(name ? { name } : {}), latitude, longitude },
    timezone: TIMEZONE,
    fetched_at,
    source: "Open-Meteo (open-meteo.com), model data",
  };
}

function intParam(url: URL, name: string, fallback: number, low: number, high: number): number | Response {
  const raw = url.searchParams.get(name);
  if (raw === null) return fallback;
  if (!/^-?\d+$/.test(raw)) return error(400, `${name} must be a whole number.`);
  const value = Number(raw);
  if (value < low || value > high) return error(400, `${name} must be between ${low} and ${high}.`);
  return value;
}

/** Malawi local date, offset by whole days from today: "YYYY-MM-DD". */
function localDate(offsetDays: number): string {
  return new Date(Date.now() + MALAWI_OFFSET_MS + offsetDays * DAY_MS).toISOString().slice(0, 10);
}

/** Malawi local time for a UTC timestamp: "YYYY-MM-DDTHH:MM". */
function localTime(utcMs: number): string {
  return new Date(utcMs + MALAWI_OFFSET_MS).toISOString().slice(0, 16);
}

function corsHeaders(): Record<string, string> {
  // Public, read-only data, so any web app may call it.
  return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS" };
}

function json(body: unknown, status = 200, cache = true): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": cache ? `public, max-age=${CACHE_SECONDS}` : "no-store",
      ...corsHeaders(),
    },
  });
}

function error(status: number, message: string): Response {
  return json({ error: message }, status, false);
}
