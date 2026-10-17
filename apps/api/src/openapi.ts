// OpenAPI 3.1 description of the API, served at /openapi.json and rendered by
// Swagger UI at /docs. Keep it in step with the routes in index.ts.

import { FORECAST_DAYS } from "./openmeteo";

const locationParams = [
  {
    name: "location",
    in: "query",
    description: "A named place. Use this or `lat` and `lon`.",
    schema: { type: "string", enum: ["kasungu"] },
    example: "kasungu",
  },
  {
    name: "lat",
    in: "query",
    description:
      "Latitude of any point in Malawi, such as a farm, for example `-13.08`. Snapped to the nearest 0.1° grid cell (about 11 km). Use with `lon`, and leave `location` empty.",
    schema: { type: "number", minimum: -17.2, maximum: -9.3 },
  },
  {
    name: "lon",
    in: "query",
    description: "Longitude, used with `lat`, for example `33.46`.",
    schema: { type: "number", minimum: 32.6, maximum: 36.0 },
  },
];

const windowParams = [
  { name: "hours", in: "query", description: "Hours to include, starting with the current hour.", schema: { type: "integer", minimum: 1, maximum: 24 * FORECAST_DAYS, default: 48 } },
  { name: "past_hours", in: "query", description: "Extra hours before now to include.", schema: { type: "integer", minimum: 0, maximum: 2160, default: 0 } },
];

const errorResponses = {
  "400": { $ref: "#/components/responses/BadRequest" },
  "404": { $ref: "#/components/responses/NotFound" },
  "502": { $ref: "#/components/responses/UpstreamFailed" },
  "503": { $ref: "#/components/responses/CellLimit" },
};

const headerFields = {
  location: { $ref: "#/components/schemas/Location" },
  timezone: { type: "string", const: "Africa/Blantyre" },
  fetched_at: {
    type: "string",
    format: "date-time",
    description: "When Open-Meteo was last called for this cell (UTC). Over about 2 hours old means the hourly refresh is failing.",
  },
  source: { type: "string", example: "Open-Meteo (open-meteo.com), model data" },
};

export const openapi = {
  openapi: "3.1.0",
  info: {
    title: "FieldWise weather API",
    version: "1.0.0",
    description: [
      "Weather and crop-disease risk for farms in Malawi.",
      "",
      "- Data comes from [Open-Meteo](https://open-meteo.com) (CC BY 4.0) and is refreshed every hour.",
      "- All dates and times are Malawi local time (`Africa/Blantyre`, UTC+2), except `fetched_at`, which is UTC.",
      "- Successful responses may be reused for 5 minutes (`Cache-Control: public, max-age=300`).",
      "- The first request for a new grid cell fetches it from Open-Meteo, which adds about a second.",
      "- The disease risk is decision support from weather alone, not a diagnosis.",
    ].join("\n"),
  },
  servers: [{ url: "/", description: "This server" }],
  // Public, read-only API: no authentication.
  security: [],
  tags: [
    { name: "Weather", description: "Stored forecast and recent weather" },
    { name: "Risk", description: "Crop disease risk from weather" },
    { name: "Soil", description: "Soil pH, texture and drainage" },
    { name: "Service", description: "Health and coverage" },
  ],
  paths: {
    "/weather/daily": {
      get: {
        tags: ["Weather"],
        summary: "Daily weather summaries",
        description: "One row per local day, starting today. Rows can also include past days.",
        operationId: "getDailyWeather",
        parameters: [
          ...locationParams,
          { name: "days", in: "query", description: "Days to return, starting today.", schema: { type: "integer", minimum: 1, maximum: 7, default: 7 } },
          { name: "past_days", in: "query", description: "Extra days before today to include.", schema: { type: "integer", minimum: 0, maximum: 730, default: 0 } },
        ],
        responses: {
          "200": {
            description: "Daily rows",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["location", "timezone", "fetched_at", "source", "daily"],
                  properties: { ...headerFields, daily: { type: "array", items: { $ref: "#/components/schemas/Day" } } },
                },
              },
            },
          },
          ...errorResponses,
        },
      },
    },
    "/weather/hourly": {
      get: {
        tags: ["Weather"],
        summary: "Hourly weather",
        description: "One row per hour, starting with the current hour.",
        operationId: "getHourlyWeather",
        parameters: [...locationParams, ...windowParams],
        responses: {
          "200": {
            description: "Hourly rows",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["location", "timezone", "fetched_at", "source", "hourly"],
                  properties: { ...headerFields, hourly: { type: "array", items: { $ref: "#/components/schemas/Hour" } } },
                },
              },
            },
          },
          ...errorResponses,
        },
      },
    },
    "/weather/window": {
      get: {
        tags: ["Weather"],
        summary: "Weather summary over a time window",
        description:
          "Summaries over the chosen hours, for rules like \"leaves wet ≥ 10 h\". Durations (`*_run_max`) are the longest unbroken run of hours. " +
          "An hour counts as leaf-wet when Open-Meteo's leaf wetness probability is at least 50%, and humid when RH is at least 90%.",
        operationId: "getWeatherWindow",
        parameters: [...locationParams, ...windowParams],
        responses: {
          "200": {
            description: "Window summary",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["location", "timezone", "fetched_at", "source", "window"],
                  properties: { ...headerFields, window: { $ref: "#/components/schemas/WindowMetrics" } },
                },
              },
            },
          },
          ...errorResponses,
        },
      },
    },
    "/soil": {
      get: {
        tags: ["Soil"],
        summary: "Soil pH, texture and drainage for a farm",
        description:
          "From ISRIC SoilGrids (250 m), averaged over the top 30 cm. Points are rounded to 0.01° (about 1 km). " +
          "The first request for a point takes 5-15 s; after that it is stored. Drainage is estimated from texture, not measured.",
        operationId: "getSoil",
        parameters: locationParams,
        responses: {
          "200": {
            description: "Soil",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["point", "latitude", "longitude", "fetched_at", "soil", "source"],
                  properties: {
                    point: { type: "string", example: "-13.08_33.46" },
                    latitude: { type: "number", example: -13.08 },
                    longitude: { type: "number", example: 33.46 },
                    fetched_at: { type: "string", format: "date-time" },
                    soil: { $ref: "#/components/schemas/Soil" },
                    source: { type: "string" },
                  },
                },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "404": { description: "Unknown location name, or SoilGrids has no data for this point (water, town or rock)", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          "502": { description: "SoilGrids couldn't be reached. Try again shortly.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          "503": { description: "The soil point limit is reached", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
    },
    "/assess": {
      get: {
        tags: ["Risk"],
        summary: "Crop disease checks (decision tree)",
        description: [
          "Runs the FieldWise decision tree for each crop over the chosen window:",
          "",
          "| Crop | Disease | Branch | Conditions |",
          "|---|---|---|---|",
          "| Tomato | Late blight | weather | air temp 16-21 °C, leaves wet ≥ 10 h |",
          "| Tomato | Bacterial wilt | soil | soil temp 29-35 °C, drainage poor |",
          "| Maize | Maize leaf blights | weather | air temp 18-32 °C, wet or RH ≥ 90% for ≥ 12 h |",
          "| Beans | Bean leaf diseases | weather | air temp 16-29 °C, leaves wet ≥ 10 h (≥ 24 h adds angular spot) |",
          "| Cabbage | Black rot | weather | air temp 25-35 °C, RH ≥ 90%, rain in forecast |",
          "| Cabbage | Clubroot | soil | soil temp 18-25 °C, pH ≤ 7.0, drainage poor |",
          "",
          "All conditions met: `flag` (SMS the farmer). One short: `watch` (no SMS; re-test on the next forecast). Otherwise `clear`.",
          "Temperatures use the window mean; durations use the longest unbroken run. Missing soil counts as not met, and `complete` is false.",
        ].join("\n"),
        operationId: "assess",
        parameters: [
          ...locationParams,
          { name: "crop", in: "query", description: "Comma-separated crops to check. Default: all.", schema: { type: "string", default: "tomato,maize,beans,cabbage" }, example: "maize,beans" },
          ...windowParams,
        ],
        responses: {
          "200": {
            description: "Assessment",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["location", "timezone", "fetched_at", "source", "window", "soil", "any_flag", "results", "note"],
                  properties: {
                    ...headerFields,
                    window: { $ref: "#/components/schemas/WindowMetrics" },
                    soil: {
                      description: "Null when no soil-branch crop was asked for; `{ error }` when soil couldn't be fetched.",
                      oneOf: [{ $ref: "#/components/schemas/Soil" }, { $ref: "#/components/schemas/Error" }, { type: "null" }],
                    },
                    any_flag: { type: "boolean", description: "True if any disease is `flag`: send the SMS." },
                    results: { type: "array", items: { $ref: "#/components/schemas/AssessResult" } },
                    note: { type: "string" },
                  },
                },
              },
            },
          },
          ...errorResponses,
        },
      },
    },
    "/risk": {
      get: {
        tags: ["Risk"],
        summary: "Crop disease risk for today and the next 6 days",
        description:
          "Maize (gray leaf spot, leaf blight) and groundnut (leaf spot). Each day scores 1 point each for 6+ hours above 90% humidity, " +
          "any rain, and a mean temperature of 18-27 °C. The 7-day total gives the level: 0-7 low, 8-12 medium, 13-21 high.",
        operationId: "getRisk",
        parameters: locationParams,
        responses: {
          "200": {
            description: "Risk outlook",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["location", "timezone", "fetched_at", "source", "crops", "rule", "note", "today", "outlook"],
                  properties: {
                    ...headerFields,
                    crops: { type: "array", items: { type: "string" }, example: ["maize", "groundnut"] },
                    rule: { type: "string", description: "The scoring rule, in words." },
                    note: { type: "string" },
                    today: { oneOf: [{ $ref: "#/components/schemas/RiskDay" }, { type: "null" }], description: "Null if today's score isn't available yet." },
                    outlook: { type: "array", items: { $ref: "#/components/schemas/RiskDay" }, description: "Up to 7 days, starting today." },
                  },
                },
              },
            },
          },
          ...errorResponses,
        },
      },
    },
    "/locations": {
      get: {
        tags: ["Service"],
        summary: "Named places and tracked grid cells",
        operationId: "getLocations",
        responses: {
          "200": {
            description: "Coverage",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["named", "cells"],
                  properties: {
                    named: { type: "array", items: { type: "string" }, example: ["kasungu"] },
                    cells: { type: "array", items: { $ref: "#/components/schemas/TrackedCell" } },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/health/live": {
      get: {
        tags: ["Service"],
        summary: "Is the API up?",
        operationId: "getHealth",
        responses: {
          "200": {
            description: "The API is running",
            content: {
              "application/json": {
                schema: { type: "object", required: ["status"], properties: { status: { type: "string", const: "ok" } } },
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      Location: {
        type: "object",
        required: ["cell", "latitude", "longitude"],
        properties: {
          cell: { type: "string", description: "Grid cell ID, `<lat>_<lon>` to 1 decimal place.", example: "-13.0_33.5" },
          name: { type: "string", description: "Only present for named places.", example: "kasungu" },
          latitude: { type: "number", example: -13 },
          longitude: { type: "number", example: 33.5 },
        },
      },
      TrackedCell: {
        type: "object",
        required: ["cell", "latitude", "longitude", "fetched_at"],
        properties: {
          cell: { type: "string", example: "-13.0_33.5" },
          name: { type: "string", example: "kasungu" },
          latitude: { type: "number", example: -13 },
          longitude: { type: "number", example: 33.5 },
          fetched_at: { type: ["string", "null"], format: "date-time" },
        },
      },
      Day: {
        type: "object",
        description: "A field is left out when Open-Meteo had no value for it. risk_7d and risk_level need 7 days of data before the day.",
        required: ["date"],
        properties: {
          date: { type: "string", format: "date", example: "2026-10-17" },
          precipitation_sum: { type: "number", description: "mm", example: 0.7 },
          rain_sum: { type: "number", description: "mm", example: 0.7 },
          relative_humidity_2m_mean: { type: "number", description: "%", example: 49.21 },
          humid_hours: { type: "integer", description: "Hours with humidity above 90%", example: 0 },
          leaf_wetness_probability_mean: { type: "number", description: "%", example: 1.71 },
          temperature_2m_mean: { type: "number", description: "°C at 2 m", example: 23.91 },
          temperature_2m_min: { type: "number", description: "°C", example: 19.8 },
          temperature_2m_max: { type: "number", description: "°C", example: 28.4 },
          soil_temperature_6cm_mean: { type: "number", description: "°C at 6 cm depth", example: 27.34 },
          soil_temperature_6cm_min: { type: "number", description: "°C", example: 22.7 },
          soil_temperature_6cm_max: { type: "number", description: "°C", example: 33.1 },
          disease_score: { type: "integer", minimum: 0, maximum: 3, description: "That day's points under the risk rule", example: 2 },
          risk_7d: { type: "integer", minimum: 0, maximum: 21, description: "Sum of the last 7 days' disease_score", example: 8 },
          risk_level: { $ref: "#/components/schemas/RiskLevel" },
        },
      },
      Hour: {
        type: "object",
        description: "A field is left out when Open-Meteo had no value for it.",
        required: ["time"],
        properties: {
          time: { type: "string", description: "Local time, YYYY-MM-DDTHH:MM", example: "2026-10-17T14:00" },
          temperature_2m: { type: "number", description: "°C", example: 27.4 },
          relative_humidity_2m: { type: "number", description: "%", example: 38 },
          precipitation: { type: "number", description: "mm in that hour", example: 0 },
          rain: { type: "number", description: "mm in that hour", example: 0 },
          soil_temperature_6cm: { type: "number", description: "°C", example: 32.8 },
          leaf_wetness_probability: { type: "number", description: "%", example: 0 },
        },
      },
      RiskDay: {
        type: "object",
        required: ["date", "risk_7d", "risk_level", "disease_score"],
        properties: {
          date: { type: "string", format: "date", example: "2026-10-17" },
          risk_7d: { type: "integer", minimum: 0, maximum: 21, example: 9 },
          risk_level: { $ref: "#/components/schemas/RiskLevel" },
          disease_score: { type: "integer", minimum: 0, maximum: 3, example: 2 },
        },
      },
      RiskLevel: { type: "string", enum: ["low", "medium", "high"], example: "medium" },
      WindowMetrics: {
        type: "object",
        properties: {
          start: { type: ["string", "null"], description: "First hour in the window (local)", example: "2026-10-17T04:00" },
          end: { type: ["string", "null"], description: "Last hour in the window (local)", example: "2026-10-19T03:00" },
          hours: { type: "integer", example: 48 },
          air_temp_mean: { type: ["number", "null"], description: "°C", example: 24.84 },
          air_temp_min: { type: ["number", "null"], description: "°C" },
          air_temp_max: { type: ["number", "null"], description: "°C" },
          soil_temp_mean: { type: ["number", "null"], description: "°C at 6 cm", example: 27.99 },
          soil_temp_min: { type: ["number", "null"], description: "°C" },
          soil_temp_max: { type: ["number", "null"], description: "°C" },
          rh_max: { type: ["number", "null"], description: "Highest relative humidity, %" },
          humid_hours: { type: "integer", description: "Hours with RH ≥ 90%" },
          humid_run_max: { type: "integer", description: "Longest unbroken run of hours with RH ≥ 90%" },
          leaf_wet_hours: { type: "integer", description: "Hours with leaf wetness probability ≥ 50%" },
          leaf_wet_run_max: { type: "integer", description: "Longest unbroken run of leaf-wet hours" },
          wet_or_humid_run_max: { type: "integer", description: "Longest unbroken run of hours that are leaf-wet or RH ≥ 90%" },
          rain_total: { type: "number", description: "mm over the window" },
          rain_hours: { type: "integer", description: "Hours with any precipitation" },
        },
      },
      Soil: {
        type: "object",
        required: ["ph", "clay_pct", "sand_pct", "silt_pct", "drainage", "drainage_basis"],
        properties: {
          ph: { type: "number", description: "pH in water, top 30 cm", example: 6.5 },
          clay_pct: { type: "number", example: 16.3 },
          sand_pct: { type: "number", example: 75.6 },
          silt_pct: { type: "number", example: 8.2 },
          drainage: { type: "string", enum: ["poor", "moderate", "good"], description: "Clay ≥ 35% is poor; clay ≥ 20% with sand < 50% is moderate; otherwise good." },
          drainage_basis: { type: "string" },
        },
      },
      AssessResult: {
        type: "object",
        required: ["crop", "disease", "name", "branch", "status", "complete", "ask", "conditions"],
        properties: {
          crop: { type: "string", enum: ["tomato", "maize", "beans", "cabbage"] },
          disease: { type: "string", example: "maize_leaf_blights" },
          name: { type: "string", example: "Maize leaf blights" },
          branch: { type: "string", enum: ["weather", "soil"] },
          status: { type: "string", enum: ["flag", "watch", "clear"] },
          complete: { type: "boolean", description: "False if any condition's data was missing" },
          ask: { type: "string", description: "Question to confirm the disease with the farmer", example: "Are there rectangle or cigar-shaped spots on the leaves?" },
          note: { type: "string", description: "Extra detail, only on some flags" },
          conditions: {
            type: "array",
            items: {
              type: "object",
              required: ["condition", "value", "met"],
              properties: {
                condition: { type: "string", example: "Air temp 18-32 °C (window mean)" },
                value: { type: ["number", "string", "null"], example: 24.84 },
                met: { type: ["boolean", "null"], description: "Null when the data is missing" },
              },
            },
          },
        },
      },
      Error: {
        type: "object",
        required: ["error"],
        properties: { error: { type: "string", example: "Pass lat and lon, or location." } },
      },
    },
    responses: {
      BadRequest: {
        description: "No location given, lat/lon not numbers, point outside Malawi, or a parameter out of range",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
      },
      NotFound: {
        description: "Unknown location name",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
      },
      UpstreamFailed: {
        description: "A new cell's first fetch from Open-Meteo failed. Try again shortly.",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
      },
      CellLimit: {
        description: "The tracked-cell limit is reached",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
      },
    },
  },
};

// Swagger UI loaded from a CDN, pinned to an exact version.
const SWAGGER_UI = "https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.17.14";

export const docsPage = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>FieldWise API docs</title>
  <link rel="stylesheet" href="${SWAGGER_UI}/swagger-ui.css">
  <style>body { margin: 0; } .swagger-ui .topbar { display: none; }</style>
</head>
<body>
  <div id="docs"></div>
  <script src="${SWAGGER_UI}/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({ url: "/openapi.json", dom_id: "#docs", deepLinking: true, tryItOutEnabled: true });
  </script>
</body>
</html>`;
