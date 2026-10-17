// WhatsApp through Meta's WhatsApp Cloud API. Setup: docs/whatsapp-setup.md.
//
//   GET  /whatsapp  Meta's one-time webhook check (hub.verify_token).
//   POST /whatsapp  Farmers' messages and delivery receipts. Every call is
//                   checked against the X-Hub-Signature-256 HMAC of the raw
//                   body with the app secret; anything else is refused.
//
// Questions go out as interactive messages with Yes/No reply buttons. Those are
// only allowed within 24 hours of the farmer's last message; outside that,
// WhatsApp fails the message with code 131047, and if a template is
// configured FieldWise sends it instead so the farmer can tap Start.

import type { Prompt } from "./engine";
import { normalizePhone } from "./phone";
import type { Deliver, Outgoing } from "./outbox";
import { NAMED } from "../../api/src/cells";
import { newId, type Conversations } from "./conversation";
import { NOT_REGISTERED } from "./messages";
import { CROP_LABEL, type Crop } from "./questionnaires";
import type { Farmer, Store } from "./store";

export interface WhatsAppEnv {
  WHATSAPP_TOKEN?: string;
  WHATSAPP_PHONE_NUMBER_ID?: string;
  WHATSAPP_APP_SECRET?: string;
  WHATSAPP_VERIFY_TOKEN?: string;
  WHATSAPP_API_VERSION?: string;
  WHATSAPP_TEMPLATE?: string;
  WHATSAPP_TEMPLATE_LANG?: string;
  WHATSAPP_OPEN_JOIN?: string;
}

export interface WhatsAppConfig {
  token: string;
  phoneNumberId: string;
  apiVersion: string;
  template: string | null;
  templateLang: string;
}

/** Outside the 24-hour window: only a template can be sent. */
export const OUTSIDE_WINDOW = 131047;
export const DEFAULT_API_VERSION = "v25.0";
/** Logged bodies of template sends start with this, so they can be found again. */
export const TEMPLATE_PREFIX = "[template ";

// WhatsApp's limits for interactive messages.
const HEADER_MAX = 60;
const BODY_MAX = 1024;
const BUTTON_TITLE_MAX = 20;
const TEXT_MAX = 4096;

/** Sending is configured when there is a token and a phone number id. */
export function whatsappConfig(env: WhatsAppEnv): WhatsAppConfig | null {
  if (!env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID) return null;
  return {
    token: env.WHATSAPP_TOKEN,
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
    apiVersion: env.WHATSAPP_API_VERSION || DEFAULT_API_VERSION,
    template: env.WHATSAPP_TEMPLATE || null,
    templateLang: env.WHATSAPP_TEMPLATE_LANG || "en",
  };
}

export class WhatsAppError extends Error {
  constructor(
    message: string,
    readonly code: number | null,
  ) {
    super(message);
  }
}

/** The WhatsApp message body for one outgoing message. */
export function payload(to: string, message: Outgoing): Record<string, unknown> {
  const base = { messaging_product: "whatsapp", recipient_type: "individual", to: to.replace(/^\+/, "") };
  if (typeof message === "string" || message.options.length === 0 || message.options.length > 3) {
    return { ...base, type: "text", text: { body: clip(plain(message), TEXT_MAX), preview_url: false } };
  }
  const prompt: Prompt = message;
  return {
    ...base,
    type: "interactive",
    interactive: {
      type: "button",
      ...(prompt.header ? { header: { type: "text", text: clip(prompt.header, HEADER_MAX) } } : {}),
      body: { text: clip(prompt.body, BODY_MAX) },
      action: {
        buttons: prompt.options.map((o) => ({ type: "reply", reply: { id: o.reply, title: clip(o.label, BUTTON_TITLE_MAX) } })),
      },
    },
  };
}

/** The template that stands in for an alert outside the 24-hour window. */
export function templatePayload(config: WhatsAppConfig, farmer: Farmer): Record<string, unknown> {
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: farmer.phone.replace(/^\+/, ""),
    type: "template",
    template: {
      name: config.template,
      language: { code: config.templateLang },
      components: [{ type: "body", parameters: [{ type: "text", text: cropWord(farmer.crop) }] }],
    },
  };
}

async function post(config: WhatsAppConfig, body: Record<string, unknown>, fetchFn: typeof fetch): Promise<{ id: string }> {
  const response = await fetchFn(`https://graph.facebook.com/${config.apiVersion}/${config.phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as {
    messages?: { id: string }[];
    error?: { message?: string; code?: number; error_data?: { details?: string } };
  };
  if (!response.ok || !data.messages?.[0]?.id) {
    const code = data.error?.code ?? null;
    const detail = data.error?.error_data?.details ?? data.error?.message ?? `HTTP ${response.status}`;
    throw new WhatsAppError(`WhatsApp ${code ?? response.status}: ${detail}`, code);
  }
  return { id: data.messages[0].id };
}

export function whatsappDeliver(config: WhatsAppConfig, fetchFn: typeof fetch = fetch): Deliver {
  return (farmer, message) => post(config, payload(farmer.phone, message), fetchFn);
}

export async function sendTemplate(
  config: WhatsAppConfig,
  store: Store,
  farmer: Farmer,
  now: Date,
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  const body = `${TEMPLATE_PREFIX}${config.template}] FieldWise: the weather this week can bring problems to your ${cropWord(farmer.crop)}.`;
  let providerId: string | null = null;
  let error: string | null = null;
  try {
    providerId = (await post(config, templatePayload(config, farmer), fetchFn)).id;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  await store.logMessage({
    farmer_id: farmer.id,
    direction: "out",
    channel: "whatsapp",
    body,
    at: now.toISOString(),
    status: error ? "failed" : "sent",
    error,
    provider_id: providerId,
  });
}

/**
 * After a failure outside the 24-hour window, send the template instead, at
 * most once a day per farmer, so the farmer can tap Start to carry on.
 */
export async function templateFallback(
  config: WhatsAppConfig | null,
  store: Store,
  farmer: Farmer,
  now: Date,
  fetchFn: typeof fetch = fetch,
): Promise<boolean> {
  if (!config?.template) return false;
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  if (await store.lastMessageLike(farmer.id, TEMPLATE_PREFIX, since)) return false;
  await sendTemplate(config, store, farmer, now, fetchFn);
  return true;
}

// Webhook

/** Meta's one-time GET that proves we own the webhook URL. */
export function verifySubscription(url: URL, verifyToken: string | undefined): Response {
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (verifyToken && mode === "subscribe" && token !== null && constantTimeEqual(token, verifyToken) && challenge) {
    return new Response(challenge, { headers: { "Content-Type": "text/plain" } });
  }
  return new Response("Forbidden", { status: 403 });
}

/** Checks X-Hub-Signature-256 ("sha256=<hex HMAC of the raw body>"). */
export async function validSignature(raw: string, header: string | null, appSecret: string): Promise<boolean> {
  if (!header?.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(appSecret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)));
  const expected = [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
  return constantTimeEqual(header.slice("sha256=".length).toLowerCase(), expected);
}

export interface Inbound {
  id: string;
  phone: string;
  text: string;
  name: string | null;
}

export interface Receipt {
  id: string;
  status: "sent" | "delivered" | "read" | "failed";
  code: number | null;
  error: string | null;
}

/** Farmers' messages and delivery receipts from one webhook call. */
export function parseWebhook(body: unknown): { messages: Inbound[]; receipts: Receipt[] } {
  const messages: Inbound[] = [];
  const receipts: Receipt[] = [];
  const entries = (body as { entry?: unknown[] })?.entry ?? [];
  for (const entry of entries as { changes?: { field?: string; value?: any }[] }[]) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};
      const names = new Map<string, string>(
        (value.contacts ?? []).map((c: any) => [String(c.wa_id), c.profile?.name ?? null] as [string, string]),
      );
      for (const m of value.messages ?? []) {
        const phone = normalizePhone(`+${String(m.from ?? "")}`);
        if (!phone || !m.id) continue;
        // Text, a tap on a reply button, or a tap on a template's quick reply.
        const text =
          m.type === "text"
            ? m.text?.body
            : m.type === "interactive"
              ? (m.interactive?.button_reply?.id ?? m.interactive?.list_reply?.id)
              : m.type === "button"
                ? (m.button?.payload ?? m.button?.text)
                : null;
        // Voice notes, photos and the like still count as the farmer getting in
        // touch; they get the current screen again.
        messages.push({ id: String(m.id), phone, text: typeof text === "string" ? text : "", name: names.get(String(m.from)) ?? null });
      }
      for (const s of value.statuses ?? []) {
        if (!s.id || !["sent", "delivered", "read", "failed"].includes(s.status)) continue;
        const err = s.errors?.[0];
        receipts.push({
          id: String(s.id),
          status: s.status,
          code: typeof err?.code === "number" ? err.code : null,
          error: err ? `WhatsApp ${err.code}: ${err.error_data?.details ?? err.title ?? err.message ?? "failed"}` : null,
        });
      }
    }
  }
  return { messages, receipts };
}

export interface WebhookDeps {
  store: Store;
  conversations: Conversations;
  config: WhatsAppConfig | null;
  openJoin: boolean;
  now: () => Date;
  fetchFn?: typeof fetch;
}

/** Handle one webhook call's receipts and messages. */
export async function processWebhook({ messages, receipts }: ReturnType<typeof parseWebhook>, deps: WebhookDeps): Promise<void> {
  const { store, conversations, config, openJoin, now, fetchFn = fetch } = deps;

  for (const receipt of receipts) {
    const message = await store.setDeliveryStatus(receipt.id, receipt.status, receipt.error);
    if (receipt.status !== "failed" || receipt.code !== OUTSIDE_WINDOW || !message) continue;
    if (message.body.startsWith(TEMPLATE_PREFIX)) continue;
    const farmer = await store.getFarmer(message.farmer_id);
    if (farmer) await templateFallback(config, store, farmer, now(), fetchFn);
  }

  for (const message of messages) {
    // Meta retries webhooks; each message is handled once.
    if (!(await store.markSeen(message.id, now().toISOString()))) continue;
    if (await store.getFarmerByPhone(message.phone)) {
      await conversations.inbound(message.phone, message.text);
      continue;
    }
    await stranger(message, deps, fetchFn);
  }
}

/** A message from a number that isn't registered: join, or say how to. */
async function stranger(message: Inbound, { store, config, openJoin, now }: WebhookDeps, fetchFn: typeof fetch): Promise<void> {
  if (!config) return;
  const crop = openJoin ? parseJoin(message.text) : undefined;
  if (!crop) {
    const reply = openJoin ? JOIN_HELP : NOT_REGISTERED;
    // Not logged: there is no farmer to log it against.
    await post(config, payload(message.phone, reply), fetchFn).catch((err) => console.error("Reply to stranger failed", err));
    return;
  }
  const [latitude, longitude] = NAMED.kasungu;
  const farmer: Farmer = {
    id: newId("frm"),
    name: (message.name ?? "").trim().slice(0, 60) || "WhatsApp farmer",
    farm_name: null,
    phone: message.phone,
    crop,
    latitude,
    longitude,
    lang: null,
    channel: "whatsapp",
    created_at: now().toISOString(),
  };
  await store.addFarmer(farmer);
  await store.logMessage({ farmer_id: farmer.id, direction: "in", channel: "whatsapp", body: message.text, at: now().toISOString() });
  const deliver = whatsappDeliver(config, fetchFn);
  const body = joinedText(farmer.name, crop);
  let providerId: string | null = null;
  let error: string | null = null;
  try {
    providerId = (await deliver(farmer, body)).id;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  await store.logMessage({
    farmer_id: farmer.id,
    direction: "out",
    channel: "whatsapp",
    body,
    at: now().toISOString(),
    status: error ? "failed" : "sent",
    error,
    provider_id: providerId,
  });
}

// Joining by WhatsApp

const CROP_WORDS: Record<string, Crop> = {
  tomato: "tomato",
  tomatoes: "tomato",
  matimati: "tomato",
  maize: "maize",
  corn: "maize",
  chimanga: "maize",
  bean: "beans",
  beans: "beans",
  nyemba: "beans",
  cabbage: "cabbage",
  cabbages: "cabbage",
  kabichi: "cabbage",
};

/** "join tomato" -> "tomato"; "join" alone -> null; anything else -> undefined. */
export function parseJoin(text: string): Crop | null | undefined {
  const words = text.trim().toLowerCase().split(/\s+/);
  if (words[0] !== "join" && words[0] !== "lowani") return undefined;
  return CROP_WORDS[words[1] ?? ""] ?? null;
}

export const JOIN_HELP =
  "FieldWise: to join, reply JOIN and your crop: JOIN TOMATO, JOIN MAIZE, JOIN BEANS or JOIN CABBAGE.\n\n" +
  "FieldWise: kuti mulowe, yankhani JOIN ndi mbewu yanu: JOIN MATIMATI, JOIN CHIMANGA, JOIN NYEMBA kapena JOIN KABICHI.";

export const joinedText = (name: string, crop: Crop) =>
  `FieldWise: welcome, ${name}. You are registered with ${cropWord(crop)} near Kasungu. ` +
  "We will message you when the weather puts your crop at risk.\n\n" +
  `FieldWise: takulandirani, ${name}. Mwalembetsedwa ndi ${CROP_LABEL[crop].ny.toLowerCase()} pafupi ndi Kasungu. ` +
  "Tidzakutumizirani uthenga nyengo ikaika mbewu zanu pachiopsezo.";

/** "tomatoes", "maize", "beans", "cabbages". */
function cropWord(crop: Crop): string {
  return CROP_LABEL[crop].en.replace(/^Your /, "").toLowerCase();
}

function plain(message: Outgoing): string {
  if (typeof message === "string") return message;
  return [message.header, message.body].filter(Boolean).join("\n");
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

export function constantTimeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}
