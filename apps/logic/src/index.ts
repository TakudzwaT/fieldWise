// FieldWise logic layer (Cloudflare Worker).
//
// An hourly cron checks every farm's forecast through the weather API, raises
// flags when conditions change, and sends reminders. Farmers' replies come in
// through /inbound (the simulator), /whatsapp (Meta's webhook) and /ussd
// (Africa's Talking's USSD callback).
//
// Every data route needs a token, because the data includes farmers' names
// and phone numbers: the admin token for everything, or an officer's token
// for that officer's own farmers (the Felix app). /health and the pages
// (/demo, /dashboard, /sim, /phone, /officer) are open; the pages ask for the
// admin token.

import { inBounds } from "../../api/src/cells";
import { apply, runChecks, scenarioAssessment, weatherApi, type ScenarioWeather } from "./checks";
import { Conversations, newId } from "./conversation";
import { priorityList, summary } from "./felix";
import { ADVICE, adviceText, officerText, type AdviceId } from "./messages";
import { dashboardPage, demoPage, featurePhonePage, officerPage, simulatorPage } from "./pages";
import { Outbox } from "./outbox";
import { DISEASES, type DiseaseId, type Lang } from "./questionnaires";
import { normalizePhone } from "./phone";
import { smsConfig, smsDeliver, type SmsEnv } from "./sms";
import { Store, type Farmer, type FlagRow, type Officer } from "./store";
import { handleUssd, parseUssd, pushFallbacks, SESSION_KEEP_MS, ussdPusher } from "./ussd";
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

export interface Env extends WhatsAppEnv, SmsEnv {
  DB: D1Database;
  WEATHER_API: string;
  ADMIN_TOKEN?: string;
  /** Africa's Talking calls /ussd?key=<USSD_KEY>; it doesn't sign its requests. */
  USSD_KEY?: string;
}

interface App {
  store: Store;
  conversations: Conversations;
  outbox: Outbox;
  now: () => Date;
  whatsapp: ReturnType<typeof whatsappConfig>;
}

/** Who is calling: the admin (everything), or an officer (their own farmers). */
type Principal = { kind: "admin" } | { kind: "officer"; officer: Officer };

function app(env: Env, now: () => Date = () => new Date(), fetchFn: typeof fetch = fetch): App {
  const store = new Store(env.DB);
  const whatsapp = whatsappConfig(env);
  const sms = smsConfig(env);
  const outbox = new Outbox(
    store,
    now,
    {
      ...(whatsapp ? { whatsapp: whatsappDeliver(whatsapp, fetchFn) } : {}),
      ...(sms ? { ussd: smsDeliver(sms, fetchFn) } : {}),
    },
    async (farmer, err) => {
      if (err instanceof WhatsAppError && err.code === OUTSIDE_WINDOW) await templateFallback(whatsapp, store, farmer, now(), fetchFn);
    },
    // No push gateway is wired up yet, so only demo farmers' pushes happen (simulated).
    ussdPusher(store, now),
  );
  return { store, conversations: new Conversations(store, outbox, now), outbox, now, whatsapp };
}

export default {
  async fetch(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });
    const url = new URL(request.url);
    if (url.pathname === "/health") return json({ status: "ok" });
    // Meta calls this; it is checked by signature, not the admin token.
    if (url.pathname === "/whatsapp") return whatsappRoute(request, url, env, ctx);
    // Africa's Talking calls this with ?key=; the feature-phone page uses the admin token.
    if (url.pathname === "/ussd") return ussdRoute(request, url, env);
    // The pages hold no data; they ask for the admin token and then call the routes below.
    if (request.method === "GET") {
      if (url.pathname === "/" || url.pathname === "/demo") return html(demoPage);
      if (url.pathname === "/dashboard") return html(dashboardPage);
      if (url.pathname === "/sim") return html(simulatorPage);
      if (url.pathname === "/phone") return html(featurePhonePage);
      if (url.pathname === "/officer") return html(officerPage);
    }
    try {
      const context = app(env);
      const who = await principal(request, env, context.store);
      if (!who) return error(401, "Missing or wrong token.");
      return await route(request, url, env, context, who);
    } catch (err) {
      console.error("Request failed", err);
      return error(500, "Something went wrong. Try again shortly.");
    }
  },

  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    const { store, conversations, outbox, now } = app(env);
    const results = await runChecks(store, conversations, weatherApi(env.WEATHER_API), now());
    const swept = { ...(await conversations.sweep()), pushFallbacks: await pushFallbacks(store, outbox, now) };
    await store.pruneUssdSessions(new Date(now().getTime() - SESSION_KEEP_MS).toISOString());
    const alerts = results.filter((r) => r.alert).length;
    const failed = results.filter((r) => r.error).length;
    console.log(`Checked ${results.length} farm diseases: ${alerts} alerts, ${failed} failed; swept ${JSON.stringify(swept)}`);
  },
} satisfies ExportedHandler<Env>;

async function route(request: Request, url: URL, env: Env, { store, conversations, outbox, now }: App, who: Principal): Promise<Response> {
  const parts = url.pathname.split("/").filter(Boolean);
  const method = request.method;
  // An officer sees only their own farmers; the admin sees everyone.
  const scope = who.kind === "officer" ? who.officer.id : undefined;
  const mine = (farmer: Farmer | null) => (farmer && (!scope || farmer.officer_id === scope) ? farmer : null);

  if (url.pathname === "/me" && method === "GET") return json(who.kind === "officer" ? { role: "officer", officer: who.officer } : { role: "admin" });

  if (parts[0] === "farmers") {
    if (parts.length === 1 && method === "GET") return json({ farmers: await store.listFarmers(scope) });
    if (parts.length === 1 && method === "POST") return scope ? forbidden() : addFarmer(request, store, now);
    const farmer = mine(parts[1] ? await store.getFarmer(parts[1]) : null);
    if (!farmer) return error(404, "No farmer with that id.");
    if (parts.length === 2 && method === "GET") return json({ farmer, flags: flagsView(await store.flagRows({ farmerId: farmer.id })) });
    if (parts.length === 3 && parts[2] === "messages" && method === "GET") {
      return json({ farmer: farmer.id, messages: await store.listMessages(farmer.id) });
    }
    if (parts.length === 3 && parts[2] === "messages" && method === "POST") {
      const body = await readJson(request);
      if (body instanceof Response) return body;
      const sent = await officerMessage(farmer, body, store, outbox, scope);
      return sent instanceof Response ? sent : json({ sent }, 201);
    }
  }

  if (url.pathname === "/flags" && method === "GET") return json({ flags: flagsView(await store.flagRows({ officerId: scope })) });

  if (parts[0] === "felix" && parts.length === 2 && method === "GET" && (parts[1] === "priority" || parts[1] === "summary")) {
    const days = url.searchParams.has("days") ? Number(url.searchParams.get("days")) : 14;
    if (!Number.isInteger(days) || days < 1 || days > 90) return error(400, "days must be a whole number from 1 to 90.");
    const rows = await store.flagRows({ since: new Date(now().getTime() - days * 86_400_000).toISOString(), officerId: scope });
    if (parts[1] === "priority") {
      return json({ days, generated_at: now().toISOString(), farms: priorityList(rows), callbacks: await store.openCallbacks(scope) });
    }
    return json({ days, generated_at: now().toISOString(), ...summary(rows, (await store.listFarmers(scope)).length) });
  }

  if (url.pathname === "/felix/advice" && method === "GET") {
    return json({ advice: Object.entries(ADVICE).map(([id, a]) => ({ id, label: a.label, text: a.text })) });
  }

  if (url.pathname === "/felix/callbacks" && method === "GET") return json({ callbacks: await store.openCallbacks(scope) });

  if (parts[0] === "felix" && parts[1] === "callbacks" && parts.length === 4 && parts[3] === "done" && method === "POST") {
    const callback = await store.getCallback(parts[2]);
    if (!callback || !mine(await store.getFarmer(callback.farmer_id))) return error(404, "No call-back request with that id.");
    const closed = await store.closeCallback(callback.id, now().toISOString(), scope ?? "admin");
    return json({ done: true, already: !closed });
  }

  if (url.pathname === "/felix/broadcast" && method === "POST") {
    const body = await readJson(request);
    if (body instanceof Response) return body;
    let farmers = await store.listFarmers(scope);
    if (body.farmer_ids !== undefined) {
      if (!Array.isArray(body.farmer_ids) || !body.farmer_ids.every((id) => typeof id === "string")) return error(400, "farmer_ids must be a list of ids.");
      const ids = new Set(body.farmer_ids as string[]);
      farmers = farmers.filter((f) => ids.has(f.id));
    }
    if (!farmers.length) return error(400, "No farmers to message.");
    // Each message is about one D1 batch; this keeps a request inside the free plan.
    if (farmers.length > 40) return error(400, "Message at most 40 farmers at a time.");
    let sent = 0;
    for (const farmer of farmers) {
      const result = await officerMessage(farmer, body, store, outbox, scope);
      if (result instanceof Response) return result;
      sent++;
    }
    return json({ sent });
  }

  if (parts[0] === "officers") {
    if (scope) return forbidden();
    if (parts.length === 1 && method === "GET") return json({ officers: await store.listOfficers() });
    if (parts.length === 1 && method === "POST") return addOfficer(request, store, now);
    if (parts.length === 3 && parts[2] === "token" && method === "POST") {
      const officer = await store.getOfficer(parts[1]);
      if (!officer) return error(404, "No officer with that id.");
      // Shown once; only the hash is kept.
      const token = `fw_${hex(crypto.getRandomValues(new Uint8Array(24)))}`;
      await store.setOfficerToken(officer.id, await sha256(token));
      return json({ officer, token }, 201);
    }
  }

  if (url.pathname === "/flags" && method === "POST") {
    const body = await readJson(request);
    if (body instanceof Response) return body;
    const farmer = mine(typeof body.farmer_id === "string" ? await store.getFarmer(body.farmer_id) : null);
    if (!farmer) return error(400, "farmer_id must be an existing farmer.");
    const disease = body.disease as DiseaseId;
    if (!DISEASES.includes(disease)) return error(400, `disease must be one of ${DISEASES.join(", ")}.`);
    const [flag] = await conversations.raise(farmer, [{ disease, reason: "manual", source: "manual", details: {} }]);
    return json({ flag }, 201);
  }

  // Everything below runs the system or the demo: the admin only.
  if (scope) return forbidden();

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
    const assessment = scenarioAssessment(weather, now());
    for (const farmer of farmers) results.push(...(await apply(store, conversations, farmer, assessment, "scenario", now(), tracks)));
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
    const screen = typeof body.screen === "string" && /^(lang|ward|pick|more|s\d)$/.test(body.screen) ? body.screen : undefined;
    return json({ replies: await conversations.inbound(phone, body.text, { screen }) });
  }

  if (url.pathname === "/sweep" && method === "POST") {
    return json({ ...(await conversations.sweep()), pushFallbacks: await pushFallbacks(store, outbox, now) });
  }

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

async function ussdRoute(request: Request, url: URL, env: Env): Promise<Response> {
  if (request.method !== "POST") return error(405, "Use POST.");
  const key = url.searchParams.get("key");
  const byGateway = !!env.USSD_KEY && key !== null && constantTimeEqual(key, env.USSD_KEY);
  const byAdmin = !!env.ADMIN_TOKEN && constantTimeEqual(bearer(request), env.ADMIN_TOKEN);
  if (!byGateway && !byAdmin) return error(401, "Missing or wrong key.");
  let fields: Record<string, unknown>;
  try {
    fields = (request.headers.get("Content-Type") ?? "").includes("application/json")
      ? ((await request.json()) as Record<string, unknown>)
      : Object.fromEntries(new URLSearchParams(await request.text()));
  } catch {
    return error(400, "Send a form or JSON body.");
  }
  const ussd = parseUssd(fields ?? {});
  if (!ussd) return error(400, "Pass sessionId, phoneNumber and text.");
  try {
    const { store, conversations, now } = app(env);
    const reply = await handleUssd(ussd, { store, conversations, now });
    return new Response(reply, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", ...corsHeaders() } });
  } catch (err) {
    console.error("USSD request failed", err);
    // Africa's Talking shows this on the phone.
    return new Response("END FieldWise is not available right now. Please try again later.", { headers: { "Content-Type": "text/plain" } });
  }
}

/** Felix's message to a farmer: his own `text`, or a ready-made `advice` id. Returns the text sent. */
async function officerMessage(
  farmer: Farmer,
  body: Record<string, unknown>,
  store: Store,
  outbox: Outbox,
  scope: string | undefined,
): Promise<string | Response> {
  let text: string;
  if (typeof body.advice === "string") {
    if (!(body.advice in ADVICE)) return error(400, `advice must be one of ${Object.keys(ADVICE).join(", ")}.`);
    text = adviceText(body.advice as AdviceId, farmer.lang);
  } else if (typeof body.text === "string" && body.text.trim()) {
    text = body.text.trim().replace(/\s+/g, " ");
    if (text.length > 300) return error(400, "Keep a message to 300 characters (two text messages).");
  } else {
    return error(400, "Pass text, or an advice id.");
  }
  const officerId = scope ?? farmer.officer_id ?? null;
  const officer = officerId ? await store.getOfficer(officerId) : null;
  const message = officerText(officer?.name ?? "Your extension officer", text);
  await outbox.send(farmer, [message], { officerId: officerId ?? "admin" });
  return message;
}

async function addOfficer(request: Request, store: Store, now: () => Date): Promise<Response> {
  const body = await readJson(request);
  if (body instanceof Response) return body;
  if (typeof body.name !== "string" || !body.name.trim()) return error(400, "name is required.");
  const phone = typeof body.phone === "string" ? normalizePhone(body.phone) : null;
  const officer: Officer = {
    id: newId("off"),
    name: body.name.trim(),
    phone,
    area: typeof body.area === "string" ? body.area.trim() : null,
    created_at: now().toISOString(),
  };
  await store.addOfficer(officer);
  return json({ officer }, 201);
}

async function addFarmer(request: Request, store: Store, now: () => Date): Promise<Response> {
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const { name, farm_name, latitude, longitude, lang, channel, officer_id } = body;
  const phone = typeof body.phone === "string" ? normalizePhone(body.phone) : null;
  if (typeof name !== "string" || !name.trim()) return error(400, "name is required.");
  if (!phone) return error(400, "phone must be a full number, like +265991234567 or 0991234567.");
  if (typeof latitude !== "number" || typeof longitude !== "number" || !inBounds(latitude, longitude)) {
    return error(400, "latitude and longitude must be numbers inside Malawi.");
  }
  if (lang !== undefined && lang !== null && lang !== "en" && lang !== "ny") return error(400, 'lang must be "en" or "ny".');
  if (channel !== undefined && channel !== "whatsapp" && channel !== "ussd" && channel !== "sim") {
    return error(400, 'channel must be "whatsapp", "ussd" or "sim".');
  }
  if (officer_id !== undefined && (typeof officer_id !== "string" || !(await store.getOfficer(officer_id)))) {
    return error(400, "officer_id must be an existing officer.");
  }
  if (await store.getFarmerByPhone(phone)) return error(409, "A farmer with that phone number already exists.");

  const farmer: Farmer = {
    id: newId("frm"),
    name: name.trim(),
    farm_name: typeof farm_name === "string" ? farm_name.trim() : null,
    phone,
    latitude,
    longitude,
    lang: (lang as Lang | undefined) ?? null,
    channel: (channel as Farmer["channel"] | undefined) ?? "whatsapp",
    created_at: now().toISOString(),
    demo: 0,
    officer_id: (officer_id as string | undefined) ?? null,
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

function bearer(request: Request): string {
  return request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ?? "";
}

async function principal(request: Request, env: Env, store: Store): Promise<Principal | null> {
  const given = bearer(request);
  // No admin token configured means no admin access, not open access.
  if (env.ADMIN_TOKEN && constantTimeEqual(given, env.ADMIN_TOKEN)) return { kind: "admin" };
  if (!given.startsWith("fw_")) return null;
  const officer = await store.officerByTokenHash(await sha256(given));
  return officer ? { kind: "officer", officer } : null;
}

async function sha256(text: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))));
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function forbidden(): Response {
  return error(403, "Officers can't do that; it needs the admin token.");
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
