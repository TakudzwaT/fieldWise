// What FieldWise says to farmers outside the questions themselves: alerts,
// reminders, and the screens around the questionnaires ("which plant?",
// "another plant?"). Like the questions, these name the crop and never a
// disease. Chichewa is an unverified draft.

import { normalize, yesNo, type Prompt } from "./engine";
import { CROP_LABEL, CROP_NAME, CROP_WORDS, type Crop, type Lang, type Text } from "./questionnaires";
import type { FlagReason } from "./store";

type Template = (crop: string) => Text;

/**
 * The USSD code farmers dial. A placeholder until a code is leased from
 * Airtel and TNM through a gateway such as Africa's Talking.
 */
export const USSD_CODE = "*384*123#";

const DIAL: Text = {
  en: `Dial ${USSD_CODE} to answer.`,
  ny: `Imbani ${USSD_CODE} kuti muyankhe.`,
};

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
  // The farmer's own report is answered in the same USSD session, so this
  // only goes out if they need reminding.
  report: {
    en: "FieldWise: thank you for telling us about a crop problem. Please answer a few questions about it.",
    ny: "FieldWise: zikomo potiuza za vuto la mbewu. Chonde yankhani mafunso ochepa okhudza vutoli.",
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

/** "Dial *384*123# to answer.", added to an SMS that asks a question. */
export const dialText = (lang: Lang | null) => say((l) => DIAL[l], lang);

/** An officer's message to a farmer: "Felix (FieldWise): ..." */
export const officerText = (officer: string, text: string) => `${officer} (FieldWise): ${text}`;

// Felix's ready-made replies. They promise a visit or give general advice;
// what to spray is for Felix to say in person. Chichewa is an unverified draft.
export const ADVICE = {
  visit_today: {
    label: "Visiting today",
    text: {
      en: "I will visit your farm today to look at your crops.",
      ny: "Ndibwera kumunda kwanu lero kudzaona mbewu zanu.",
    },
  },
  visit_week: {
    label: "Visiting this week",
    text: {
      en: "I will visit your farm this week to look at your crops.",
      ny: "Ndibwera kumunda kwanu sabata ino kudzaona mbewu zanu.",
    },
  },
  remove_leaves: {
    label: "Remove affected plants",
    text: {
      en: "Remove badly affected leaves or plants. Take them out of the field and burn or bury them. Wash your hands and tools afterwards.",
      ny: "Chotsani masamba kapena mbewu zowonongeka kwambiri. Zitulutseni m'munda ndi kuzitentha kapena kuzikwirira. Kenako sambani m'manja ndi zipangizo.",
    },
  },
  keep_watching: {
    label: "Keep checking",
    text: {
      en: `Keep checking your plants every few days. Dial ${USSD_CODE} if it gets worse.`,
      ny: `Pitirizani kuyang'ana mbewu zanu masiku angapo aliwonse. Imbani ${USSD_CODE} ngati zikuipiraipira.`,
    },
  },
  all_clear: {
    label: "All clear",
    text: {
      en: "Thank you for your answers. Your crops look fine for now. No action is needed.",
      ny: "Zikomo chifukwa cha mayankho anu. Mbewu zanu zili bwino pakadali pano. Palibe chochita.",
    },
  },
} satisfies Record<string, { label: string; text: Text }>;
export type AdviceId = keyof typeof ADVICE;

/** A ready-made reply in the farmer's language, or both while it is not known. */
export const adviceText = (id: AdviceId, lang: Lang | null) => say((l) => ADVICE[id].text[l], lang);

// USSD screens. A screen holds about 182 characters, so these are short.

/** "Felix", or "your officer" for a farmer without one. */
const officerName = (name: string | null, lang: Lang) => name ?? (lang === "en" ? "your officer" : "mlangizi wanu");

/** The menu a farmer sees when they dial with nothing waiting (or press 0). */
export function homePrompt(lang: Lang, officer: string | null, roundOpen: boolean, retry = false): Prompt {
  const name = officerName(officer, lang);
  const items: Record<Lang, string[]> = {
    en: [roundOpen ? "Answer our questions" : "Report a crop problem", `Messages from ${name}`, `Ask ${name} to call me`, "Language"],
    ny: [roundOpen ? "Yankhani mafunso athu" : "Nenani vuto la mbewu", `Mauthenga ochokera kwa ${name}`, `${name} andiyimbire foni`, "Chiyankhulo"],
  };
  return {
    key: "home",
    body: retry ? `${NUMBER_RETRY[lang]}\nFieldWise` : "FieldWise",
    options: items[lang].map((label, i) => ({ reply: String(i + 1), label })),
  };
}

const NUMBER_RETRY: Text = { en: "Please reply with a number.", ny: "Chonde yankhani ndi nambala." };

const REPORT_PICK: Text = { en: "Which plant has a problem?", ny: "Ndi mbewu iti yomwe ili ndi vuto?" };

/** "Which plant has a problem?" with every crop FieldWise asks about. */
export function reportPrompt(crops: readonly Crop[], lang: Lang, retry = false): Prompt {
  return {
    key: "report",
    body: retry ? `${NUMBER_RETRY[lang]}\n${REPORT_PICK[lang]}` : REPORT_PICK[lang],
    options: crops.map((crop, i) => ({ reply: String(i + 1), label: CROP_NAME[crop][lang] })),
  };
}

export const callbackText = (officer: string | null, lang: Lang, already: boolean) => {
  const name = officerName(officer, lang);
  if (already) return lang === "en" ? `${name} already has your request and will call you soon.` : `${name} walandira kale pempho lanu ndipo akuyimbirani posachedwa.`;
  return lang === "en" ? `Thank you. ${name} will call you soon.` : `Zikomo. ${name} akuyimbirani foni posachedwa.`;
};

export const noOfficerMessagesText = (officer: string | null, lang: Lang) => {
  const name = officerName(officer, lang);
  return lang === "en" ? `No messages from ${name} yet.` : `Palibe mauthenga ochokera kwa ${name} pano.`;
};

/** One message in the USSD inbox, newest first, with a way back. */
export function inboxPrompt(body: string, hasOlder: boolean, lang: Lang): Prompt {
  const options = [{ reply: "0", label: lang === "en" ? "Menu" : "Menyu" }];
  if (hasOlder) options.unshift({ reply: "1", label: lang === "en" ? "Older" : "Akale" });
  return { key: "inbox", body, options };
}

/**
 * The wards farmers pick from. Placeholders: ten places around Kasungu
 * district, to be replaced with the official ward list for Felix's area.
 */
export const WARDS = [
  "Kasungu Boma",
  "Chulu",
  "Santhe",
  "Kaluluma",
  "Chamama",
  "Mtunthama",
  "Bua",
  "Lisasadzi",
  "Kapelula",
  "Nkhamenya",
] as const;

const WARD_ASK: Text = { en: "Which ward is your farm in?", ny: "Kodi munda wanu uli m'dera liti?" };

/** "Which ward is your farm in?", the first question after the language. */
export function wardPrompt(lang: Lang, retry = false): Prompt {
  return {
    key: "ward",
    body: retry ? `${NUMBER_RETRY[lang]}\n${WARD_ASK[lang]}` : WARD_ASK[lang],
    options: WARDS.map((ward, i) => ({ reply: String(i + 1), label: ward })),
  };
}

/** The ward a reply picks: its number or its name. */
export function parseWard(input: string): string | null {
  const word = normalize(input);
  const n = Number(word);
  if (Number.isInteger(n) && n >= 1 && n <= WARDS.length) return WARDS[n - 1];
  return WARDS.find((w) => normalize(w) === word) ?? null;
}

/** What a pushed USSD screen starts with when the full alert won't fit. */
const PUSH_INTRO: Text = {
  en: "FieldWise: this week's weather can harm your crops.",
  ny: "FieldWise: nyengo ya sabata ino ikhoza kuwononga mbewu zanu.",
};
export const pushIntroText = (lang: Lang | null) => (lang ? PUSH_INTRO[lang] : "FieldWise: weather alert / chenjezo la nyengo");

const PUSH_MISSED: Text = {
  en: `FieldWise: we tried to reach you about your crops. Dial ${USSD_CODE} to answer.`,
  ny: `FieldWise: tinayesa kukupezani za mbewu zanu. Imbani ${USSD_CODE} kuti muyankhe.`,
};
/** The SMS after a pushed USSD session nobody answered. */
export const pushMissedText = (lang: Lang | null) => say((l) => PUSH_MISSED[l], lang);

/** The "0 Menu" line under a question on USSD. */
export const menuOption = (lang: Lang) => ({ reply: "0", label: lang === "en" ? "Menu" : "Menyu" });

export const USSD_NOT_REGISTERED =
  "FieldWise: this number is not registered. Ask your extension officer to add you.\nNambala iyi sinalembetsedwe. Funsani mlangizi wanu.";
