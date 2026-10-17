// Walks a farmer through one questionnaire, one answer at a time. Channel
// agnostic: WhatsApp, the web simulator and (later) USSD all send the farmer's
// reply in and render the Prompt that comes back.
//
// A session is plain JSON, so it can be stored between messages. A farmer who
// stops partway resumes at the same screen on their next message.

import { CROP_LABEL, QUESTIONNAIRES, type Answers, type DiseaseId, type Lang, type Text } from "./questionnaires";

/** Eight screens: four main questions, each followed by one follow-up. */
export const STEPS = 8;

export interface Session {
  disease: DiseaseId;
  /** Null until the farmer picks a language. */
  lang: Lang | null;
  /** 0-7 while answering, 8 when done. Even steps are main questions. */
  step: number;
  answers: Answers;
}

export interface Prompt {
  header?: string;
  body: string;
  /** The replies on offer; channels show them as buttons or as "1 Yes". */
  options: { reply: string; label: string }[];
}

export interface Turn {
  session: Session;
  prompt: Prompt;
  /** True once the last answer is in. */
  done: boolean;
  /** True when the reply was not understood and the screen is repeated. */
  retry: boolean;
}

const MESSAGES = {
  chooseLanguage: "FieldWise: choose your language / Sankhani chiyankhulo",
  retry: {
    en: "Please reply 1 for Yes or 2 for No.",
    ny: "Chonde yankhani 1 kuti Inde kapena 2 kuti Ayi.",
  },
  thanks: {
    en: "Thank you. Your answers have been sent to your extension officer.",
    ny: "Zikomo. Mayankho anu atumizidwa kwa mlangizi wanu wa zaulimi.",
  },
  yes: { en: "Yes", ny: "Inde" },
  no: { en: "No", ny: "Ayi" },
  of: { en: "of", ny: "mwa" },
} satisfies Record<string, Text | string>;

const YES = new Set(["1", "yes", "y", "inde", "eya", "ee"]);
const NO = new Set(["2", "no", "n", "ayi", "iyayi"]);
const ENGLISH = new Set(["1", "english", "en", "eng"]);
const CHICHEWA = new Set(["2", "chichewa", "chewa", "ny", "nyanja"]);

/** A new session. Pass the farmer's language if it is already known. */
export function start(disease: DiseaseId, lang: Lang | null = null): Turn {
  const session: Session = { disease, lang, step: 0, answers: [] };
  return { session, prompt: render(session), done: false, retry: false };
}

/** Apply one reply from the farmer and return the next screen. */
export function reply(current: Session, input: string): Turn {
  const session: Session = structuredClone(current);
  const word = normalize(input);

  if (session.lang === null) {
    const lang = ENGLISH.has(word) ? "en" : CHICHEWA.has(word) ? "ny" : null;
    if (!lang) return { session, prompt: render(session, true), done: false, retry: true };
    session.lang = lang;
    return { session, prompt: render(session), done: false, retry: false };
  }

  if (session.step >= STEPS) return { session, prompt: render(session), done: true, retry: false };

  const answer = YES.has(word) ? true : NO.has(word) ? false : null;
  if (answer === null) return { session, prompt: render(session, true), done: false, retry: true };

  const index = Math.floor(session.step / 2);
  if (session.step % 2 === 0) session.answers[index] = { main: answer };
  else session.answers[index] = { ...session.answers[index]!, follow: answer };
  session.step++;

  return { session, prompt: render(session), done: session.step >= STEPS, retry: false };
}

/** The screen for the session's current step. */
export function render(session: Session, retry = false): Prompt {
  if (session.lang === null) {
    const body = retry ? `${MESSAGES.retry.en}\n${MESSAGES.chooseLanguage}` : MESSAGES.chooseLanguage;
    return { body, options: [{ reply: "1", label: "English" }, { reply: "2", label: "Chichewa" }] };
  }
  const lang = session.lang;
  if (session.step >= STEPS) return { body: MESSAGES.thanks[lang], options: [] };

  const questionnaire = QUESTIONNAIRES[session.disease];
  const index = Math.floor(session.step / 2);
  const question = questionnaire.questions[index];
  let text: string;
  if (session.step % 2 === 0) text = question.ask[lang];
  else text = (session.answers[index]!.main ? question.yes : question.no).ask[lang];

  return {
    header: `${CROP_LABEL[questionnaire.crop][lang]} · ${session.step + 1} ${MESSAGES.of[lang]} ${STEPS}`,
    body: retry ? `${MESSAGES.retry[lang]}\n${text}` : text,
    options: [
      { reply: "1", label: MESSAGES.yes[lang] },
      { reply: "2", label: MESSAGES.no[lang] },
    ],
  };
}

/** Plain-text form of a prompt, for SMS-style channels and the simulator. */
export function toText(prompt: Prompt): string {
  const lines = [prompt.header, prompt.body, ...prompt.options.map((o) => `${o.reply} ${o.label}`)];
  return lines.filter(Boolean).join("\n");
}

function normalize(input: string): string {
  return input.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}
