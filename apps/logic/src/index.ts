// FieldWise logic layer (Cloudflare Worker).
//
// An hourly cron checks every farm's forecast through the weather API, raises
// flags when conditions change, and sends reminders. Farmers' replies come in
// through /inbound (the simulator and, later, the WhatsApp webhook).
//
// Every route but /health needs the admin token, because the data includes
// farmers' names and phone numbers.

import { inBounds } from "../../api/src/cells";
import { apply, runChecks, scenarioAssessment, weatherApi, type ScenarioWeather } from "./checks";
import { Conversations, newId } from "./conversation";
import { Outbox } from "./outbox";
import { CROPS, DISEASES, QUESTIONNAIRES, type Crop, type DiseaseId, type Lang } from "./questionnaires";
import { Store, type Farmer } from "./store";

export interface Env {
  DB: D1Database;
  WEATHER_API: string;
  ADMIN_TOKEN?: string;
}

interface App {
  store: Store;
  conversations: Conversations;
  now: () => Date;
}

function app(env: Env, now: () => Date = () => new Date()): App {
  const store = new Store(env.DB);
  return { store, conversations: new Conversations(store, new Outbox(store, now), now), now };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });
    const url = new URL(request.url);
    if (url.pathname === "/health") return json({ status: "ok" });
    if (!authorized(request, env)) return error(401, "Missing or wrong admin token.");
    try {
      return await route(request, url, env, app(env));
    } catch (err) {
      console.error("Request failed", err);
      return error(500, "Something went wrong. Try again shortly.");
    }
  },

  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    const { store, conversations, now } = app(env);
    const results = await runChecks(store, conversations, weatherApi(env.WEATHER_API), now());
    const swept = await conversations.sweep();
    const alerts = results.filter((r) => r.alert).length;
    const failed = results.filter((r) => r.error).length;
    console.log(`Checked ${results.length} farm diseases: ${alerts} alerts, ${failed} failed; swept ${JSON.stringify(swept)}`);
  },
} satisfies ExportedHandler<Env>;

async function route(request: Request, url: URL, env: Env, { store, conversations, now }: App): Promise<Response> {
  const parts = url.pathname.split("/").filter(Boolean);
  const method = request.method;

  if (parts[0] === "farmers") {
    if (parts.length === 1 && method === "GET") return json({ farmers: await store.listFarmers() });
    if (parts.length === 1 && method === "POST") return addFarmer(request, store, now);
    const farmer = parts[1] ? await store.getFarmer(parts[1]) : null;
    if (!farmer) return error(404, "No farmer with that id.");
    if (parts.length === 2 && method === "GET") return json({ farmer, flags: await flagsWithSessions(store, farmer.id) });
    if (parts.length === 3 && parts[2] === "messages" && method === "GET") {
      return json({ farmer: farmer.id, messages: await store.listMessages(farmer.id) });
    }
  }

  if (url.pathname === "/flags" && method === "GET") return json({ flags: await flagsWithSessions(store) });

  if (url.pathname === "/flags" && method === "POST") {
    const body = await readJson(request);
    if (body instanceof Response) return body;
    const farmer = typeof body.farmer_id === "string" ? await store.getFarmer(body.farmer_id) : null;
    if (!farmer) return error(400, "farmer_id must be an existing farmer.");
    const disease = body.disease as DiseaseId;
    if (!DISEASES.includes(disease)) return error(400, `disease must be one of ${DISEASES.join(", ")}.`);
    if (QUESTIONNAIRES[disease].crop !== farmer.crop) return error(400, `${disease} is not a ${farmer.crop} disease.`);
    const flag = await conversations.raise(farmer, disease, "manual", "manual", {});
    return json({ flag }, 201);
  }

  if (url.pathname === "/checks/run" && method === "POST") {
    const results = await runChecks(store, conversations, weatherApi(env.WEATHER_API), now());
    return json({ results });
  }

  if (url.pathname === "/demo/scenario" && method === "POST") {
    const body = await readJson(request);
    if (body instanceof Response) return body;
    const weather = body.weather as ScenarioWeather;
    if (weather !== "wet" && weather !== "dry") return error(400, 'weather must be "wet" or "dry".');
    let farmers = await store.listFarmers();
    if (body.farmer_id !== undefined) farmers = farmers.filter((f) => f.id === body.farmer_id);
    if (!farmers.length) return error(404, "No farmer with that id.");
    const results = [];
    for (const farmer of farmers) {
      results.push(...(await apply(store, conversations, farmer, scenarioAssessment(farmer, weather, now()), "scenario", now())));
    }
    return json({ weather, results });
  }

  if (url.pathname === "/inbound" && method === "POST") {
    const body = await readJson(request);
    if (body instanceof Response) return body;
    const phone = typeof body.phone === "string" ? normalizePhone(body.phone) : null;
    if (!phone || typeof body.text !== "string") return error(400, "Pass phone and text.");
    return json({ replies: await conversations.inbound(phone, body.text) });
  }

  if (url.pathname === "/sweep" && method === "POST") return json(await conversations.sweep());

  return error(404, "Not found.");
}

async function addFarmer(request: Request, store: Store, now: () => Date): Promise<Response> {
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const { name, farm_name, crop, latitude, longitude, lang, channel } = body;
  const phone = typeof body.phone === "string" ? normalizePhone(body.phone) : null;
  if (typeof name !== "string" || !name.trim()) return error(400, "name is required.");
  if (!phone) return error(400, "phone must be a full number, like +265991234567 or 0991234567.");
  if (!CROPS.includes(crop as Crop)) return error(400, `crop must be one of ${CROPS.join(", ")}.`);
  if (typeof latitude !== "number" || typeof longitude !== "number" || !inBounds(latitude, longitude)) {
    return error(400, "latitude and longitude must be numbers inside Malawi.");
  }
  if (lang !== undefined && lang !== null && lang !== "en" && lang !== "ny") return error(400, 'lang must be "en" or "ny".');
  if (channel !== undefined && channel !== "whatsapp" && channel !== "sim") return error(400, 'channel must be "whatsapp" or "sim".');
  if (await store.getFarmerByPhone(phone)) return error(409, "A farmer with that phone number already exists.");

  const farmer: Farmer = {
    id: newId("frm"),
    name: name.trim(),
    farm_name: typeof farm_name === "string" ? farm_name.trim() : null,
    phone,
    crop: crop as Crop,
    latitude,
    longitude,
    lang: (lang as Lang | undefined) ?? null,
    channel: (channel as Farmer["channel"] | undefined) ?? "whatsapp",
    created_at: now().toISOString(),
  };
  await store.addFarmer(farmer);
  return json({ farmer }, 201);
}

async function flagsWithSessions(store: Store, farmerId?: string) {
  const flags = await store.listFlags(farmerId);
  return Promise.all(
    flags.map(async (flag) => {
      const session = await store.getSessionByFlag(flag.id);
      return {
        ...flag,
        session: session && {
          id: session.id,
          status: session.status,
          step: session.state.step,
          answers: session.state.answers,
          started_at: session.started_at,
          last_activity_at: session.last_activity_at,
          reminded_at: session.reminded_at,
          completed_at: session.completed_at,
          report: session.report,
        },
      };
    }),
  );
}

/** E.164 with a +, or a Malawi number starting 0 (0991234567 -> +265991234567). */
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/[\s()-]/g, "");
  const phone = /^0\d{9}$/.test(digits) ? `+265${digits.slice(1)}` : digits;
  return /^\+\d{8,15}$/.test(phone) ? phone : null;
}

function authorized(request: Request, env: Env): boolean {
  // No token configured means no access, not open access.
  if (!env.ADMIN_TOKEN) return false;
  const given = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  return constantTimeEqual(given, env.ADMIN_TOKEN);
}

function constantTimeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

async function readJson(request: Request): Promise<Record<string, unknown> | Response> {
  try {
    const body = await request.json();
    if (body && typeof body === "object" && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch {
    // Falls through to the error below.
  }
  return error(400, "Send a JSON object.");
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    // Farmer data is private and changes with every reply.
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...corsHeaders() },
  });
}

function error(status: number, message: string): Response {
  return json({ error: message }, status);
}
