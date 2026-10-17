// FieldWise logic layer (Cloudflare Worker).
//
// An hourly cron checks every farm's forecast through the weather API, raises
// flags when conditions change, and sends reminders. Farmers' replies come in
// through /inbound (the simulator and, later, the WhatsApp webhook).
//
// Every data route needs the admin token, because the data includes farmers'
// names and phone numbers. /health and the pages (/demo, /dashboard, /sim) are
// open; the pages ask for the token.

import { inBounds } from "../../api/src/cells";
import { apply, runChecks, scenarioAssessment, weatherApi, type ScenarioWeather } from "./checks";
import { Conversations, newId } from "./conversation";
import { priorityList, summary } from "./felix";
import { dashboardPage, demoPage, officerPage, simulatorPage } from "./pages";
import { Outbox } from "./outbox";
import { CROPS, DISEASES, QUESTIONNAIRES, type Crop, type DiseaseId, type Lang } from "./questionnaires";
import { normalizePhone } from "./phone";
import { Store, type Farmer, type FlagRow } from "./store";
import {
  WhatsAppError,
  OUTSIDE_WINDOW,
  constantTimeEqual,
  parseWebhook,
  processWebhook,
  templateFallback,
  validSignature,
  verifySubscription,
  whatsappConfig,
  whatsappDeliver,
  type WhatsAppEnv,
} from "./whatsapp";

export { normalizePhone };

export interface Env extends WhatsAppEnv {
  DB: D1Database;
  WEATHER_API: string;
  ADMIN_TOKEN?: string;
}

interface App {
  store: Store;
  conversations: Conversations;
  now: () => Date;
  whatsapp: ReturnType<typeof whatsappConfig>;
}

function app(env: Env, now: () => Date = () => new Date(), fetchFn: typeof fetch = fetch): App {
  const store = new Store(env.DB);
  const whatsapp = whatsappConfig(env);
  const outbox = new Outbox(
    store,
    now,
    whatsapp ? { whatsapp: whatsappDeliver(whatsapp, fetchFn) } : {},
    async (farmer, err) => {
      if (err instanceof WhatsAppError && err.code === OUTSIDE_WINDOW) await templateFallback(whatsapp, store, farmer, now(), fetchFn);
    },
  );
  return { store, conversations: new Conversations(store, outbox, now), now, whatsapp };
}

export default {
  async fetch(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });
    const url = new URL(request.url);
    if (url.pathname === "/health") return json({ status: "ok" });
    // Meta calls this; it is checked by signature, not the admin token.
    if (url.pathname === "/whatsapp") return whatsappRoute(request, url, env, ctx);
    // The pages hold no data; they ask for the admin token and then call the routes below.
    if (request.method === "GET") {
      if (url.pathname === "/" || url.pathname === "/demo") return html(demoPage);
      if (url.pathname === "/dashboard") return html(dashboardPage);
      if (url.pathname === "/sim") return html(simulatorPage);
      if (url.pathname === "/officer") return html(officerPage);
    }
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
    if (parts.length === 2 && method === "GET") return json({ farmer, flags: flagsView(await store.flagRows({ farmerId: farmer.id })) });
    if (parts.length === 3 && parts[2] === "messages" && method === "GET") {
      return json({ farmer: farmer.id, messages: await store.listMessages(farmer.id) });
    }
  }

  if (url.pathname === "/flags" && method === "GET") return json({ flags: flagsView(await store.flagRows()) });

  if (parts[0] === "felix" && parts.length === 2 && method === "GET") {
    const days = url.searchParams.has("days") ? Number(url.searchParams.get("days")) : 14;
    if (!Number.isInteger(days) || days < 1 || days > 90) return error(400, "days must be a whole number from 1 to 90.");
    const rows = await store.flagRows({ since: new Date(now().getTime() - days * 86_400_000).toISOString() });
    if (parts[1] === "priority") return json({ days, generated_at: now().toISOString(), farms: priorityList(rows) });
    if (parts[1] === "summary") {
      return json({ days, generated_at: now().toISOString(), ...summary(rows, (await store.listFarmers()).length) });
    }
  }

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
    const tracks = await store.listTracks();
    for (const farmer of farmers) {
      results.push(...(await apply(store, conversations, farmer, scenarioAssessment(farmer, weather, now()), "scenario", now(), tracks)));
    }
    return json({ weather, results });
  }

  if (url.pathname === "/demo/reset" && method === "POST") {
    const body = await readJson(request);
    if (body instanceof Response) return body;
    if (body.confirm !== "reset") return error(400, 'This deletes every flag, answer and message. Send {"confirm": "reset"}.');
    await store.resetActivity();
    return json({ reset: true });
  }

  if (url.pathname === "/inbound" && method === "POST") {
    const body = await readJson(request);
    if (body instanceof Response) return body;
    const phone = typeof body.phone === "string" ? normalizePhone(body.phone) : null;
    if (!phone || typeof body.text !== "string") return error(400, "Pass phone and text.");
    // A button tap from the simulator says which screen its button was on.
    const screen = typeof body.screen === "string" && /^(lang|s\d)$/.test(body.screen) ? body.screen : undefined;
    return json({ replies: await conversations.inbound(phone, body.text, { screen }) });
  }

  if (url.pathname === "/sweep" && method === "POST") return json(await conversations.sweep());

  return error(404, "Not found.");
}

async function whatsappRoute(request: Request, url: URL, env: Env, ctx?: ExecutionContext): Promise<Response> {
  if (request.method === "GET") return verifySubscription(url, env.WHATSAPP_VERIFY_TOKEN);
  if (request.method !== "POST") return error(405, "Use GET or POST.");
  if (!env.WHATSAPP_APP_SECRET) return error(503, "WhatsApp is not configured.");
  const raw = await request.text();
  if (!(await validSignature(raw, request.headers.get("X-Hub-Signature-256"), env.WHATSAPP_APP_SECRET))) {
    return error(401, "Bad signature.");
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return error(400, "Send JSON.");
  }
  const { store, conversations, now, whatsapp } = app(env);
  const work = processWebhook(parseWebhook(body), { store, conversations, config: whatsapp, openJoin: env.WHATSAPP_OPEN_JOIN === "true", now }).catch(
    (err) => console.error("WhatsApp webhook failed", err),
  );
  // Answer Meta at once; it retries anything slow.
  if (ctx) ctx.waitUntil(work);
  else await work;
  return new Response("ok");
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

function flagsView(rows: FlagRow[]) {
  return rows.map(({ flag, session }) => ({
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
  }));
}

function authorized(request: Request, env: Env): boolean {
  // No token configured means no access, not open access.
  if (!env.ADMIN_TOKEN) return false;
  const given = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  return constantTimeEqual(given, env.ADMIN_TOKEN);
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

function html(body: string): Response {
  return new Response(body, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      // Inline scripts and styles only; nothing loads from elsewhere.
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'self'",
      "Referrer-Policy": "no-referrer",
    },
  });
}

function error(status: number, message: string): Response {
  return json({ error: message }, status);
}
