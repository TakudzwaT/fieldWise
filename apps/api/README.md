# FieldWise weather API

Weather and crop-disease risk for farms in Malawi, served from our own storage
so apps can call it as often as they like.

- An hourly timer fetches forecasts from [Open-Meteo](https://open-meteo.com)
  and saves them to Azure Table Storage.
- The API reads only from storage. The one exception is the first request for
  a new location, which fetches that location once.
- Old data is deleted automatically: hourly rows after 90 days, daily rows
  after 2 years.

It runs as one Azure Function App (Python) with one storage account.

> **Status:** work in progress. Every endpoint has been tested against live
> Open-Meteo data with an in-memory stand-in for storage. It has not yet run
> against real Azure Table Storage or been deployed.

---

## API reference

### Base URL

The Function App's address, for example
`https://fieldwise-api-xxxx.azurewebsites.net`. See [Deploying](#deploying)
for how to find it. Routes have no `/api` prefix.

All endpoints are `GET`, need no key, and return JSON.

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

**Limits.** Points outside Malawi are refused. At most 500 cells are tracked
in total.

### Times and caching

- All dates and times are **Malawi local time** (`Africa/Blantyre`, UTC+2),
  except `fetched_at`, which is UTC.
- Successful responses send `Cache-Control: public, max-age=300`. The data
  only changes once an hour, so reusing a response for 5 minutes is safe.
- Every weather response starts with the same header fields:

```json
{
  "location": { "cell": "-13.0_33.5", "name": "kasungu", "latitude": -13.0, "longitude": 33.5 },
  "timezone": "Africa/Blantyre",
  "fetched_at": "2026-10-17T00:21:03+00:00",
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
  "fetched_at": "2026-10-17T00:21:03+00:00",
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
  "location": { "cell": "-13.0_33.5", "name": "kasungu", "latitude": -13.0, "longitude": 33.5 },
  "timezone": "Africa/Blantyre",
  "fetched_at": "2026-10-17T00:21:03+00:00",
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
  "location": { "cell": "-13.0_33.5", "name": "kasungu", "latitude": -13.0, "longitude": 33.5 },
  "timezone": "Africa/Blantyre",
  "fetched_at": "2026-10-17T00:21:03+00:00",
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
    { "cell": "-13.0_33.5", "latitude": -13.0, "longitude": 33.5, "fetched_at": "2026-10-17T00:21:03+00:00", "name": "kasungu" },
    { "cell": "-13.1_33.5", "latitude": -13.1, "longitude": 33.5, "fetched_at": "2026-10-17T00:21:03+00:00" }
  ]
}
```

---

### Errors

Errors return `{ "error": "<message>" }` and are never cached.

| Status | When |
|---|---|
| 400 | No location given, `lat`/`lon` not numbers, point outside Malawi, or a parameter out of range |
| 404 | Unknown `location` name |
| 502 | A new cell's first fetch from Open-Meteo failed. Try again shortly. |
| 503 | The 500-cell limit is reached |

---

## Deploying

You do this once to create everything in Azure, then redeploy whenever the code
changes. The commands below are untested against a real Azure account, so read
any error output carefully.

### 1. Install the tools

```bash
brew install azure-cli
```

```bash
brew tap azure/functions && brew install azure-functions-core-tools@4
```

```bash
az login
```

### 2. Pick names and a region

Storage account names must be globally unique, 3–24 lowercase letters or
digits. Function App names must also be globally unique.

```bash
export RG=fieldwise-rg LOCATION=southafricanorth STORAGE=fieldwisestore$RANDOM APP=fieldwise-api-$RANDOM
```

Check that the region supports the Flex Consumption plan. If
`southafricanorth` isn't listed, choose the nearest region that is.

```bash
az functionapp list-flexconsumption-locations --output table
```

### 3. Create the resources

```bash
az group create --name $RG --location $LOCATION
```

```bash
az storage account create --name $STORAGE --resource-group $RG --location $LOCATION --sku Standard_LRS
```

```bash
az functionapp create --resource-group $RG --name $APP --storage-account $STORAGE --flexconsumption-location $LOCATION --runtime python --runtime-version 3.12
```

This creates the Function App and an Application Insights resource for its
logs. The app stores its data in the same storage account, through the
`AzureWebJobsStorage` setting Azure adds automatically.

### 4. Deploy the code

Run this from `apps/api`. Azure installs the Python packages during the
upload.

```bash
func azure functionapp publish $APP
```

To redeploy after changing the code, run the same command again.

### 5. Check it works

```bash
curl "https://$(az functionapp show -g $RG -n $APP --query defaultHostName -o tsv)/health/live"
```

Next, request `/risk?location=kasungu`. The first call fetches Kasungu, and
after that the timer refreshes it at 5 minutes past every hour.

### Logs

Open the Function App in the Azure portal, then **Monitoring → Logs** or
**Application Insights**. Each hourly run logs a line like
`Refreshed 2 cells, pruned 0 old rows`, and fetch failures are logged with the
full error.

### Removing everything

This deletes the API and all stored data. It can't be undone.

```bash
az group delete --name $RG
```

---

## Local development

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
```

Running the app locally with `func start` needs a storage emulator called
Azurite, which runs on Node.js. Copy `local.settings.example.json` to
`local.settings.json`, start Azurite, then run `func start`. The API is then at
`http://localhost:7071`.

## Settings and limits

These are constants in the code:

| Setting | Where | Value |
|---|---|---|
| Hourly refresh time | `function_app.py`, `refresh_weather` | 5 minutes past each hour |
| Data kept | `HOURLY_KEEP_DAYS`, `DAILY_KEEP_DAYS` | 90 days / 730 days |
| Cache time | `CACHE_SECONDS` | 300 s |
| Grid size, area, cell limit | `fieldwise/cells.py` | 0.1°, Malawi, 500 |
| Named places | `cells.NAMED` | `kasungu` |
| Risk thresholds | `fieldwise/summarize.py` | see [Disease risk rule](#disease-risk-rule) |

Optional app setting `FIELDWISE_STORAGE`: a storage connection string to use
instead of `AzureWebJobsStorage`.

## Data source and licence

Weather data is from [Open-Meteo](https://open-meteo.com), licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Apps showing this
data should credit Open-Meteo. Open-Meteo's free API is for non-commercial use.
If FieldWise becomes commercial, it needs their paid plan.
