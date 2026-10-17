# FieldWise weather API

Weather and crop-disease risk for farms in Malawi, served from our own storage
so apps can call it as often as they like.

- An hourly cron trigger fetches forecasts from [Open-Meteo](https://open-meteo.com)
  and saves them to a Cloudflare D1 database.
- The API reads only from the database. The one exception is the first request
  for a new location, which fetches that location once.
- Old data is deleted automatically: hourly data after 90 days, daily data
  after 2 years.

It runs as one [Cloudflare Worker](https://developers.cloudflare.com/workers/)
(TypeScript) with one D1 database, on Cloudflare's free plan. Every push to the
`backend` branch that touches `apps/api` deploys automatically, through
Cloudflare Workers Builds.

> **Status:** live at https://fieldwise-api.takudzwamhizha132.workers.dev,
> deployed by Cloudflare Workers Builds from the `backend` branch.

**Interactive docs (Swagger):** https://fieldwise-api.takudzwamhizha132.workers.dev/docs
— try every endpoint in the browser. The OpenAPI spec is at
[`/openapi.json`](https://fieldwise-api.takudzwamhizha132.workers.dev/openapi.json),
for generating clients (for example Dart for the mobile app).

---

## API reference

### Base URL

`https://fieldwise-api.<subdomain>.workers.dev`, where `<subdomain>` is the
Cloudflare account's workers.dev subdomain. The current one is
https://fieldwise-api.takudzwamhizha132.workers.dev.

All endpoints are `GET`, need no key, and return JSON. Any website may call
them (CORS allows all origins), since the data is public and read-only.

### Choosing a location

Every weather endpoint takes a location in one of two ways:

| Parameter | Example | Meaning |
|---|---|---|
| `location` | `location=kasungu` | A named place. Only `kasungu` exists for now. |
| `lat` and `lon` | `lat=-13.08&lon=33.46` | Any point in Malawi, such as a farm. |

**Points share grid cells.** A point is snapped to the nearest 0.1° grid cell
(about 11 km across). All farms in one cell get the same numbers, because the
forecast model doesn't have finer detail anyway. The response's `location`
shows which cell was used.

**First request for a new cell is slower.** If nobody has asked for that cell
before, the API fetches it from Open-Meteo first, which adds about a second.
After that, the hourly timer keeps it up to date.

**Limits.** Points outside Malawi are refused. At most 50 cells are tracked
in total, to stay inside the free plan. See [Free plan limits](#free-plan-limits).

### Times and caching

- All dates and times are **Malawi local time** (`Africa/Blantyre`, UTC+2),
  except `fetched_at`, which is UTC.
- Successful responses send `Cache-Control: public, max-age=300`. The data
  only changes once an hour, so reusing a response for 5 minutes is safe.
  Apps should honour this to save requests. (The Worker also caches responses
  at Cloudflare's edge, but that only works on a custom domain, not on
  workers.dev.)
- Every weather response starts with the same header fields:

```json
{
  "location": { "cell": "-13.0_33.5", "name": "kasungu", "latitude": -13, "longitude": 33.5 },
  "timezone": "Africa/Blantyre",
  "fetched_at": "2026-10-17T00:50:05Z",
  "source": "Open-Meteo (open-meteo.com), model data"
}
```

`name` only appears for named locations. `fetched_at` is when Open-Meteo was
last called for this cell. If it's more than about 2 hours old, the hourly
refresh is failing.

---

### `GET /health/live`

Tells you whether the API is up. The mobile app's connection indicator uses it.

```json
{ "status": "ok" }
```

---

### `GET /weather/daily`

One row per day.

| Parameter | Default | Range | Meaning |
|---|---|---|---|
| `days` | 7 | 1–7 | Days to return, starting today |
| `past_days` | 0 | 0–730 | Extra days before today to include |

Example: `GET /weather/daily?lat=-13.08&lon=33.46&days=3&past_days=2`

```json
{
  "location": { "cell": "-13.1_33.5", "latitude": -13.1, "longitude": 33.5 },
  "timezone": "Africa/Blantyre",
  "fetched_at": "2026-10-17T00:50:05Z",
  "source": "Open-Meteo (open-meteo.com), model data",
  "daily": [
    {
      "date": "2026-10-17",
      "precipitation_sum": 0.7,
      "rain_sum": 0.7,
      "relative_humidity_2m_mean": 49.21,
      "humid_hours": 0,
      "leaf_wetness_probability_mean": 1.71,
      "temperature_2m_mean": 23.91,
      "temperature_2m_min": 19.8,
      "temperature_2m_max": 28.4,
      "soil_temperature_6cm_mean": 27.34,
      "soil_temperature_6cm_min": 22.7,
      "soil_temperature_6cm_max": 33.1,
      "disease_score": 2,
      "risk_7d": 8,
      "risk_level": "medium"
    }
  ]
}
```

(The real response has one row per day; only one is shown here.)

| Field | Unit | Meaning |
|---|---|---|
| `date` | | Local date, `YYYY-MM-DD` |
| `precipitation_sum` | mm | All precipitation that day |
| `rain_sum` | mm | Rain only |
| `relative_humidity_2m_mean` | % | Average humidity |
| `humid_hours` | hours | Hours with humidity above 90% |
| `leaf_wetness_probability_mean` | % | Average chance that leaves are wet |
| `temperature_2m_mean` / `_min` / `_max` | °C | Air temperature at 2 m |
| `soil_temperature_6cm_mean` / `_min` / `_max` | °C | Soil temperature at 6 cm |
| `disease_score` | 0–3 | That day's points under the [risk rule](#disease-risk-rule) |
| `risk_7d` | 0–21 | Sum of the last 7 days' `disease_score` |
| `risk_level` | | `low`, `medium` or `high` |

These field names match `src/data/kasungu_weather.json`, so code that reads
that file can switch to the API with few changes.

**Missing fields.** A field is left out of a row when Open-Meteo had no value
for it. This mostly happens at the far end of the forecast. Older days can
also lack `risk_7d` and `risk_level` if fewer than 7 days of data came before
them.

---

### `GET /weather/hourly`

One row per hour.

| Parameter | Default | Range | Meaning |
|---|---|---|---|
| `hours` | 48 | 1–168 | Hours to return, starting with the current hour |
| `past_hours` | 0 | 0–2160 | Extra hours before now to include |

Example: `GET /weather/hourly?location=kasungu&hours=2`

```json
{
  "location": { "cell": "-13.0_33.5", "name": "kasungu", "latitude": -13, "longitude": 33.5 },
  "timezone": "Africa/Blantyre",
  "fetched_at": "2026-10-17T00:50:05Z",
  "source": "Open-Meteo (open-meteo.com), model data",
  "hourly": [
    {
      "time": "2026-10-17T02:00",
      "temperature_2m": 21.4,
      "relative_humidity_2m": 61,
      "precipitation": 0.0,
      "rain": 0.0,
      "soil_temperature_6cm": 23.9,
      "leaf_wetness_probability": 0
    }
  ]
}
```

(Values here are illustrative.)

| Field | Unit |
|---|---|
| `time` | Local time, `YYYY-MM-DDTHH:MM` |
| `temperature_2m` | °C |
| `relative_humidity_2m` | % |
| `precipitation`, `rain` | mm in that hour |
| `soil_temperature_6cm` | °C |
| `leaf_wetness_probability` | % |

---

### `GET /risk`

The disease risk for today and each of the next 6 days.

Example: `GET /risk?location=kasungu`

```json
{
  "location": { "cell": "-13.0_33.5", "name": "kasungu", "latitude": -13, "longitude": 33.5 },
  "timezone": "Africa/Blantyre",
  "fetched_at": "2026-10-17T00:50:05Z",
  "source": "Open-Meteo (open-meteo.com), model data",
  "crops": ["maize", "groundnut"],
  "rule": "Each day scores 1 point each for 6+ hours above 90% humidity, any rain, and a mean temperature of 18-27 °C. The 7-day total gives the level: 0-7 low, 8-12 medium, 13-21 high.",
  "note": "Decision support from weather alone, not a diagnosis. Confirm with field checks.",
  "today": { "date": "2026-10-17", "risk_7d": 9, "risk_level": "medium", "disease_score": 2 },
  "outlook": [
    { "date": "2026-10-17", "risk_7d": 9, "risk_level": "medium", "disease_score": 2 },
    { "date": "2026-10-18", "risk_7d": 9, "risk_level": "medium", "disease_score": 1 }
  ]
}
```

`outlook` has up to 7 days, starting today. `today` is `null` if today's score
isn't available yet.

#### Disease risk rule

The rule comes from the plant disease report in commit `b9e6acf`. Each day
scores one point for each of these:

1. At least 6 hours with relative humidity above 90%
2. Any rain
3. A mean temperature between 18 and 27 °C

The total over the last 7 days (0–21) gives the level:

| Points | Level | Suggested action |
|---|---|---|
| 0–7 | low | Normal monitoring |
| 8–12 | medium | Check fields weekly and remove infected leaves |
| 13–21 | high | Check fields every few days; consider treatment per extension advice |

It covers leaf diseases of maize (gray leaf spot, leaf blight) and groundnut
(leaf spot). Cassava mosaic isn't included, because it depends on whitefly
sightings, which weather data can't provide.

> **Known issue:** Kasungu's normal temperature scores the temperature point
> almost every day, which is 7 points a week on its own. Any trace of rain then
> lifts a dry week to "medium". The thresholds need agreeing with the team and
> checking with extension officers.

---

### `GET /locations`

Lists the named places and every cell being tracked.

```json
{
  "named": ["kasungu"],
  "cells": [
    { "cell": "-13.0_33.5", "latitude": -13, "longitude": 33.5, "fetched_at": "2026-10-17T00:50:05Z", "name": "kasungu" },
    { "cell": "-13.1_33.5", "latitude": -13.1, "longitude": 33.5, "fetched_at": "2026-10-17T00:50:05Z" }
  ]
}
```

---

### Errors

Errors return `{ "error": "<message>" }` and are never cached.

| Status | When |
|---|---|
| 400 | No location given, `lat`/`lon` not numbers, point outside Malawi, or a parameter out of range |
| 404 | Unknown `location` name, or unknown route |
| 405 | Method other than `GET` |
| 500 | Unexpected server error. Details are in the Worker logs. |
| 502 | A new cell's first fetch from Open-Meteo failed. Try again shortly. |
| 503 | The 50-cell limit is reached |

---

## Deploying

Deploys are automatic, through [Cloudflare Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/).
Cloudflare watches this GitHub repo. On every push to the `backend` branch
that changes `apps/api/`, it:

1. installs dependencies and type-checks the code (`npm run typecheck`)
2. applies any new database migrations in `migrations/` to the live D1 database
3. deploys the Worker

Builds run on Cloudflare's machines, not GitHub Actions, so they don't depend
on the GitHub account's billing. Build logs are in the Cloudflare dashboard
under **Workers & Pages → fieldwise-api → Deployments**. To rebuild without a
new commit, click **Retry build** on the latest build there.

### One-time setup

This is done once per Cloudflare account. It's already done for the current
account.

1. **Account.** Sign up at [dash.cloudflare.com](https://dash.cloudflare.com/sign-up)
   (free, no card).
2. **Database.** Run these from `apps/api`:

   ```bash
   npx wrangler login
   ```

   ```bash
   npx wrangler d1 create fieldwise
   ```

   Copy the `database_id` it prints into `wrangler.jsonc`, and commit it. The
   ID isn't secret.
3. **First deploy.** This creates the Worker so it can be connected to Git:

   ```bash
   npm run db:migrate:remote && npm run deploy
   ```

4. **Connect the repo.** In the dashboard, open **Workers & Pages →
   fieldwise-api → Settings → Build → Connect**. Install the Cloudflare GitHub
   app on `TakudzwaT/fieldWise` only, then set:

   | Setting | Value |
   |---|---|
   | Production branch | `backend` |
   | Build command | `npm run typecheck` |
   | Deploy command | `npx wrangler d1 migrations apply fieldwise --remote && npx wrangler deploy` |
   | Root directory | `apps/api` |
   | Builds for non-production branches | Off |
   | Build watch paths, include | `apps/api/*` |

### Deploying by hand

From `apps/api`, after `npx wrangler login`, run:

```bash
npm run db:migrate:remote && npm run deploy
```

### Logs

In the Cloudflare dashboard, open **Workers & Pages → fieldwise-api → Logs**.
Each hourly run logs a line like `Refreshed 2 of 2 cells, pruned 0 old rows`.
Fetch failures are logged with the full error.

To watch live logs from your terminal:

```bash
npx wrangler tail fieldwise-api
```

### Looking at the data

To query the live database directly, run this from `apps/api`:

```bash
npx wrangler d1 execute fieldwise --remote --command "SELECT id, name, fetched_at FROM cells"
```

### Removing everything

This deletes the API and all stored data. It can't be undone.

```bash
npx wrangler delete fieldwise-api
```

```bash
npx wrangler d1 delete fieldwise
```

---

## Free plan limits

The Workers free plan has these limits that matter here (as of October 2026;
check Cloudflare's pricing page for current numbers):

| Limit | Free plan | What it means here |
|---|---|---|
| Requests | 100,000 a day | Every API call counts, cached or not. Apps should honour `Cache-Control`. |
| CPU time | 10 ms per request or cron run | Parsing Open-Meteo's response takes CPU time, which is why at most 50 cells are tracked. |
| D1 rows written | 100,000 a day | Each cell costs about 20 rows per hourly refresh, so about 500 a day. |
| D1 storage | 5 GB | Far more than this needs. |

To track more cells, upgrade to Workers Paid ($5/month). That raises the CPU
limit to 30 seconds and the write limit to 50 million rows a month. Then raise
`MAX_CELLS` in `src/cells.ts`.

---

## Local development

You need Node.js 22 or newer. Run these from `apps/api`:

```bash
npm install
```

```bash
npm run db:migrate:local
```

```bash
npm run dev
```

The API is then at `http://localhost:8787`, using a local database in
`.wrangler/`. To trigger the hourly job by hand:

```bash
curl "http://localhost:8787/__scheduled?cron=5+*+*+*+*"
```

Check types with `npm run typecheck`.

## Code layout

| File | What it does |
|---|---|
| `src/index.ts` | Routes, the hourly job, and finding or creating a location's cell |
| `src/openapi.ts` | OpenAPI spec and the Swagger UI page. Update it when routes or fields change. |
| `src/openmeteo.ts` | Fetching from Open-Meteo, with retries |
| `src/summarize.ts` | Daily summaries and the disease risk rule |
| `src/store.ts` | Reading and writing the D1 database |
| `src/cells.ts` | Grid snapping, coverage area, cell limit, named places |
| `migrations/` | Database schema. Add a new numbered file for each change, never edit an old one. |
| `wrangler.jsonc` | Worker name, hourly schedule, database binding |

## Settings

These are constants in the code:

| Setting | Where | Value |
|---|---|---|
| Hourly refresh time | `wrangler.jsonc`, `triggers.crons` | 5 minutes past each hour |
| Data kept | `HOURLY_KEEP_DAYS`, `DAILY_KEEP_DAYS` in `src/index.ts` | 90 days / 730 days |
| Cache time | `CACHE_SECONDS` in `src/index.ts` | 300 s |
| Grid size, area, cell limit | `src/cells.ts` | 0.1°, Malawi, 50 |
| Named places | `NAMED` in `src/cells.ts` | `kasungu` |
| Risk thresholds | `src/summarize.ts` | see [Disease risk rule](#disease-risk-rule) |

## Data source and licence

Weather data is from [Open-Meteo](https://open-meteo.com), licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Apps showing this
data should credit Open-Meteo. Open-Meteo's free API is for non-commercial use.
If FieldWise becomes commercial, it needs their paid plan.
