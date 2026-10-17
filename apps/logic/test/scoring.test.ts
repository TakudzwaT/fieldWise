import { describe, expect, it } from "vitest";
import { reply, start } from "../src/engine";
import type { DiseaseId } from "../src/questionnaires";
import { byPriority, score } from "../src/scoring";

/** Answer a questionnaire through the engine. "YN YY NN NY" = four main/follow pairs. */
function answer(disease: DiseaseId, pattern: string) {
  let turn = start(disease, "en");
  for (const ch of pattern.replace(/\s/g, "")) turn = reply(turn.session, ch === "Y" ? "1" : "2");
  return turn.session.answers;
}

describe("late blight, tomato", () => {
  it("white fuzz confirms it; worse over half the field makes it urgent", () => {
    const report = score("late_blight", answer("late_blight", "YY YN YY NN"));
    expect(report).toMatchObject({ outcome: "confirmed_urgent", priority: "go_now", urgent: true, answersSay: ["late blight"] });
  });

  it("confirmed with limited spread is a visit this week", () => {
    const report = score("late_blight", answer("late_blight", "YY YN YN NN"));
    expect(report).toMatchObject({ outcome: "confirmed", priority: "this_week", urgent: false });
  });

  it("Q4 yes-yes outranks everything as a bacterial wilt report (the document's BANDA J. example)", () => {
    const report = score("late_blight", answer("late_blight", "NN NN NN YY"));
    expect(report).toMatchObject({ outcome: "wrong_flag", answersSay: ["bacterial wilt"], urgent: true, priority: "go_now" });
    expect(report.answerLine).toBe(
      "Q1 wet patches N, lowest leaves marked N | Q2 white fuzz N, dry papery N | Q3 worse N, began after heavy rain N | Q4 wilt, leaves green Y, recovers at night Y",
    );
  });

  it("Q4 outranks even a confirmed late blight", () => {
    expect(score("late_blight", answer("late_blight", "YY YY NN YY")).outcome).toBe("wrong_flag");
  });

  it("dry papery patches mark a likely wrong flag", () => {
    const report = score("late_blight", answer("late_blight", "YN NY NN NN"));
    expect(report.likelyWrongFlag).toBe(true);
    expect(report.notes.join()).toMatch(/likely a wrong flag/);
  });

  it("only no-branch signs is early signs: re-check", () => {
    const report = score("late_blight", answer("late_blight", "NY NN NN NY"));
    expect(report).toMatchObject({ outcome: "early_signs", priority: "recheck", signs: ["lowest leaves marked", "field wet"] });
  });

  it("all no is clear, with no re-ask", () => {
    expect(score("late_blight", answer("late_blight", "NN NN NN NN"))).toMatchObject({
      outcome: "clear",
      priority: "none",
      recheckInDays: null,
      complete: true,
    });
  });
});

describe("bacterial wilt, tomato", () => {
  it("green leaves that wilt by day and recover at night confirm it", () => {
    expect(score("bacterial_wilt", answer("bacterial_wilt", "YY YY NN NN")).outcome).toBe("confirmed");
  });

  it("wilted leaves turning yellow do not confirm it", () => {
    expect(score("bacterial_wilt", answer("bacterial_wilt", "YN YN NN NN")).outcome).toBe("early_signs");
  });

  it("yellow, dry lower leaves point to water or nitrogen", () => {
    const report = score("bacterial_wilt", answer("bacterial_wilt", "YN NY NN NN"));
    expect(report.likelyWrongFlag).toBe(true);
    expect(report.notes.join()).toMatch(/water shortage or nitrogen/);
  });

  it("wet patches with white fuzz is late blight instead", () => {
    expect(score("bacterial_wilt", answer("bacterial_wilt", "NN NN NN YY"))).toMatchObject({
      outcome: "wrong_flag",
      answersSay: ["late blight"],
      priority: "this_week",
    });
  });
});

describe("maize leaf blights", () => {
  it("Q2 tells grey leaf spot from northern leaf blight", () => {
    expect(score("maize_leaf_blights", answer("maize_leaf_blights", "YY YY NN NY")).answersSay).toEqual(["grey leaf spot"]);
    expect(score("maize_leaf_blights", answer("maize_leaf_blights", "YY NY NN NY")).answersSay).toEqual(["northern leaf blight"]);
  });

  it("reaching the leaves above the cob is urgent", () => {
    const report = score("maize_leaf_blights", answer("maize_leaf_blights", "YY YY YY NY"));
    expect(report).toMatchObject({ outcome: "confirmed_urgent", priority: "go_now" });
    expect(report.notes).toContain("Damage above the cob costs yield.");
  });

  it("streak virus stripes are urgent regardless of every other answer", () => {
    const alone = score("maize_leaf_blights", answer("maize_leaf_blights", "NN NN NN YN"));
    expect(alone).toMatchObject({ outcome: "wrong_flag", answersSay: ["maize streak virus"], urgent: true, priority: "go_now" });
    const withBlight = score("maize_leaf_blights", answer("maize_leaf_blights", "YY YY NN YY"));
    expect(withBlight).toMatchObject({ answersSay: ["grey leaf spot", "maize streak virus"], urgent: true, priority: "go_now" });
  });

  it("a no to 'normal height' is the worrying answer", () => {
    expect(score("maize_leaf_blights", answer("maize_leaf_blights", "NN NN NN NN")).signs).toEqual(["normal height"]);
    expect(score("maize_leaf_blights", answer("maize_leaf_blights", "NN NN NN NY")).outcome).toBe("clear");
  });
});

describe("bean leaf diseases", () => {
  it("separates angular leaf spot from rust", () => {
    expect(score("bean_leaf_diseases", answer("bean_leaf_diseases", "YY YY NN NN")).answersSay).toEqual(["angular leaf spot"]);
    expect(score("bean_leaf_diseases", answer("bean_leaf_diseases", "YN NY NN NN")).answersSay).toEqual(["bean rust"]);
  });

  it("the wet-spell length says which is more likely", () => {
    const answers = answer("bean_leaf_diseases", "YY YY NN NN");
    expect(score("bean_leaf_diseases", answers, { leafWetHours: 30 }).notes.join()).toMatch(/both likely/);
    expect(score("bean_leaf_diseases", answers, { leafWetHours: 12 }).notes.join()).toMatch(/points at rust/);
  });

  it("rotten stems at the soil is root rot", () => {
    expect(score("bean_leaf_diseases", answer("bean_leaf_diseases", "NN NN NN YY"))).toMatchObject({
      outcome: "wrong_flag",
      answersSay: ["bean root rot"],
    });
  });
});

describe("black rot, cabbage", () => {
  it("black veins confirm it; black into the stem notes it will not recover", () => {
    const report = score("black_rot", answer("black_rot", "YY YY NN NN"));
    expect(report.outcome).toBe("confirmed");
    expect(report.notes.join()).toMatch(/will not recover/);
  });

  it("a clear result is re-asked a week later", () => {
    const report = score("black_rot", answer("black_rot", "NN NN NN NN"));
    expect(report).toMatchObject({ outcome: "clear", recheckInDays: 7 });
    expect(report.notes.join()).toMatch(/too early to see/);
  });

  it("swollen roots on wilting plants is clubroot instead", () => {
    expect(score("black_rot", answer("black_rot", "NN NN NN YY")).answersSay).toEqual(["clubroot"]);
  });
});

describe("clubroot, cabbage", () => {
  it("swollen roots confirm it", () => {
    expect(score("clubroot", answer("clubroot", "YY YY NN NN")).outcome).toBe("confirmed");
  });

  it("dark rotten roots without swelling go to Felix as a different root problem", () => {
    const report = score("clubroot", answer("clubroot", "YY NY NN NN"));
    expect(report).toMatchObject({ outcome: "wrong_flag", answersSay: ["root rot"], likelyWrongFlag: true });
  });

  it("the same spot in past seasons means an infested field: rotation and liming", () => {
    const report = score("clubroot", answer("clubroot", "YY YY NY NN"));
    expect(report.notes.join()).toMatch(/rotation and liming/);
  });

  it("V-shaped yellow edges with black veins is black rot instead", () => {
    expect(score("clubroot", answer("clubroot", "NN NN NN YY")).answersSay).toEqual(["black rot"]);
  });
});

describe("partial answers and sorting", () => {
  it("scores a session that stopped partway and marks it incomplete", () => {
    const report = score("late_blight", answer("late_blight", "YY Y"));
    expect(report).toMatchObject({ outcome: "confirmed", complete: false });
    expect(report.answerLine).toBe("Q1 wet patches Y, bigger than thumbnail Y | Q2 white fuzz Y");
  });

  it("puts urgent reports first", () => {
    const priorities = (["none", "go_now", "recheck", "this_week"] as const).map((priority) => ({ priority }));
    expect([...priorities].sort(byPriority).map((r) => r.priority)).toEqual(["go_now", "this_week", "recheck", "none"]);
  });
});
