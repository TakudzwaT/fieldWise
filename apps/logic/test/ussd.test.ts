import { beforeEach, describe, expect, it } from "vitest";
import { Conversations } from "../src/conversation";
import { priorityList, summary } from "../src/felix";
import worker, { type Env } from "../src/index";
import { Outbox } from "../src/outbox";
import type { DiseaseId } from "../src/questionnaires";
import { smsDeliver } from "../src/sms";
import { Store, type Farmer } from "../src/store";
import { handleUssd, MAX_SCREEN } from "../src/ussd";
import { testDb } from "./d1";

const HOUR = 60 * 60 * 1000;
let clock: Date;
let store: Store;
let conversations: Conversations;
let sessionNo = 0;

beforeEach(() => {
  clock = new Date("2026-10-20T06:00:00Z");
  const now = () => clock;
  store = new Store(testDb());
  conversations = new Conversations(store, new Outbox(store, now), now);
});

const phiri = "+2650000000014"; // Chimwemwe Phiri, on USSD
const WET: DiseaseId[] = ["late_blight", "maize_leaf_blights", "bean_leaf_diseases", "clubroot"];
const farmer = async (id: string) => (await store.getFarmer(id)) as Farmer;
const sms = async (id: string) => (await store.listMessages(id)).filter((m) => m.kind === "sms");

/** A phone in one USSD session: dial(), then press(...) each input. */
function phone(number = phiri) {
  const sessionId = `test_${++sessionNo}`;
  const inputs: string[] = [];
  const call = () => handleUssd({ sessionId, serviceCode: "*384*123#", phoneNumber: number, text: inputs.join("*") }, { store, conversations, now: () => clock });
  return {
    dial: call,
    press: (input: string) => {
      inputs.push(input);
      return call();
    },
    /** The gateway sending the same request again. */
    repeat: call,
  };
}

describe("alerts reach USSD farmers by SMS", () => {
  it("sends the alert and its question as one SMS that says what to dial", async () => {
    await conversations.raise(await farmer("F014"), WET.map((disease) => ({ disease, reason: "new", source: "forecast", details: {} })));
    const texts = await sms("F014");
    expect(texts).toHaveLength(1);
    expect(texts[0].body).toContain("this week's weather can bring problems to your crops");
    expect(texts[0].body).toContain("mbewu zanu");
    // No language yet, so both.
    expect(texts[0].body).toMatch(/Dial \*384\*123# to answer\.\n\nImbani \*384\*123# kuti muyankhe\.$/);
    expect(texts[0].body).not.toContain("1 English");
  });
});

describe("dialling in", () => {
  beforeEach(async () => {
    await conversations.raise(await farmer("F014"), WET.map((disease) => ({ disease, reason: "new", source: "forecast", details: {} })));
  });

  it("goes straight to the waiting questions and saves every answer", async () => {
    const p = phone();
    expect(await p.dial()).toBe("CON FieldWise: choose your language / Sankhani chiyankhulo\n1 English\n2 Chichewa");
    expect(await p.press("1")).toBe("CON Which plant do you want to report on?\n1 Tomatoes\n2 Maize\n3 Beans\n4 Cabbages\n0 Menu");
    expect(await p.press("2")).toMatch(/^CON Your maize - 1 of 8\nDo the lower leaves .+\?\n1 Yes\n2 No\n0 Menu$/);
    // The gateway repeats a request: same screen, the answer isn't counted twice.
    await p.press("1");
    const again = await p.repeat();
    expect(again).toMatch(/^CON Your maize - 2 of 8/);
    expect((await store.openRound("F014")) && (await conversations.current(await farmer("F014")))?.key).toBe("s1");
  });

  it("picks up at the same question after the call drops", async () => {
    const first = phone();
    await first.dial();
    await first.press("1");
    await first.press("2");
    await first.press("1");
    const second = phone();
    expect(await second.dial()).toMatch(/^CON Your maize - 2 of 8/);
  });

  it("ends with a thank-you, and Felix sees the answers", async () => {
    const p = phone();
    await p.dial();
    await p.press("1");
    await p.press("2");
    let screen = "";
    for (const a of ["1", "1", "1", "1", "2", "2", "2", "2"]) screen = await p.press(a);
    expect(screen).toMatch(/^CON Thank you\. Your answers about your maize have been sent/);
    expect(screen).toContain("Do you want to report on another plant?");
    expect(await p.press("2")).toBe("END Thank you. Your answers have been sent to your extension officer.");
    const farm = priorityList(await store.flagRows())[0];
    expect(farm).toMatchObject({ farmer: { id: "F014" }, crop: "maize", state: "answered" });
    // Nothing was texted after the alert: the answers were all on screen.
    expect(await sms("F014")).toHaveLength(1);
  });

  it("keeps every screen inside 182 characters, even retries in Chichewa", async () => {
    const p = phone();
    const screens = [await p.dial(), await p.press("2"), await p.press("9"), await p.press("4")];
    for (let i = 0; i < 8; i++) screens.push(await p.press("x"), await p.press(i % 2 ? "1" : "2"));
    for (const s of screens) {
      expect(s.length).toBeLessThanOrEqual(MAX_SCREEN);
      expect(s).not.toMatch(/[·…]/);
    }
    expect(screens.at(-1)).toMatch(/^(CON|END) Zikomo/);
  });

  it("0 opens the menu, and 1 there carries on with the questions", async () => {
    const p = phone();
    await p.dial();
    await p.press("1");
    expect(await p.press("0")).toBe("CON FieldWise\n1 Answer our questions\n2 Messages from Felix\n3 Ask Felix to call me\n4 Language");
    expect(await p.press("1")).toMatch(/^CON Which plant do you want to report on\?/);
  });
});

describe("the menu, with nothing waiting", () => {
  it("asks the language first time, then shows the menu", async () => {
    const p = phone();
    expect(await p.dial()).toMatch(/^CON FieldWise: choose your language/);
    expect(await p.press("2")).toBe("CON FieldWise\n1 Nenani vuto la mbewu\n2 Mauthenga ochokera kwa Felix\n3 Felix andiyimbire foni\n4 Chiyankhulo");
    expect((await farmer("F014")).lang).toBe("ny");
  });

  it("lets a farmer report a problem: that plant's questions, no alert, and Felix sees it", async () => {
    await store.setLang("F014", "en");
    const p = phone();
    await p.dial();
    expect(await p.press("1")).toBe("CON Which plant has a problem?\n1 Tomatoes\n2 Maize\n3 Beans\n4 Cabbages");
    expect(await p.press("1")).toMatch(/^CON Your tomatoes - 1 of 8\nDo any leaves have brown or black patches/);
    const [flag] = await store.listFlags("F014");
    expect(flag).toMatchObject({ disease: "late_blight", reason: "report", source: "farmer", status: "awaiting" });
    expect(await sms("F014")).toHaveLength(0);

    for (const a of ["1", "1", "1", "1"]) await p.press(a);
    const rows = await store.flagRows();
    expect(priorityList(rows)[0]).toMatchObject({ source: "farmer", state: "answering", answered: 4, provisional: true });
    // A farmer's own report wasn't asked for, so it doesn't count towards the response rate.
    expect(summary(rows, 8)).toMatchObject({ farmer_reports: 1, response_rate: null });
  });

  it("takes one call-back request at a time", async () => {
    await store.setLang("F014", "en");
    const p = phone();
    await p.dial();
    expect(await p.press("3")).toBe("END Thank you. Felix will call you soon.");
    const again = phone();
    await again.dial();
    expect(await again.press("3")).toBe("END Felix already has your request and will call you soon.");
    expect(await store.openCallbacks()).toMatchObject([{ farmer: { id: "F014", name: "Chimwemwe Phiri" } }]);
    expect(await store.openCallbacks("someone_else")).toEqual([]);
  });

  it("shows Felix's messages, newest first", async () => {
    await store.setLang("F014", "en");
    const empty = phone();
    await empty.dial();
    expect(await empty.press("2")).toBe("END No messages from Felix yet.");

    const outbox = new Outbox(store, () => clock);
    await outbox.send(await farmer("F014"), ["Felix (FieldWise): I will visit your farm today."], { officerId: "OFF01" });
    clock = new Date(clock.getTime() + HOUR);
    await outbox.send(await farmer("F014"), ["Felix (FieldWise): Keep checking your plants."], { officerId: "OFF01" });
    const p = phone();
    await p.dial();
    expect(await p.press("2")).toBe("CON 20/10 Felix (FieldWise): Keep checking your plants.\n1 Older\n0 Menu");
    expect(await p.press("1")).toBe("CON 20/10 Felix (FieldWise): I will visit your farm today.\n0 Menu");
    expect(await p.press("0")).toMatch(/^CON FieldWise\n1 Report a crop problem/);
  });

  it("refuses numbers it doesn't know", async () => {
    expect(await phone("+265999000111").dial()).toMatch(/^END FieldWise: this number is not registered/);
  });
});

describe("SMS delivery", () => {
  it("posts to Africa's Talking for a real USSD farmer, and logs a failure without stopping", async () => {
    const calls: { url: string; body: string; key: string | null }[] = [];
    let status = "Success";
    const fetchFn = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: String(init.body), key: new Headers(init.headers).get("apiKey") });
      return new Response(JSON.stringify({ SMSMessageData: { Recipients: [{ status, messageId: "ATXid_1" }] } }));
    }) as unknown as typeof fetch;
    const outbox = new Outbox(store, () => clock, { ussd: smsDeliver({ username: "sandbox", apiKey: "k", from: null }, fetchFn) });
    const real: Farmer = { ...(await farmer("F014")), demo: 0, phone: "+265991234567" };

    await outbox.send(real, ["Felix (FieldWise): hello"]);
    expect(calls[0].url).toBe("https://api.sandbox.africastalking.com/version1/messaging");
    expect(calls[0].key).toBe("k");
    expect(new URLSearchParams(calls[0].body).get("to")).toBe("+265991234567");
    status = "InvalidPhoneNumber";
    await outbox.send(real, ["again"]);
    const log = await sms("F014");
    expect(log.map((m) => [m.status, m.provider_id])).toEqual([
      ["sent", "ATXid_1"],
      ["failed", null],
    ]);

    // Demo farmers are never sent anything.
    await outbox.send(await farmer("F014"), ["demo"]);
    expect(calls).toHaveLength(2);
  });
});

describe("http", () => {
  const TOKEN = "test-token";
  let env: Env;
  beforeEach(() => {
    env = { DB: testDb(), WEATHER_API: "https://weather.invalid", ADMIN_TOKEN: TOKEN, USSD_KEY: "gateway-key" };
  });
  const call = async (method: string, path: string, body?: unknown, token: string | null = TOKEN) => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await worker.fetch(
      new Request(`https://logic.test${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
      env,
    );
    return { status: response.status, body: (await response.json()) as any };
  };

  it("answers Africa's Talking's form callback with the key, and nobody without it", async () => {
    const form = (key: string) =>
      worker.fetch(
        new Request(`https://logic.test/ussd?key=${key}`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ sessionId: "ATUid_1", serviceCode: "*384*123#", phoneNumber: "+2650000000014", text: "", networkCode: "65010" }),
        }),
        env,
      );
    const ok = await form("gateway-key");
    expect(ok.headers.get("Content-Type")).toContain("text/plain");
    expect(await ok.text()).toMatch(/^CON FieldWise: choose your language/);
    expect((await form("wrong")).status).toBe(401);
  });

  it("gives an officer their own farmers, lets them reply, and nothing more", async () => {
    const made = await call("POST", "/officers/OFF01/token", {});
    expect(made.status).toBe(201);
    const felix = made.body.token as string;
    expect(felix).toMatch(/^fw_[0-9a-f]{48}$/);

    expect((await call("GET", "/me", undefined, felix)).body).toMatchObject({ role: "officer", officer: { name: "Felix" } });
    expect((await call("GET", "/farmers", undefined, felix)).body.farmers).toHaveLength(8);
    expect((await call("POST", "/demo/reset", { confirm: "reset" }, felix)).status).toBe(403);
    expect((await call("POST", "/officers/OFF01/token", {}, felix)).status).toBe(403);

    const sent = await call("POST", "/farmers/F014/messages", { advice: "visit_today" }, felix);
    expect(sent.body.sent).toBe("Felix (FieldWise): I will visit your farm today to look at your crops.\n\nNdibwera kumunda kwanu lero kudzaona mbewu zanu.");
    const messages = (await call("GET", "/farmers/F014/messages", undefined, felix)).body.messages;
    expect(messages.at(-1)).toMatchObject({ kind: "sms", officer_id: "OFF01" });
    expect((await call("POST", "/farmers/F014/messages", { text: "x".repeat(301) }, felix)).status).toBe(400);

    // Another officer's farmer is invisible.
    const other = (await call("POST", "/officers", { name: "Chisomo" })).body.officer;
    const token = (await call("POST", `/officers/${other.id}/token`, {})).body.token;
    expect((await call("GET", "/farmers", undefined, token)).body.farmers).toHaveLength(0);
    expect((await call("GET", "/farmers/F014", undefined, token)).status).toBe(404);
    expect((await call("GET", "/felix/priority", undefined, token)).body.farms).toEqual([]);

    // A new token replaces the old one.
    await call("POST", "/officers/OFF01/token", {});
    expect((await call("GET", "/me", undefined, felix)).status).toBe(401);
  });

  it("broadcasts to an officer's farmers and closes call-backs", async () => {
    const felix = (await call("POST", "/officers/OFF01/token", {})).body.token as string;
    const broadcast = await call("POST", "/felix/broadcast", { text: "Rain is coming this week.", farmer_ids: ["F014", "F056"] }, felix);
    expect(broadcast.body).toEqual({ sent: 2 });

    await worker.fetch(
      new Request("https://logic.test/ussd", {
        method: "POST",
        headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: "s1", phoneNumber: "+2650000000014", text: "1*3" }),
      }),
      env,
    );
    // That was a new session whose first request carried inputs; it shows the first screen.
    const ussd = async (text: string) =>
      (
        await worker.fetch(
          new Request("https://logic.test/ussd", {
            method: "POST",
            headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId: "s2", phoneNumber: "+2650000000014", text }),
          }),
          env,
        )
      ).text();
    await ussd("");
    await ussd("1");
    expect(await ussd("1*3")).toBe("END Thank you. Felix will call you soon.");

    const priority = (await call("GET", "/felix/priority", undefined, felix)).body;
    expect(priority.callbacks).toMatchObject([{ farmer: { id: "F014", phone: "+2650000000014" } }]);
    const done = await call("POST", `/felix/callbacks/${priority.callbacks[0].id}/done`, {}, felix);
    expect(done.body).toEqual({ done: true, already: false });
    expect((await call("GET", "/felix/callbacks", undefined, felix)).body.callbacks).toEqual([]);
  });

  it("lists the ready-made replies", async () => {
    const { body } = await call("GET", "/felix/advice");
    expect(body.advice.map((a: { id: string }) => a.id)).toEqual(["visit_today", "visit_week", "remove_leaves", "keep_watching", "all_clear"]);
  });
});
