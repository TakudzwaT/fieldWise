import { describe, expect, it } from "vitest";
import { evaluate, severity, type Status, type Track } from "../src/trigger";

const HOUR = 60 * 60 * 1000;
const t0 = new Date("2026-10-20T06:00:00Z");
const at = (hours: number) => new Date(t0.getTime() + hours * HOUR);

/** Run a sequence of forecast results through the trigger; returns the alerts. */
function run(steps: [Status, number | null, number][]) {
  let track: Track | undefined;
  return steps.map(([status, measure, hours]) => {
    const result = evaluate(track, status, measure, at(hours));
    track = result.track;
    return result.alert;
  });
}

describe("trigger", () => {
  it("alerts when conditions newly favour a disease", () => {
    expect(run([["clear", null, 0], ["watch", 8, 3], ["flag", 11, 6]])).toEqual([null, null, "new"]);
  });

  it("alerts a farm flagged on its very first check", () => {
    expect(run([["flag", 12, 0]])).toEqual(["new"]);
  });

  it("does not alert again while the same spell continues", () => {
    expect(run([["flag", 10, 0], ["flag", 11, 3], ["flag", 12, 6], ["flag", 10, 9]])).toEqual(["new", null, null, null]);
  });

  it("does not alert again when a spell wobbles between flag and watch", () => {
    expect(run([["flag", 10, 0], ["watch", 9, 3], ["flag", 10, 6], ["watch", 9, 9], ["flag", 11, 12]])).toEqual([
      "new",
      null,
      null,
      null,
      null,
    ]);
  });

  it("alerts again once conditions clear and a new spell starts", () => {
    expect(run([["flag", 10, 0], ["clear", null, 3], ["flag", 10, 6]])).toEqual(["new", null, "new"]);
  });

  it("alerts again when the spell gets much worse, but at most once a day", () => {
    // Leaves wet 10 h -> 24 h within 6 hours: held back by the daily limit,
    // then sent once 24 hours have passed.
    expect(run([["flag", 10, 0], ["flag", 24, 6], ["flag", 24, 24]])).toEqual(["new", null, "worse"]);
  });

  it("small increases are not 'much worse'", () => {
    expect(run([["flag", 10, 0], ["flag", 14, 30]])).toEqual(["new", null]);
    expect(run([["flag", 2, 0], ["flag", 6, 30]])).toEqual(["new", null]); // tripled but only +4
  });

  it("measures each disease by its own weather", () => {
    const window = { leaf_wet_run_max: 14, wet_or_humid_run_max: 20, rain_total: 8.5 };
    expect(severity("late_blight", window)).toBe(14);
    expect(severity("maize_leaf_blights", window)).toBe(20);
    expect(severity("black_rot", window)).toBe(8.5);
    expect(severity("clubroot", window)).toBeNull();
  });

  it("soil-branch diseases alert once per spell and never as 'worse'", () => {
    expect(run([["flag", null, 0], ["flag", null, 48]])).toEqual(["new", null]);
  });
});
