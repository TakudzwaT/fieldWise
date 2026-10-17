// What FieldWise says to farmers outside the questions themselves: alerts,
// reminders, and the screens around the questionnaires ("which plant?",
// "another plant?"). Like the questions, these name the crop and never a
// disease. Chichewa is an unverified draft.

import { normalize, yesNo, type Prompt } from "./engine";
import { CROP_LABEL, CROP_NAME, CROP_WORDS, type Crop, type Lang, type Text } from "./questionnaires";
import type { FlagReason } from "./store";

type Template = (crop: string) => Text;

// A round's alert is about the farm, not one plant: the farmer picks which
// at-risk plant to report on next. A re-check is about one plant.
const ALERT: Record<Exclude<FlagReason, "recheck">, Text> = {
  new: {
    en: "FieldWise: this week's weather can bring problems to your crops. Please check your plants today and tell us what you see.",
    ny: "FieldWise: nyengo ya sabata ino ikhoza kubweretsa mavuto pa mbewu zanu. Chonde yang'anani mbewu zanu lero ndi kutiuza zomwe mwaona.",
  },
  manual: {
    en: "FieldWise: your extension officer has asked you to check your crops. Please check your plants today and tell us what you see.",
    ny: "FieldWise: mlangizi wanu wa zaulimi wapempha kuti muyang'ane mbewu zanu. Chonde yang'anani mbewu zanu lero ndi kutiuza zomwe mwaona.",
  },
  worse: {
    en: "FieldWise: the weather is getting worse for your crops. Please check your plants again today and tell us what you see.",
    ny: "FieldWise: nyengo ikuipiraipira pa mbewu zanu. Chonde yang'aniraninso mbewu zanu lero ndi kutiuza zomwe mwaona.",
  },
};

const RECHECK: Template = (crop) => ({
  en: `FieldWise: please check ${crop} again. Some problems take a week or two to show.`,
  ny: `FieldWise: chonde yang'aniraninso ${crop}. Mavuto ena amatenga sabata imodzi kapena ziwiri kuti aoneke.`,
});

const NUDGE: Template = (crop) => ({
  en: `FieldWise: the weather is getting worse for ${crop}. Please finish the questions below.`,
  ny: `FieldWise: nyengo ikuipiraipira pa ${crop}. Chonde malizani mafunso ali m'munsimu.`,
});

const REMINDER: Text = {
  en: "FieldWise: we are still waiting for your answers.",
  ny: "FieldWise: tikudikirabe mayankho anu.",
};

const PICK: Text = {
  en: "Which plant do you want to report on?",
  ny: "Kodi mukufuna kutiuza za mbewu iti?",
};

const PICK_RETRY: Text = {
  en: "Please reply with the number of a plant.",
  ny: "Chonde yankhani ndi nambala ya mbewu.",
};

const MORE: Text = {
  en: "Do you want to report on another plant?",
  ny: "Kodi mukufuna kutiuza za mbewu ina?",
};

const YES_NO_RETRY: Text = {
  en: "Please reply 1 for Yes or 2 for No.",
  ny: "Chonde yankhani 1 kuti Inde kapena 2 kuti Ayi.",
};

const CROP_DONE: Template = (crop) => ({
  en: `Thank you. Your answers about ${crop} have been sent to your extension officer.`,
  ny: `Zikomo. Mayankho anu okhudza ${crop} atumizidwa kwa mlangizi wanu wa zaulimi.`,
});

const SAME_CROP_NEXT: Template = (crop) => ({
  en: `Thank you. A few more questions about ${crop}.`,
  ny: `Zikomo. Mafunso enanso ochepa okhudza ${crop}.`,
});

const ALL_DONE: Text = {
  en: "Thank you. Your answers have been sent to your extension officer.",
  ny: "Zikomo. Mayankho anu atumizidwa kwa mlangizi wanu wa zaulimi.",
};

const NO_QUESTIONS: Text = {
  en: "FieldWise: there are no questions for you right now. We will message you when your crop needs checking.",
  ny: "FieldWise: palibe mafunso pano. Tidzakutumizirani uthenga mbewu zanu zikafunika kuyang'aniridwa.",
};

const STALE: Text = {
  en: "FieldWise: that button was for an earlier question. Here is the current one.",
  ny: "FieldWise: batani limenelo linali la funso lakale. Nali funso la tsopano.",
};

const STOPPED: Text = {
  en: "FieldWise: you will get no more messages, and your details have been deleted. To come back, text JOIN and your crop.",
  ny: "FieldWise: simudzalandiranso mauthenga, ndipo zambiri zanu zachotsedwa. Kuti mubwerere, tumizani JOIN ndi mbewu yanu.",
};

export const NOT_REGISTERED =
  "FieldWise: this number is not registered. Ask your extension officer to add you.\n\n" +
  "FieldWise: nambala iyi sinalembetsedwe. Funsani mlangizi wanu wa zaulimi kuti akulembetseni.";

/** "your tomatoes" / "matimati anu", for use inside a sentence. */
function cropInSentence(crop: Crop, lang: Lang): string {
  const label = CROP_LABEL[crop][lang];
  return lang === "en" ? label.toLowerCase() : label.charAt(0).toLowerCase() + label.slice(1);
}

/** In the farmer's language, or both while it is not known yet. */
function say(text: (lang: Lang) => string, lang: Lang | null): string {
  return lang ? text(lang) : `${text("en")}\n\n${text("ny")}`;
}

/** The alert that opens a round. A re-check names its plant. */
export const alertText = (reason: FlagReason, crop: Crop, lang: Lang | null) =>
  say((l) => (reason === "recheck" ? RECHECK(cropInSentence(crop, l))[l] : ALERT[reason][l]), lang);

export const nudgeText = (crop: Crop, lang: Lang | null) => say((l) => NUDGE(cropInSentence(crop, l))[l], lang);

export const reminderText = (lang: Lang | null) => say((l) => REMINDER[l], lang);

/** "Which plant do you want to report on?" with the plants at risk as numbered options. */
export function pickPrompt(crops: Crop[], lang: Lang, retry = false): Prompt {
  return {
    key: "pick",
    body: retry ? `${PICK_RETRY[lang]}\n${PICK[lang]}` : PICK[lang],
    options: crops.map((crop, i) => ({ reply: String(i + 1), label: CROP_NAME[crop][lang] })),
  };
}

/** The plant a reply to the pick screen chose: its number or its name. */
export function parsePick(input: string, crops: Crop[]): Crop | null {
  const word = normalize(input);
  const n = Number(word);
  if (Number.isInteger(n) && n >= 1 && n <= crops.length) return crops[n - 1];
  const crop = CROP_WORDS[word];
  return crop && crops.includes(crop) ? crop : null;
}

/** "Do you want to report on another plant?" */
export function morePrompt(lang: Lang, retry = false): Prompt {
  return { key: "more", body: retry ? `${YES_NO_RETRY[lang]}\n${MORE[lang]}` : MORE[lang], options: yesNo(lang) };
}

export const cropDoneText = (crop: Crop, lang: Lang) => CROP_DONE(cropInSentence(crop, lang))[lang];

export const sameCropNextText = (crop: Crop, lang: Lang) => SAME_CROP_NEXT(cropInSentence(crop, lang))[lang];

export const allDoneText = (lang: Lang) => ALL_DONE[lang];

export const noQuestionsText = (lang: Lang | null) => say((l) => NO_QUESTIONS[l], lang);

export const staleText = (lang: Lang | null) => say((l) => STALE[l], lang);

export const stoppedText = (lang: Lang | null) => say((l) => STOPPED[l], lang);
