import { beforeEach, describe, expect, it } from "vitest";
import { apply, runChecks, scenarioAssessment, type Assessment } from "../src/checks";
import { Conversations, reminderDueAt, type Raise } from "../src/conversation";
import { toText } from "../src/engine";
import { Outbox } from "../src/outbox";
import type { DiseaseId } from "../src/questionnaires";
import { Store, type Farmer, type FlagDetails, type FlagReason } from "../src/store";
import { testDb } from "./d1";

const HOUR = 60 * 60 * 1000;
let clock: Date;
let store: Store;
let conversations: Conversations;

beforeEach(() => {
  clock = new Date("2026-10-20T06:00:00Z");
  const now = () => clock;
  store = new Store(testDb());
  conversations = new Conversations(store, new Outbox(store, now), now);
});

const later = (hours: number) => (clock = new Date(clock.getTime() + hours * HOUR));
const farmer = async (id: string) => (await store.getFarmer(id)) as Farmer;
const outgoing = async (id: string) => (await store.listMessages(id)).filter((m) => m.direction === "out").map((m) => m.body);
const flagged = (diseases: DiseaseId[], reason: FlagReason = "new", details: FlagDetails = {}): Raise[] =>
  diseases.map((disease) => ({ disease, reason, source: "forecast", details }));
const raise = async (id: string, diseases: DiseaseId[], reason: FlagReason = "new", details: FlagDetails = {}) =>
  conversations.raise(await farmer(id), flagged(diseases, reason, details));
const sessionsOf = async (id: string) => {
  const round = await store.openRound(id);
  return round ? store.roundSessions(round.id) : [];
};
const active = async (id: string) => (await sessionsOf(id)).find((s) => s.status === "active");

/** Reply to every question; "YN YY ..." = main/follow answers. */
async function answerAll(phone: string, pattern: string) {
  let replies: string[] = [];
  for (const ch of pattern.replace(/\s/g, "")) replies = await conversations.inbound(phone, ch === "Y" ? "1" : "2");
  return replies;
}

const banda = "+2650000000056"; // John Banda
const chirwa = "+2650000000062"; // Esther Chirwa
const WET: DiseaseId[] = ["late_blight", "maize_leaf_blights", "bean_leaf_diseases", "clubroot"];

describe("a weather flag reaches the farmer as one alert", () => {
  it("asks the language, then which plant, then that plant's questions", async () => {
    await raise("F056", WET);
    const messages = await outgoing("F056");
    expect(messages).toHaveLength(2);
    expect(messages[0]).toContain("this week's weather can bring problems to your crops");
    expect(messages[0]).toContain("mbewu zanu");
    expect(messages[1]).toContain("choose your language");

    const [list] = await conversations.inbound(banda, "1");
    expect(list).toBe("Which plant do you want to report on?\n1 Tomatoes\n2 Maize\n3 Beans\n4 Cabbages");
    expect((await farmer("F056")).lang).toBe("en");

    const [question] = await conversations.inbound(banda, "1");
    expect(question).toBe("Your tomatoes · 1 of 8\nDo any leaves have brown or black patches that look wet?\n1 Yes\n2 No");
  });

  it("takes the plant's name as well as its number, and asks again for anything else", async () => {
    await raise("F056", WET);
    await conversations.inbound(banda, "2"); // Chichewa
    const [retry] = await conversations.inbound(banda, "7");
    expect(retry).toMatch(/^Chonde yankhani ndi nambala ya mbewu\./);
    const [question] = await conversations.inbound(banda, "Kabichi");
    expect(question).toMatch(/^Kabichi wanu · 1 mwa 8/);
  });

  it("scores the plant, then asks about another; the list leaves out plants already done", async () => {
    const [blight] = await raise("F056", ["late_blight", "maize_leaf_blights"]);
    await conversations.inbound(banda, "1");
    await conversations.inbound(banda, "1"); // Tomatoes
    const replies = await answerAll(banda, "NN NN NN YY");
    expect(replies).toEqual([
      "Thank you. Your answers about your tomatoes have been sent to your extension officer.",
      "Do you want to report on another plant?\n1 Yes\n2 No",
    ]);
    const session = await store.getSessionByFlag(blight.id);
    expect(session?.report).toMatchObject({ outcome: "wrong_flag", answersSay: ["bacterial wilt"], urgent: true });
    expect((await store.getFlag(blight.id))?.status).toBe("answered");

    const [list] = await conversations.inbound(banda, "1");
    expect(list).toBe("Which plant do you want to report on?\n1 Maize");
    const [question] = await conversations.inbound(banda, "1");
    expect(question).toMatch(/^Your maize · 1 of 8/);
  });

  it("closes on No, and the plants not picked are skipped", async () => {
    const [, maize] = await raise("F056", ["late_blight", "maize_leaf_blights"]);
    await conversations.inbound(banda, "1");
    await conversations.inbound(banda, "1");
    await answerAll(banda, "NN NN NN NN");
    expect(await conversations.inbound(banda, "2")).toEqual(["Thank you. Your answers have been sent to your extension officer."]);
    expect((await store.getFlag(maize.id))?.status).toBe("skipped");
    expect((await store.getSessionByFlag(maize.id))?.status).toBe("skipped");
    expect(await store.openRound("F056")).toBeNull();
    expect((await conversations.inbound(banda, "hi"))[0]).toMatch(/no questions for you right now/);
  });

  it("thanks and closes without asking when the last plant is done", async () => {
    await raise("F056", ["late_blight"]);
    await conversations.inbound(banda, "1");
    await conversations.inbound(banda, "1");
    expect(await answerAll(banda, "NN NN NN NN")).toEqual(["Thank you. Your answers have been sent to your extension officer."]);
    expect(await store.openRound("F056")).toBeNull();
  });

  it("asks every flagged questionnaire for the plant picked, one after another", async () => {
    await raise("F062", ["clubroot", "black_rot"]);
    await conversations.inbound(chirwa, "1");
    expect(await conversations.inbound(chirwa, "1")).toEqual([
      "Your cabbages · 1 of 8\nAre the edges of any leaves turning yellow or brown?\n1 Yes\n2 No",
    ]);
    const between = await answerAll(chirwa, "NN NN NN NN");
    expect(between[0]).toBe("Thank you. A few more questions about your cabbages.");
    expect(between[1]).toMatch(/^Your cabbages · 1 of 8\nAre any plants wilting even though the ground is wet\?/);
    expect(await answerAll(chirwa, "NN NN NN NN")).toEqual(["Thank you. Your answers have been sent to your extension officer."]);
  });

  it("adds new flags to the open round without a second alert", async () => {
    await raise("F056", ["late_blight"]);
    await conversations.inbound(banda, "1");
    await conversations.inbound(banda, "1"); // answering tomatoes
    const sent = (await outgoing("F056")).length;
    const [maize] = await raise("F056", ["maize_leaf_blights"]);
    const [wilt] = await raise("F056", ["bacterial_wilt"]);
    expect(await outgoing("F056")).toHaveLength(sent);
    expect((await store.getSessionByFlag(maize.id))?.status).toBe("offered");
    // Same plant as the one being answered: asked straight after it.
    expect((await store.getSessionByFlag(wilt.id))?.status).toBe("queued");

    const next = await answerAll(banda, "NN NN NN NN");
    expect(next[1]).toMatch(/^Your tomatoes · 1 of 8\nAre any whole plants wilting/);
    expect(await answerAll(banda, "NN NN NN NN")).toContain("Do you want to report on another plant?\n1 Yes\n2 No");
  });

  it("opens a new round with a new alert once the last one is closed", async () => {
    await raise("F056", ["late_blight"]);
    await conversations.inbound(banda, "1");
    await conversations.inbound(banda, "1");
    await answerAll(banda, "NN NN NN NN");
    await raise("F056", ["maize_leaf_blights"]);
    const messages = await outgoing("F056");
    expect(messages.at(-2)).toBe("FieldWise: this week's weather can bring problems to your crops. Please check your plants today and tell us what you see.");
    expect(messages.at(-1)).toBe("Which plant do you want to report on?\n1 Maize");
  });

  it("resumes where the farmer stopped", async () => {
    await raise("F056", ["late_blight"]);
    await conversations.inbound(banda, "1");
    await conversations.inbound(banda, "1");
    await conversations.inbound(banda, "1");
    later(5);
    expect((await conversations.inbound(banda, "hi"))[0]).toContain("2 of 8");
    const [next] = await conversations.inbound(banda, "2");
    expect(next).toContain("3 of 8");
  });

  it("answers unknown numbers and farmers with nothing to answer", async () => {
    expect((await conversations.inbound("+265999999999", "hi"))[0]).toMatch(/not registered/);
    expect((await conversations.inbound(banda, "hi"))[0]).toMatch(/no questions for you right now/);
  });

  it("nudges instead of restarting when a spell gets worse mid-questionnaire", async () => {
    const [first] = await raise("F056", ["late_blight"]);
    await conversations.inbound(banda, "1");
    await conversations.inbound(banda, "1");
    await conversations.inbound(banda, "1");
    const [worse] = await raise("F056", ["late_blight"], "worse");
    expect(worse.status).toBe("merged");
    expect(worse.details.merged_into).toBe(first.id);
    const messages = await outgoing("F056");
    expect(messages.at(-2)).toContain("the weather is getting worse for your tomatoes");
    expect(messages.at(-1)).toContain("2 of 8");
  });
});

describe("silent farmers", () => {
  it("get one reminder after 24 h, then show as no response, and can still answer", async () => {
    const flags = await raise("F056", ["late_blight", "maize_leaf_blights"]);
    later(23);
    expect(await conversations.sweep()).toEqual({ reminded: 0, noResponse: 0, rechecks: 0 });
    later(2);
    expect(await conversations.sweep()).toEqual({ reminded: 1, noResponse: 0, rechecks: 0 });
    expect((await outgoing("F056")).at(-2)).toContain("we are still waiting for your answers");
    later(25);
    expect(await conversations.sweep()).toEqual({ reminded: 0, noResponse: 2, rechecks: 0 });
    for (const flag of flags) expect((await store.getFlag(flag.id))?.status).toBe("no_response");

    await conversations.inbound(banda, "1");
    for (const flag of flags) expect((await store.getFlag(flag.id))?.status).toBe("awaiting");
    expect(await conversations.sweep()).toEqual({ reminded: 0, noResponse: 0, rechecks: 0 });
  });

  it("black rot that comes back clear is asked again a week later, straight to the cabbage questions", async () => {
    await raise("F062", ["black_rot"]);
    await conversations.inbound(chirwa, "2");
    await conversations.inbound(chirwa, "1");
    await answerAll(chirwa, "NN NN NN NN");
    later(24 * 7 - 1);
    expect((await conversations.sweep()).rechecks).toBe(0);
    later(2);
    expect((await conversations.sweep()).rechecks).toBe(1);
    const recheck = (await store.listFlags("F062"))[0];
    expect(recheck).toMatchObject({ disease: "black_rot", reason: "recheck", status: "awaiting" });
    // Esther Chirwa is on USSD: the re-check is one SMS saying what to dial,
    // and the dial opens straight on the cabbage questions.
    const messages = await outgoing("F062");
    expect(messages.at(-1)).toContain("chonde yang'aniraninso kabichi wanu");
    expect(messages.at(-1)).toMatch(/Imbani \*384\*123# kuti muyankhe\.$/);
    expect(toText((await conversations.current(await farmer("F062")))!)).toMatch(/^Kabichi wanu · 1 mwa 8/);
  });
});

describe("forecast checks", () => {
  const assessment = (status: "flag" | "watch" | "clear", wet = 12, diseases: DiseaseId[] = ["late_blight"]): Assessment => ({
    window: { air_temp_mean: 19, soil_temp_mean: 24, leaf_wet_run_max: wet, wet_or_humid_run_max: wet, rain_total: 3 },
    soil: { drainage: "good" },
    results: diseases.map((disease) => ({ disease, status, conditions: [] })),
  });

  it("alerts once when conditions change into a flag", async () => {
    const statuses = ["clear", "watch", "flag", "flag", "flag"] as const;
    const client = { i: 0, async assess() { return assessment(statuses[this.i++]); } };
    const banda1 = [await farmer("F056")];
    const alerts = [];
    for (const _ of statuses) {
      alerts.push((await runChecks(store, conversations, client, clock, banda1))[0].alert);
      later(1);
    }
    expect(alerts).toEqual([null, null, "new", null, null]);
    expect(await store.listFlags("F056")).toHaveLength(1);
  });

  it("sends one alert for all of a farm's new flags", async () => {
    const results = await apply(store, conversations, await farmer("F056"), assessment("flag", 12, ["late_blight", "maize_leaf_blights"]), "forecast", clock);
    expect(results.every((r) => r.flag)).toBe(true);
    expect(await outgoing("F056")).toHaveLength(2);
  });

  it("keeps the weather behind the flag for Felix", async () => {
    const results = await apply(store, conversations, await farmer("F056"), assessment("flag", 14), "forecast", clock);
    const flag = await store.getFlag(results[0].flag!);
    expect(flag?.details).toMatchObject({ leaf_wet_hours: 14, air_temp: 19, soil_temp: 24, drainage: "good", rain_mm: 3 });
  });

  it("reports a farm whose check fails without stopping the others", async () => {
    const client = {
      async assess(f: Farmer) {
        if (f.id === "F014") throw new Error("down");
        return assessment("clear");
      },
    };
    const results = await runChecks(store, conversations, client, clock, [await farmer("F014"), await farmer("F056")]);
    expect(results).toEqual([
      { farmer: "F014", error: "down" },
      { farmer: "F056", disease: "late_blight", status: "clear", alert: null },
    ]);
  });
});

describe("demo scenario", () => {
  it("a wet spell puts all four crops at risk, using the weather API's rules", () => {
    expect(scenarioAssessment("wet", clock).results.map((r) => `${r.disease}:${r.status}`)).toEqual([
      "late_blight:flag",
      "bacterial_wilt:watch",
      "maize_leaf_blights:flag",
      "bean_leaf_diseases:flag",
      "black_rot:watch",
      "clubroot:flag",
    ]);
  });

  it("a dry spell clears them, so the next wet spell alerts again", async () => {
    const ruth = await farmer("F084");
    const run = async (weather: "wet" | "dry") =>
      (await apply(store, conversations, ruth, scenarioAssessment(weather, clock), "scenario", clock)).filter((r) => r.alert).length;
    expect(await run("wet")).toBe(4);
    expect(await run("wet")).toBe(0);
    expect(await run("dry")).toBe(0);
    expect(await run("wet")).toBe(4);
    expect((await store.listFlags("F084")).every((f) => f.source === "scenario")).toBe(true);
  });
});

describe("replies at the same moment", () => {
  it("counts two taps on the same button once", async () => {
    await raise("F056", ["late_blight"]);
    await conversations.inbound(banda, "1");
    await conversations.inbound(banda, "1");
    const [a, b] = await Promise.all([
      conversations.inbound(banda, "1", { screen: "s0" }),
      conversations.inbound(banda, "1", { screen: "s0" }),
    ]);
    expect((await active("F056"))?.state).toMatchObject({ step: 1, answers: [{ main: true }] });
    // One tap moved on; the other was seen as an old button.
    expect([a, b].flat().join("\n")).toContain("that button was for an earlier question");
  });

  it("picks one plant when the list is tapped twice", async () => {
    await raise("F056", WET);
    await conversations.inbound(banda, "1");
    await Promise.all([
      conversations.inbound(banda, "1", { screen: "pick" }),
      conversations.inbound(banda, "2", { screen: "pick" }),
    ]);
    expect((await sessionsOf("F056")).filter((s) => s.status === "active")).toHaveLength(1);
  });

  it("counts two different typed answers arriving together, in turn", async () => {
    await raise("F056", ["late_blight"]);
    await conversations.inbound(banda, "1");
    await conversations.inbound(banda, "1");
    await Promise.all([conversations.inbound(banda, "1"), conversations.inbound(banda, "2")]);
    expect((await active("F056"))?.state.step).toBe(2);
  });
});

describe("WhatsApp reminder timing", () => {
  const at = "2026-10-20T06:00:00.000Z";
  const plus = (h: number) => Date.parse(at) + h * HOUR;
  const ago = (h: number) => new Date(Date.parse(at) - h * HOUR).toISOString();

  it("waits a day on the simulator", () => {
    expect(reminderDueAt("sim", at, null)).toBe(plus(24));
  });

  it("reminds on WhatsApp while the 24-hour window is still open", () => {
    expect(reminderDueAt("whatsapp", at, null)).toBe(plus(20));
    expect(reminderDueAt("whatsapp", at, at)).toBe(plus(20));
    // Last message 10 h before the alert: the window closes 14 h after it.
    expect(reminderDueAt("whatsapp", at, ago(10))).toBe(plus(11));
    // Window nearly closed already: no sooner than 4 h after the alert.
    expect(reminderDueAt("whatsapp", at, ago(22))).toBe(plus(4));
  });

  it("sends the WhatsApp reminder before the window closes", async () => {
    const judge: Farmer = {
      id: "W1", name: "Judge", farm_name: null, phone: "+2650000000111",
      latitude: -13.03, longitude: 33.48, lang: "en", channel: "whatsapp", created_at: clock.toISOString(),
    };
    await store.addFarmer(judge);
    await store.logMessage({ farmer_id: "W1", direction: "in", channel: "whatsapp", body: "join", at: clock.toISOString() });
    later(6);
    await conversations.raise(judge, flagged(["maize_leaf_blights"]));
    // Joined 6 h before the alert, so the window closes 18 h after it: remind at 15 h.
    later(14);
    expect((await conversations.sweep()).reminded).toBe(0);
    later(1);
    expect((await conversations.sweep()).reminded).toBe(1);
  });
});
