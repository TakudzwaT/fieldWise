import { describe, expect, it } from "vitest";
import { STEPS, reply, start, toText } from "../src/engine";
import { DISEASES, QUESTIONNAIRES } from "../src/questionnaires";

describe("engine", () => {
  it("asks for a language first when it is not known", () => {
    const turn = start("late_blight");
    expect(turn.prompt.body).toContain("choose your language");
    const next = reply(turn.session, "2");
    expect(next.session.lang).toBe("ny");
    expect(next.prompt.header).toBe("Matimati anu · 1 mwa 8");
    expect(next.prompt.options.map((o) => o.label)).toEqual(["Inde", "Ayi"]);
  });

  it("names the crop and never the disease", () => {
    for (const disease of DISEASES) {
      let turn = start(disease, "en");
      const { name, other } = QUESTIONNAIRES[disease];
      while (!turn.done) {
        expect(toText(turn.prompt).toLowerCase()).not.toContain(name);
        expect(toText(turn.prompt).toLowerCase()).not.toContain(other);
        turn = reply(turn.session, "1");
      }
      expect(start(disease, "en").prompt.header).toMatch(/^Your \w+ · 1 of 8$/);
    }
  });

  it("asks the yes follow-up after a yes and the no follow-up after a no", () => {
    const first = start("late_blight", "en");
    expect(reply(first.session, "yes").prompt.body).toBe("Are the patches bigger than your thumbnail?");
    expect(reply(first.session, "no").prompt.body).toMatch(/^Look at the lowest leaves/);
  });

  it("takes exactly eight answers, then thanks the farmer", () => {
    let turn = start("clubroot", "en");
    for (let i = 0; i < STEPS; i++) {
      expect(turn.done).toBe(false);
      turn = reply(turn.session, i % 2 ? "2" : "1");
    }
    expect(turn.done).toBe(true);
    expect(turn.prompt.body).toMatch(/^Thank you/);
    expect(turn.session.answers).toEqual([
      { main: true, follow: false },
      { main: true, follow: false },
      { main: true, follow: false },
      { main: true, follow: false },
    ]);
  });

  it("repeats the screen on a reply it does not understand", () => {
    const first = start("maize_leaf_blights", "en");
    const turn = reply(first.session, "maybe");
    expect(turn.retry).toBe(true);
    expect(turn.session.step).toBe(0);
    expect(turn.prompt.body).toMatch(/^Please reply 1 for Yes or 2 for No\./);
  });

  it("understands typed words in both languages", () => {
    const first = start("black_rot", "ny");
    expect(reply(first.session, " Inde! ").session.answers[0]).toEqual({ main: true });
    expect(reply(first.session, "AYI").session.answers[0]).toEqual({ main: false });
  });

  it("resumes from a stored session without losing answers", () => {
    let turn = start("bacterial_wilt", "en");
    turn = reply(turn.session, "1");
    turn = reply(turn.session, "1");
    const stored = JSON.parse(JSON.stringify(turn.session));
    const resumed = reply(stored, "2");
    expect(resumed.session.step).toBe(3);
    expect(resumed.session.answers).toEqual([{ main: true, follow: true }, { main: false }]);
  });

  it("does not change the session it was given", () => {
    const first = start("bean_leaf_diseases", "en");
    reply(first.session, "1");
    expect(first.session.step).toBe(0);
    expect(first.session.answers).toEqual([]);
  });

  it("has every question in both languages", () => {
    for (const disease of DISEASES) {
      for (const q of QUESTIONNAIRES[disease].questions) {
        for (const text of [q.ask, q.yes.ask, q.no.ask]) {
          expect(text.en.length).toBeGreaterThan(10);
          expect(text.ny.length).toBeGreaterThan(10);
        }
      }
    }
  });
});
