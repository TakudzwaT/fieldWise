import { beforeEach, describe, expect, it } from "vitest";
import { Conversations } from "../src/conversation";
import { conditionsLine, priorityList, shortName, summary } from "../src/felix";
import { Outbox } from "../src/outbox";
import type { DiseaseId } from "../src/questionnaires";
import { Store, type Farmer, type FlagDetails, type FlagReason, type FlagSource } from "../src/store";
import { testDb } from "./d1";

const HOUR = 60 * 60 * 1000;
let clock: Date;
let store: Store;
let conversations: Conversations;

beforeEach(() => {
  clock = new Date("2026-10-12T06:00:00Z");
  const now = () => clock;
  store = new Store(testDb());
  conversations = new Conversations(store, new Outbox(store, now), now);
});

const farmer = async (id: string) => (await store.getFarmer(id)) as Farmer;
const raise = async (id: string, disease: DiseaseId, reason: FlagReason = "new", source: FlagSource = "forecast", details: FlagDetails = {}) =>
  conversations.raise(await farmer(id), [{ disease, reason, source, details }]);
async function answer(phone: string, pattern: string) {
  for (const ch of pattern.replace(/\s/g, "")) await conversations.inbound(phone, ch === "Y" ? "1" : ch === "N" ? "2" : ch);
}

describe("Felix's priority list", () => {
  it("reproduces the document's example line", async () => {
    await raise("F056", "late_blight", "new", "forecast", { soil_temp: 31, drainage: "poor", leaf_wet_hours: 14 });
    await answer("+2650000000056", "1 1 NN NN NN YY");
    const [line] = priorityList(await store.flagRows());
    expect(line.text).toBe(
      [
        "BANDA J. | Tomato | Flagged: late blight | ANSWERS SAY: bacterial wilt | Urgent",
        "Q1 wet patches N, lowest leaves marked N | Q2 white fuzz N, dry papery N | Q3 worse N, began after heavy rain N | Q4 wilt, leaves green Y, recovers at night Y",
        "Soil 31C, drainage poor, 14 h wet | Flagged 12 Oct",
      ].join("\n"),
    );
    expect(line).toMatchObject({ rank: "go_now", state: "answered", provisional: false });
  });

  it("sorts urgent first, then this week, no response, re-check and waiting", async () => {
    // Tomato F084: silent through a reminder -> no response.
    await raise("F084", "late_blight", "new", "forecast");
    clock = new Date(clock.getTime() + 25 * HOUR);
    await conversations.sweep();
    clock = new Date(clock.getTime() + 25 * HOUR);
    await conversations.sweep();
    // Maize: confirmed, limited spread -> this week.
    await raise("F014", "maize_leaf_blights", "new", "forecast");
    await answer("+2650000000014", "1 1 YY YY NN NN");
    // Beans: early signs only -> re-check.
    await raise("F027", "bean_leaf_diseases", "new", "forecast");
    await answer("+2650000000027", "1 1 NY NN NN NN");
    // Cabbage: alert sent, nothing answered -> waiting.
    await raise("F062", "black_rot", "new", "forecast");
    // Maize F043: streak virus answered mid-way -> provisional go now.
    await raise("F043", "maize_leaf_blights", "new", "forecast");
    await answer("+2650000000043", "1 1 NN NN NN Y");

    const lines = priorityList(await store.flagRows());
    expect(lines.map((l) => [l.farmer.id, l.rank])).toEqual([
      ["F043", "go_now"],
      ["F014", "this_week"],
      ["F084", "no_response"],
      ["F027", "recheck"],
      ["F062", "waiting"],
    ]);
    expect(lines[0]).toMatchObject({ provisional: true, answered: 7, state: "answering" });
    expect(lines[0].text).toContain("provisional, 7/8 answered");
  });

  it("shows one line per farm, with its other flags listed under it", async () => {
    await raise("F056", "late_blight");
    await raise("F056", "maize_leaf_blights");
    const lines = priorityList(await store.flagRows());
    expect(lines).toHaveLength(1);
    expect(lines[0].also).toEqual([expect.objectContaining({ crop: expect.any(String), state: "waiting", queued: true })]);
  });

  it("leads with the questionnaire in front of the farmer, not one queued behind it", async () => {
    await raise("F062", "black_rot");
    await raise("F062", "clubroot");
    await answer("+2650000000062", "1 1"); // English, cabbages
    const [line] = priorityList(await store.flagRows());
    expect(line).toMatchObject({ flagged: "black rot", crop: "cabbage", queued: false });
    expect(line.also).toEqual([expect.objectContaining({ flagged: "clubroot", queued: true })]);
  });

  it("leaves out flags merged into an open questionnaire", async () => {
    await raise("F056", "late_blight");
    await raise("F056", "late_blight", "worse");
    const lines = priorityList(await store.flagRows());
    expect(lines).toHaveLength(1);
    expect(lines[0].also).toEqual([]);
  });

  it("leaves out plants the farmer chose not to report on", async () => {
    await raise("F056", "late_blight");
    await raise("F056", "maize_leaf_blights");
    await answer("+2650000000056", "1 1 NN NN NN NN 2"); // tomatoes, then no more plants
    const lines = priorityList(await store.flagRows());
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ crop: "tomato", rank: "none", also: [] });
    expect(summary(await store.flagRows(), 8)).toMatchObject({ flags: 1, response_rate: 1 });
  });
});

describe("Felix's summary", () => {
  it("counts flags, answers, outcomes and what the answers point to", async () => {
    await raise("F056", "late_blight", "new", "scenario");
    await answer("+2650000000056", "1 1 NN NN NN YY"); // wrong flag: bacterial wilt
    await raise("F014", "maize_leaf_blights", "new", "forecast");
    await answer("+2650000000014", "1 1 YY YY YY NN"); // confirmed urgent: grey leaf spot
    await raise("F027", "bean_leaf_diseases", "new", "forecast");

    const s = summary(await store.flagRows(), 8);
    expect(s).toMatchObject({
      farmers: 8,
      flagged_farms: 3,
      flags: 3,
      scenario_flags: 1,
      states: { answered: 2, answering: 0, waiting: 1, no_response: 0 },
      response_rate: 0.67,
      urgent: 2,
      wrong_flag_rate: 0.5,
      outcomes: { confirmed_urgent: 1, confirmed: 0, wrong_flag: 1, early_signs: 0, clear: 0 },
    });
    // Ties sort by name.
    expect(s.answers_say).toEqual([
      { problem: "bacterial wilt", count: 1 },
      { problem: "grey leaf spot", count: 1 },
    ]);
    expect(s.by_disease.find((d) => d.disease === "late_blight")).toMatchObject({ flags: 1, answered: 1, wrong_flag: 1 });
  });

  it("has no rates before anyone has been asked", () => {
    expect(summary([], 8)).toMatchObject({ response_rate: null, wrong_flag_rate: null, flags: 0 });
  });
});

describe("formatting", () => {
  it("shortens names the way the document does", () => {
    expect(shortName("John Banda")).toBe("BANDA J.");
    expect(shortName("Mary Grace Phiri")).toBe("PHIRI M. G.");
    expect(shortName("Chikondi")).toBe("CHIKONDI");
  });

  it("writes only the conditions the flag recorded", () => {
    expect(conditionsLine({ air_temp: 19.4, leaf_wet_hours: 72, rain_mm: 28.8 })).toBe("Air 19C, 72 h wet, rain 29 mm");
    expect(conditionsLine({})).toBe("");
  });
});
