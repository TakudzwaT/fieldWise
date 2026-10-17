import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { start } from "../src/engine";
import worker, { type Env } from "../src/index";
import { isStop, parseJoin, parseWebhook, payload, validSignature, verifySubscription } from "../src/whatsapp";
import { testDb } from "./d1";

const SECRET = "app-secret";
const ADMIN = "admin-token";
const JUDGE = "265991234567"; // as WhatsApp sends it, without the +

// Meta's API, faked: records what was sent and answers with message ids.
let sent: any[];
let failNext: { code: number } | null;
beforeEach(() => {
  sent = [];
  failNext = null;
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    expect(url).toBe("https://graph.facebook.com/v25.0/PNID/messages");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer wa-token");
    const body = JSON.parse(init.body as string);
    if (failNext) {
      const { code } = failNext;
      failNext = null;
      return new Response(JSON.stringify({ error: { code, message: "Re-engagement message" } }), { status: 400 });
    }
    sent.push(body);
    return new Response(JSON.stringify({ messages: [{ id: `wamid.${sent.length}` }] }));
  });
});
afterEach(() => vi.unstubAllGlobals());

function env(extra: Partial<Env> = {}): Env {
  return {
    DB: testDb(),
    WEATHER_API: "https://weather.invalid",
    ADMIN_TOKEN: ADMIN,
    WHATSAPP_TOKEN: "wa-token",
    WHATSAPP_PHONE_NUMBER_ID: "PNID",
    WHATSAPP_APP_SECRET: SECRET,
    WHATSAPP_VERIFY_TOKEN: "verify-me",
    WHATSAPP_OPEN_JOIN: "true",
    ...extra,
  };
}

const sign = (raw: string, secret = SECRET) => `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;

let nextId = 0;
const textMessage = (text: string, from = JUDGE) => ({ from, id: `wamid.in.${++nextId}`, type: "text", text: { body: text } });
const buttonTap = (id: string, from = JUDGE) => ({
  from,
  id: `wamid.in.${++nextId}`,
  type: "interactive",
  interactive: { type: "button_reply", button_reply: { id, title: id === "1" ? "Yes" : "No" } },
});
const webhook = (value: Record<string, unknown>) => ({
  object: "whatsapp_business_account",
  entry: [{ id: "WABA", changes: [{ field: "messages", value: { messaging_product: "whatsapp", ...value } }] }],
});

async function postWebhook(e: Env, body: unknown, signature?: string) {
  const raw = JSON.stringify(body);
  const response = await worker.fetch(
    new Request("https://logic.test/whatsapp", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Hub-Signature-256": signature ?? sign(raw) },
      body: raw,
    }),
    e,
  );
  return response.status;
}

async function admin(e: Env, method: string, path: string, body?: unknown) {
  const response = await worker.fetch(
    new Request(`https://logic.test${path}`, {
      method,
      headers: { Authorization: `Bearer ${ADMIN}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    e,
  );
  return (await response.json()) as any;
}

describe("message format", () => {
  it("sends questions as Yes/No reply buttons with the crop as the header", () => {
    const { prompt } = start("late_blight", "en");
    expect(payload("+265991234567", prompt)).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "265991234567",
      type: "interactive",
      interactive: {
        type: "button",
        header: { type: "text", text: "Your tomatoes · 1 of 8" },
        body: { text: "Do any leaves have brown or black patches that look wet?" },
        action: {
          buttons: [
            { type: "reply", reply: { id: "s0:1", title: "Yes" } },
            { type: "reply", reply: { id: "s0:2", title: "No" } },
          ],
        },
      },
    });
  });

  it("sends the language choice as buttons with no header, and plain messages as text", () => {
    const language = payload("+265991234567", start("late_blight").prompt) as any;
    expect(language.interactive.header).toBeUndefined();
    expect(language.interactive.action.buttons.map((b: any) => [b.reply.id, b.reply.title])).toEqual([
      ["lang:1", "English"],
      ["lang:2", "Chichewa"],
    ]);
    expect(payload("+265991234567", "Hello")).toMatchObject({ type: "text", text: { body: "Hello", preview_url: false } });
  });
});

describe("webhook security", () => {
  it("answers Meta's verification only with the right verify token", async () => {
    const ok = verifySubscription(new URL("https://x/whatsapp?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=42"), "verify-me");
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("42");
    expect(verifySubscription(new URL("https://x/whatsapp?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=42"), "verify-me").status).toBe(403);
    expect(verifySubscription(new URL("https://x/whatsapp?hub.mode=subscribe&hub.verify_token=&hub.challenge=42"), undefined).status).toBe(403);
  });

  it("accepts only bodies signed with the app secret", async () => {
    const raw = '{"entry":[]}';
    expect(await validSignature(raw, sign(raw), SECRET)).toBe(true);
    expect(await validSignature(raw, sign(raw, "other"), SECRET)).toBe(false);
    expect(await validSignature(`${raw} `, sign(raw), SECRET)).toBe(false);
    expect(await validSignature(raw, null, SECRET)).toBe(false);
  });

  it("refuses unsigned calls, and every call when no app secret is set", async () => {
    const body = webhook({ messages: [textMessage("join maize")] });
    expect(await postWebhook(env(), body, "sha256=00")).toBe(401);
    expect(await postWebhook(env({ WHATSAPP_APP_SECRET: undefined }), body)).toBe(503);
    expect(sent).toEqual([]);
  });
});

describe("parsing", () => {
  it("reads texts, button taps, template buttons, media and receipts", () => {
    const parsed = parseWebhook(
      webhook({
        contacts: [{ wa_id: JUDGE, profile: { name: "Thoko" } }],
        messages: [
          { from: JUDGE, id: "a", type: "text", text: { body: "join maize" } },
          { from: JUDGE, id: "b", type: "interactive", interactive: { type: "button_reply", button_reply: { id: "2" } } },
          { from: JUDGE, id: "c", type: "button", button: { payload: "Start", text: "Start" } },
          { from: JUDGE, id: "d", type: "audio", audio: { id: "media" } },
        ],
        statuses: [
          { id: "wamid.1", status: "read" },
          { id: "wamid.2", status: "failed", errors: [{ code: 131047, title: "Re-engagement message" }] },
          { id: "wamid.3", status: "deleted" },
        ],
      }),
    );
    expect(parsed.messages.map((m) => [m.id, m.phone, m.text, m.name])).toEqual([
      ["a", "+265991234567", "join maize", "Thoko"],
      ["b", "+265991234567", "2", "Thoko"],
      ["c", "+265991234567", "Start", "Thoko"],
      ["d", "+265991234567", "", "Thoko"],
    ]);
    expect(parsed.receipts).toEqual([
      { id: "wamid.1", status: "read", code: null, error: null },
      { id: "wamid.2", status: "failed", code: 131047, error: "WhatsApp 131047: Re-engagement message" },
    ]);
  });

  it("reads join commands in English and Chichewa", () => {
    expect(parseJoin("JOIN Tomato")).toBe("tomato");
    expect(parseJoin("join chimanga")).toBe("maize");
    expect(parseJoin("join")).toBeNull();
    expect(parseJoin("join rice")).toBeNull();
    expect(parseJoin("hello")).toBeUndefined();
  });
});

describe("a judge's phone, end to end", () => {
  it("joins, gets an alert with buttons, and answers by tapping", async () => {
    const e = env();
    await postWebhook(e, webhook({ contacts: [{ wa_id: JUDGE, profile: { name: "Thoko Banda" } }], messages: [textMessage("join maize")] }));
    expect(sent).toHaveLength(1);
    expect(sent[0].text.body).toContain("welcome, Thoko Banda. You are registered with maize near Kasungu");

    const { farmers } = await admin(e, "GET", "/farmers");
    const judge = farmers.find((f: any) => f.phone === "+265991234567");
    expect(judge).toMatchObject({ name: "Thoko Banda", crop: "maize", channel: "whatsapp", lang: null });

    await admin(e, "POST", "/demo/scenario", { weather: "wet", farmer_id: judge.id });
    expect(sent.slice(1).map((m) => m.type)).toEqual(["text", "interactive"]);
    expect(sent[1].text.body).toContain("problems to your maize");

    await postWebhook(e, webhook({ messages: [buttonTap("1")] })); // English
    expect(sent.at(-1).interactive.header.text).toBe("Your maize · 1 of 8");

    // A greeting mid-questionnaire shows the same screen again, without "please reply 1 or 2".
    await postWebhook(e, webhook({ messages: [textMessage("hi")] }));
    expect(sent.at(-1).interactive.header.text).toBe("Your maize · 1 of 8");
    expect(sent.at(-1).interactive.body.text).not.toMatch(/Please reply/);

    for (const id of ["1", "1", "1", "1", "2", "2", "2", "2"]) await postWebhook(e, webhook({ messages: [buttonTap(id)] }));
    expect(sent.at(-1).text.body).toMatch(/^Thank you/);
    const { farms } = await admin(e, "GET", "/felix/priority");
    expect(farms[0]).toMatchObject({ farmer: { id: judge.id }, state: "answered", report: { answersSay: ["grey leaf spot"] } });
  });

  it("handles a message Meta delivers twice only once", async () => {
    const e = env();
    const message = textMessage("join beans");
    await postWebhook(e, webhook({ messages: [message] }));
    await postWebhook(e, webhook({ messages: [message] }));
    expect(sent).toHaveLength(1);
  });

  it("tells strangers how to join, or that they aren't registered when joining is off", async () => {
    await postWebhook(env(), webhook({ messages: [textMessage("hello", "265881111111")] }));
    expect(sent.at(-1).text.body).toMatch(/to join, reply JOIN/);
    await postWebhook(env({ WHATSAPP_OPEN_JOIN: undefined }), webhook({ messages: [textMessage("join maize", "265882222222")] }));
    expect(sent.at(-1).text.body).toMatch(/not registered/);
  });
});

describe("delivery receipts and the 24-hour window", () => {
  async function joined(e: Env) {
    await postWebhook(e, webhook({ messages: [textMessage("join tomato")] }));
    const { farmers } = await admin(e, "GET", "/farmers");
    return farmers.find((f: any) => f.channel === "whatsapp");
  }

  it("moves ticks forward only, and shows failures in the message log", async () => {
    const e = env();
    const judge = await joined(e);
    const receipt = (status: string, errors?: unknown[]) => webhook({ statuses: [{ id: "wamid.1", status, ...(errors ? { errors } : {}) }] });
    await postWebhook(e, receipt("read"));
    await postWebhook(e, receipt("delivered")); // late, out of order
    let { messages } = await admin(e, "GET", `/farmers/${judge.id}/messages`);
    expect(messages.at(-1)).toMatchObject({ status: "read", provider_id: "wamid.1" });
    await postWebhook(e, receipt("failed", [{ code: 131026, title: "Message undeliverable" }]));
    ({ messages } = await admin(e, "GET", `/farmers/${judge.id}/messages`));
    expect(messages.at(-1)).toMatchObject({ status: "failed", error: "WhatsApp 131026: Message undeliverable" });
  });

  it("sends the template, once, when a message fails outside the window", async () => {
    const e = env({ WHATSAPP_TEMPLATE: "fieldwise_check" });
    const judge = await joined(e);
    failNext = { code: 131047 };
    await admin(e, "POST", "/flags", { farmer_id: judge.id, disease: "late_blight" });
    const templates = sent.filter((m) => m.type === "template");
    expect(templates).toHaveLength(1);
    expect(templates[0].template).toEqual({
      name: "fieldwise_check",
      language: { code: "en" },
      components: [{ type: "body", parameters: [{ type: "text", text: "tomatoes" }] }],
    });

    // A failure reported later by receipt doesn't send a second one the same day.
    await postWebhook(e, webhook({ statuses: [{ id: "wamid.3", status: "failed", errors: [{ code: 131047 }] }] }));
    expect(sent.filter((m) => m.type === "template")).toHaveLength(1);

    // Tapping Start on the template shows the current screen.
    await postWebhook(e, webhook({ messages: [{ from: JUDGE, id: "tap", type: "button", button: { payload: "Start" } }] }));
    expect(sent.at(-1).interactive.body.text).toMatch(/choose your language/);
  });

  it("logs a WhatsApp farmer's messages as failed when WhatsApp isn't configured", async () => {
    const e = env();
    const judge = await joined(e);
    const unconfigured = { ...e, WHATSAPP_TOKEN: undefined };
    await admin(unconfigured, "POST", "/flags", { farmer_id: judge.id, disease: "late_blight" });
    const { messages } = await admin(unconfigured, "GET", `/farmers/${judge.id}/messages`);
    expect(messages.at(-1)).toMatchObject({ status: "failed", error: "whatsapp is not configured" });
  });
});

describe("taps on old buttons", () => {
  it("re-shows the current question instead of taking an old button as its answer", async () => {
    const e = env();
    await postWebhook(e, webhook({ messages: [textMessage("join maize")] }));
    const { farmers } = await admin(e, "GET", "/farmers");
    const judge = farmers.find((f: any) => f.channel === "whatsapp");
    await admin(e, "POST", "/flags", { farmer_id: judge.id, disease: "maize_leaf_blights" });
    await postWebhook(e, webhook({ messages: [buttonTap("lang:1")] })); // English
    await postWebhook(e, webhook({ messages: [buttonTap("s0:1")] })); // Q1 yes
    expect(sent.at(-1).interactive.header.text).toBe("Your maize · 2 of 8");

    // Scrolls up and taps "No" on question 1 again.
    await postWebhook(e, webhook({ messages: [buttonTap("s0:2")] }));
    expect(sent.at(-2).text.body).toBe("FieldWise: that button was for an earlier question. Here is the current one.");
    expect(sent.at(-1).interactive.header.text).toBe("Your maize · 2 of 8");

    const { flags } = await admin(e, "GET", `/farmers/${judge.id}`);
    expect(flags[0].session).toMatchObject({ step: 1, answers: [{ main: true }] });
  });

  it("reads the screen out of a button id", () => {
    const [m] = parseWebhook(webhook({ messages: [buttonTap("s3:2")] })).messages;
    expect(m).toMatchObject({ text: "2", screen: "s3" });
    const [typed] = parseWebhook(webhook({ messages: [textMessage("s3:2")] })).messages;
    expect(typed).toMatchObject({ text: "s3:2" });
    expect(typed.screen).toBeUndefined();
  });
});

describe("STOP", () => {
  it("confirms, then deletes the farmer and everything about them", async () => {
    const e = env();
    await postWebhook(e, webhook({ messages: [textMessage("join beans")] }));
    expect(sent.at(-1).text.body).toContain("Text STOP at any time to stop.");
    const judge = (await admin(e, "GET", "/farmers")).farmers.find((f: any) => f.channel === "whatsapp");
    await admin(e, "POST", "/flags", { farmer_id: judge.id, disease: "bean_leaf_diseases" });

    await postWebhook(e, webhook({ messages: [textMessage("STOP")] }));
    expect(sent.at(-1).text.body).toContain("you will get no more messages, and your details have been deleted");
    expect((await admin(e, "GET", "/farmers")).farmers.some((f: any) => f.id === judge.id)).toBe(false);
    expect((await admin(e, "GET", "/flags")).flags).toEqual([]);

    // A later message is from a stranger again.
    await postWebhook(e, webhook({ messages: [textMessage("hello")] }));
    expect(sent.at(-1).text.body).toMatch(/to join, reply JOIN/);
  });

  it("knows STOP in English and Chichewa, and nothing else", () => {
    for (const word of ["STOP", "stop.", "Unsubscribe", "lekani", "Siyani!"]) expect(isStop(word)).toBe(true);
    for (const word of ["stopped", "don't stop", "2", ""]) expect(isStop(word)).toBe(false);
  });

  it("doesn't delete simulator farmers", async () => {
    const e = env();
    await admin(e, "POST", "/inbound", { phone: "+2650000000056", text: "stop" });
    expect((await admin(e, "GET", "/farmers")).farmers).toHaveLength(8);
  });
});
