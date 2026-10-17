// What FieldWise says to farmers outside the questions themselves. Like the
// questions, these name the crop and never a disease. Chichewa is an
// unverified draft.

import { CROP_LABEL, type Crop, type Lang, type Text } from "./questionnaires";
import type { FlagReason } from "./store";

type Template = (crop: string) => Text;

const ALERT: Record<FlagReason, Template> = {
  new: (crop) => ({
    en: `FieldWise: this week's weather can bring problems to ${crop}. Please check your plants today and answer 8 quick questions.`,
    ny: `FieldWise: nyengo ya sabata ino ikhoza kubweretsa mavuto pa ${crop}. Chonde yang'anani mbewu zanu lero ndi kuyankha mafunso 8 achidule.`,
  }),
  manual: (crop) => ALERT.new(crop),
  worse: (crop) => ({
    en: `FieldWise: the weather is getting worse for ${crop}. Please check your plants again today and answer 8 quick questions.`,
    ny: `FieldWise: nyengo ikuipiraipira pa ${crop}. Chonde yang'anani mbewu zanu lero ndi kuyankha mafunso 8 achidule.`,
  }),
  recheck: (crop) => ({
    en: `FieldWise: please check ${crop} again. Some problems take a week or two to show.`,
    ny: `FieldWise: chonde yang'aniraninso ${crop}. Mavuto ena amatenga sabata imodzi kapena ziwiri kuti aoneke.`,
  }),
};

const NUDGE: Template = (crop) => ({
  en: `FieldWise: the weather is getting worse for ${crop}. Please finish the questions below.`,
  ny: `FieldWise: nyengo ikuipiraipira pa ${crop}. Chonde malizani mafunso ali m'munsimu.`,
});

const REMINDER: Template = (crop) => ({
  en: `FieldWise: we are still waiting for your answers about ${crop}.`,
  ny: `FieldWise: tikudikirabe mayankho anu okhudza ${crop}.`,
});

const NO_QUESTIONS: Text = {
  en: "FieldWise: there are no questions for you right now. We will message you when your crop needs checking.",
  ny: "FieldWise: palibe mafunso pano. Tidzakutumizirani uthenga mbewu zanu zikafunika kuyang'aniridwa.",
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

export const alertText = (reason: FlagReason, crop: Crop, lang: Lang | null) =>
  say((l) => ALERT[reason](cropInSentence(crop, l))[l], lang);

export const nudgeText = (crop: Crop, lang: Lang | null) => say((l) => NUDGE(cropInSentence(crop, l))[l], lang);

export const reminderText = (crop: Crop, lang: Lang | null) => say((l) => REMINDER(cropInSentence(crop, l))[l], lang);

export const noQuestionsText = (lang: Lang | null) => say((l) => NO_QUESTIONS[l], lang);
