import { beforeEach, describe, expect, it } from "vitest";
import { apply, runChecks, scenarioAssessment, type Assessment } from "../src/checks";
import { Conversations } from "../src/conversation";
import { Outbox } from "../src/outbox";
import { Store, type Farmer } from "../src/store";
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

/** Reply to every question; "YN YY ..." = main/follow answers. */
async function answerAll(phone: string, pattern: string) {
  let replies: string[] = [];
  for (const ch of pattern.replace(/\s/g, "")) replies = await conversations.inbound(phone, ch === "Y" ? "1" : "2");
  return replies;
}

const banda = "+2650000000056"; // John Banda, tomato

describe("a flag reaches the farmer and their answers come back", () => {
  it("alerts in both languages until the farmer picks one, then asks the questions", async () => {
    await conversations.raise(await farmer("F056"), "late_blight", "new", "forecast", { leaf_wet_hours: 14 });
    const [alert, firstScreen] = await outgoing("F056");
    expect(alert).toContain("this week's weather can bring problems to your tomatoes");
    expect(alert).toContain("matimati anu");
    expect(firstScreen).toContain("choose your language");

    const [question] = await conversations.inbound(banda, "1");
    expect(question).toBe("Your tomatoes · 1 of 8\nDo any leaves have brown or black patches that look wet?\n1 Yes\n2 No");
    expect((await farmer("F056")).lang).toBe("en");
  });

  it("scores the finished questionnaire and marks the flag answered", async () => {
    const flag = await conversations.raise(await farmer("F056"), "late_blight", "new", "forecast", {});
    await conversations.inbound(banda, "1");
    const replies = await answerAll(banda, "NN NN NN YY");
    expect(replies[0]).toMatch(/^Thank you/);

    const session = await store.getSessionByFlag(flag.id);
    expect(session?.status).toBe("done");
    expect(session?.report).toMatchObject({ outcome: "wrong_flag", answersSay: ["bacterial wilt"], urgent: true });
    expect((await store.getFlag(flag.id))?.status).toBe("answered");
  });

  it("queues a second flag and starts it when the first is done", async () => {
    const banda1 = await farmer("F056");
    await conversations.raise(banda1, "late_blight", "new", "forecast", {});
    const second = await conversations.raise(banda1, "bacterial_wilt", "new", "forecast", {});
    expect((await store.getSessionByFlag(second.id))?.status).toBe("queued");

    await conversations.inbound(banda, "1");
    const replies = await answerAll(banda, "NN NN NN NN");
    expect(replies).toHaveLength(3);
    expect(replies[1]).toContain("weather can bring problems to your tomatoes");
    expect(replies[1]).not.toContain("matimati"); // language is known now
    expect(replies[2]).toBe("Your tomatoes · 1 of 8\nAre any whole plants wilting?\n1 Yes\n2 No");
    expect((await store.getSessionByFlag(second.id))?.status).toBe("active");
  });

  it("resumes where the farmer stopped", async () => {
    await conversations.raise(await farmer("F056"), "late_blight", "new", "forecast", {});
    await conversations.inbound(banda, "1");
    await conversations.inbound(banda, "1");
    later(5);
    const [next] = await conversations.inbound(banda, "2");
    expect(next).toContain("3 of 8");
  });

  it("answers unknown numbers and farmers with nothing to answer", async () => {
    expect((await conversations.inbound("+265999999999", "hi"))[0]).toMatch(/not registered/);
    expect((await conversations.inbound(banda, "hi"))[0]).toMatch(/no questions for you right now/);
  });

  it("nudges instead of restarting when a spell gets worse mid-questionnaire", async () => {
    const first = await conversations.raise(await farmer("F056"), "late_blight", "new", "forecast", {});
    await conversations.inbound(banda, "1");
    await conversations.inbound(banda, "1");
    const worse = await conversations.raise(await farmer("F056"), "late_blight", "worse", "forecast", {});
    expect(worse.status).toBe("merged");
    expect(worse.details.merged_into).toBe(first.id);
    const messages = await outgoing("F056");
    expect(messages.at(-2)).toContain("the weather is getting worse for your tomatoes");
    expect(messages.at(-1)).toContain("2 of 8");
  });
});

describe("silent farmers", () => {
  it("get one reminder after 24 h, then show as no response, and can still answer", async () => {
    const flag = await conversations.raise(await farmer("F056"), "late_blight", "new", "forecast", {});
    later(23);
    expect(await conversations.sweep()).toEqual({ reminded: 0, noResponse: 0, rechecks: 0 });
    later(2);
    expect(await conversations.sweep()).toEqual({ reminded: 1, noResponse: 0, rechecks: 0 });
    expect((await outgoing("F056")).at(-2)).toContain("still waiting for your answers about your tomatoes");
    later(25);
    expect(await conversations.sweep()).toEqual({ reminded: 0, noResponse: 1, rechecks: 0 });
    expect((await store.getFlag(flag.id))?.status).toBe("no_response");

    await conversations.inbound(banda, "1");
    expect((await store.getFlag(flag.id))?.status).toBe("awaiting");
    expect(await conversations.sweep()).toEqual({ reminded: 0, noResponse: 0, rechecks: 0 });
  });

  it("black rot that comes back clear is asked again a week later", async () => {
    const chirwa = "+2650000000062";
    await conversations.raise(await farmer("F062"), "black_rot", "new", "forecast", {});
    await conversations.inbound(chirwa, "2");
    await answerAll(chirwa, "NN NN NN NN");
    later(24 * 7 - 1);
    expect((await conversations.sweep()).rechecks).toBe(0);
    later(2);
    expect((await conversations.sweep()).rechecks).toBe(1);
    const recheck = (await store.listFlags("F062"))[0];
    expect(recheck).toMatchObject({ disease: "black_rot", reason: "recheck", status: "awaiting" });
    expect((await outgoing("F062")).at(-2)).toContain("chonde yang'aniraninso kabichi wanu");
  });
});

describe("forecast checks", () => {
  const assessment = (status: "flag" | "watch" | "clear", wet = 12): Assessment => ({
    window: { air_temp_mean: 19, soil_temp_mean: 24, leaf_wet_run_max: wet, wet_or_humid_run_max: wet, rain_total: 3 },
    soil: { drainage: "good" },
    results: [{ disease: "late_blight", status, conditions: [] }],
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
  it("a wet spell flags every disease of each crop, using the weather API's rules", async () => {
    const statuses = async (id: string) =>
      scenarioAssessment(await farmer(id), "wet", clock).results.map((r) => `${r.disease}:${r.status}`);
    expect(await statuses("F056")).toEqual(["late_blight:flag", "bacterial_wilt:flag"]);
    expect(await statuses("F014")).toEqual(["maize_leaf_blights:flag"]);
    expect(await statuses("F027")).toEqual(["bean_leaf_diseases:flag"]);
    expect(await statuses("F062")).toEqual(["black_rot:flag", "clubroot:flag"]);
  });

  it("a dry spell clears them, so the next wet spell alerts again", async () => {
    const tomato = await farmer("F084");
    const run = async (weather: "wet" | "dry") =>
      (await apply(store, conversations, tomato, scenarioAssessment(tomato, weather, clock), "scenario", clock)).map((r) => r.alert);
    expect(await run("wet")).toEqual(["new", "new"]);
    expect(await run("wet")).toEqual([null, null]);
    expect(await run("dry")).toEqual([null, null]);
    expect(await run("wet")).toEqual(["new", "new"]);
    expect((await store.listFlags("F084")).every((f) => f.source === "scenario")).toBe(true);
  });
});
