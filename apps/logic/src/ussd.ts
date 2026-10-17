// USSD, for the farmers without a smartphone (about 9 in 10). Built to
// Africa's Talking's USSD callback: each request has sessionId, serviceCode,
// phoneNumber and text, where text is every input of the session so far
// joined by "*" ("" on the first request, then "1", "1*2", ...). The reply is
// plain text starting "CON " (show this and wait for input) or "END " (show
// this and hang up).
//
// FieldWise can't start a USSD session; the farmer dials. Alerts, reminders
// and Felix's messages reach them by SMS (see outbox.ts), which says what to
// dial. A dial then shows:
// - the questions waiting for them, where they left off, if they were alerted;
// - otherwise a menu: report a crop problem, read Felix's messages, ask Felix
//   to call, or change language.
// Every answer is saved as it comes, so a session that times out or is cut
// off resumes at the same question on the next dial. "0" on a question goes
// to the menu.
//
// A USSD screen holds about 182 characters. Questions fit (148 at most); a
// "thank you" before the next question, or a retry hint, is dropped first
// when a screen would be too long.

import { languagePrompt, parseLanguage, toText, type Prompt } from "./engine";
import type { Conversations } from "./conversation";
import {
  callbackText,
  homePrompt,
  inboxPrompt,
  menuOption,
  noOfficerMessagesText,
  parsePick,
  reportPrompt,
  USSD_NOT_REGISTERED,
} from "./messages";
import type { Outgoing } from "./outbox";
import { newId } from "./conversation";
import { normalizePhone } from "./phone";
import { CROPS, type Lang } from "./questionnaires";
import type { Farmer, Store, UssdSession } from "./store";

/** The most a USSD screen holds, "CON " or "END " included. */
export const MAX_SCREEN = 182;
/** Networks end an idle USSD session after a few minutes; rows older than this are pruned. */
export const SESSION_KEEP_MS = 24 * 60 * 60 * 1000;
/** How many of the officer's messages the inbox goes back. */
const INBOX = 5;

export interface UssdRequest {
  sessionId: string;
  serviceCode: string;
  phoneNumber: string;
  text: string;
}

export interface UssdDeps {
  store: Store;
  conversations: Conversations;
  now: () => Date;
}

/** What to show next, and the mode the session is then in. */
interface Step {
  mode: UssdSession["mode"];
  page?: number;
  /** Text shown above the prompt, or the whole screen when there is no prompt. */
  notes: string[];
  /** The question or menu waiting for an answer; null (or no options) ends the session. */
  prompt: Prompt | null;
}

/** Reads Africa's Talking's form body (or the simulator's JSON) into a request. */
export function parseUssd(fields: Record<string, unknown>): UssdRequest | null {
  const get = (k: string) => (typeof fields[k] === "string" ? (fields[k] as string) : null);
  const sessionId = get("sessionId");
  const phoneNumber = get("phoneNumber");
  if (!sessionId || !phoneNumber || sessionId.length > 100) return null;
  return { sessionId, serviceCode: get("serviceCode") ?? "", phoneNumber, text: get("text") ?? "" };
}

/** Handle one USSD request; returns the "CON ..." or "END ..." reply. */
export async function handleUssd(request: UssdRequest, deps: UssdDeps): Promise<string> {
  const { store, now } = deps;
  const phone = normalizePhone(request.phoneNumber);
  const farmer = phone ? await store.getFarmerByPhone(phone) : null;
  if (!farmer) return `END ${USSD_NOT_REGISTERED}`;

  const inputs = request.text === "" ? [] : request.text.split("*");
  const existing = await store.getUssdSession(request.sessionId);
  if (existing && existing.farmer_id !== farmer.id) return "END FieldWise: please dial again.";
  // The gateway can repeat a request; the same inputs get the same screen.
  if (existing && inputs.length <= existing.inputs) return existing.response;

  const step = existing ? await next(existing, farmer, inputs[inputs.length - 1].trim(), deps) : await open(farmer, deps);
  const response = format(step);
  const at = now().toISOString();
  await store.logMessage({
    farmer_id: farmer.id,
    direction: "out",
    channel: farmer.channel,
    body: response.slice(4),
    at,
    kind: "ussd",
    screen: step.prompt?.options.length ? step.prompt.key : null,
  });
  await store.saveUssdSession({
    id: request.sessionId,
    farmer_id: farmer.id,
    mode: step.mode,
    page: step.page ?? 0,
    inputs: inputs.length,
    response,
    started_at: existing?.started_at ?? at,
    updated_at: at,
  });
  return response;
}

/** The first screen of a dial. */
async function open(farmer: Farmer, { conversations, store }: UssdDeps): Promise<Step> {
  const waiting = await conversations.current(farmer);
  if (waiting) return round([], waiting, farmer.lang);
  if (!farmer.lang) return { mode: "lang", notes: [], prompt: languagePrompt() };
  return home(farmer, store);
}

/** The screen after one input. */
async function next(session: UssdSession, farmer: Farmer, input: string, deps: UssdDeps): Promise<Step> {
  const { store, conversations, now } = deps;
  const lang = farmer.lang;

  switch (session.mode) {
    case "lang":
    case "menu_lang": {
      const picked = parseLanguage(input);
      if (!picked) return { mode: session.mode, notes: [], prompt: languagePrompt(true) };
      await store.setLang(farmer.id, picked);
      farmer.lang = picked;
      return home(farmer, store);
    }

    case "home": {
      if (!lang) return { mode: "lang", notes: [], prompt: languagePrompt() };
      if (input === "1") {
        const waiting = await conversations.current(farmer);
        if (waiting) return round([], waiting, lang);
        return { mode: "report", notes: [], prompt: reportPrompt(CROPS, lang) };
      }
      if (input === "2") return inbox(farmer, 0, store);
      if (input === "3") {
        const officer = await officerName(farmer, store);
        const already = !!(await store.openCallback(farmer.id));
        if (!already) {
          await store.addCallback({ id: newId("cb"), farmer_id: farmer.id, requested_at: now().toISOString(), done_at: null, done_by: null });
        }
        return { mode: "home", notes: [callbackText(officer, lang, already)], prompt: null };
      }
      if (input === "4") return { mode: "menu_lang", notes: [], prompt: languagePrompt() };
      return home(farmer, store, true);
    }

    case "report": {
      if (!lang) return { mode: "lang", notes: [], prompt: languagePrompt() };
      if (input === "0") return home(farmer, store);
      const crop = parsePick(input, [...CROPS]);
      if (!crop) return { mode: "report", notes: [], prompt: reportPrompt(CROPS, lang, true) };
      const first = (await conversations.report(farmer, crop)) ?? (await conversations.current(farmer));
      return first ? round([], first, lang) : home(farmer, store);
    }

    case "inbox": {
      if (input === "1") return inbox(farmer, session.page + 1, store);
      if (input === "0") return home(farmer, store);
      return inbox(farmer, session.page, store);
    }

    case "round": {
      if (input === "0" && lang) return home(farmer, store);
      const replies = await conversations.respond(farmer, input, { live: true });
      return fromReplies(replies, farmer.lang);
    }
  }
}

/** A question from the round, with "0 Menu" under it. */
function round(notes: string[], prompt: Prompt, lang: Lang | null): Step {
  const withMenu = lang && prompt.options.length ? { ...prompt, options: [...prompt.options, menuOption(lang)] } : prompt;
  return { mode: "round", notes, prompt: withMenu };
}

/** The conversation's replies as one screen: the last question, with what came before it as notes. */
function fromReplies(replies: Outgoing[], lang: Lang | null): Step {
  const last = replies[replies.length - 1];
  if (last && typeof last !== "string" && last.options.length) {
    const notes = replies.slice(0, -1).map((m) => (typeof m === "string" ? m : toText(m)));
    return round(notes, last, lang);
  }
  return { mode: "round", notes: replies.map((m) => (typeof m === "string" ? m : toText(m))), prompt: null };
}

async function home(farmer: Farmer, store: Store, retry = false): Promise<Step> {
  if (!farmer.lang) return { mode: "lang", notes: [], prompt: languagePrompt() };
  const roundOpen = !!(await store.openRound(farmer.id));
  return { mode: "home", notes: [], prompt: homePrompt(farmer.lang, await officerName(farmer, store), roundOpen, retry) };
}

async function inbox(farmer: Farmer, page: number, store: Store): Promise<Step> {
  const lang = farmer.lang ?? "en";
  const messages = await store.officerMessages(farmer.id, INBOX);
  if (!messages.length) return { mode: "home", notes: [noOfficerMessagesText(await officerName(farmer, store), lang)], prompt: null };
  const shown = Math.min(page, messages.length - 1);
  const message = messages[shown];
  const date = new Date(Date.parse(message.at) + 2 * 60 * 60 * 1000).toISOString().slice(5, 10).split("-").reverse().join("/");
  return { mode: "inbox", page: shown, notes: [], prompt: inboxPrompt(`${date} ${message.body}`, shown < messages.length - 1, lang) };
}

async function officerName(farmer: Farmer, store: Store): Promise<string | null> {
  return farmer.officer_id ? ((await store.getOfficer(farmer.officer_id))?.name ?? null) : null;
}

/** The step as "CON ..." or "END ...", cut to fit one screen. */
export function format(step: Step): string {
  const notes = step.notes.map(gsm);
  const prompt = step.prompt && {
    ...step.prompt,
    header: step.prompt.header && gsm(step.prompt.header),
    body: gsm(step.prompt.body),
    options: step.prompt.options.map((o) => ({ ...o, label: gsm(o.label) })),
  };
  const ask = !!prompt?.options.length;
  const lead = ask ? "CON " : "END ";
  const room = MAX_SCREEN - lead.length;
  if (!prompt) return lead + clip(notes.join("\n"), room);
  const lines = (p: Prompt, withNotes: boolean) => [...(withNotes ? notes : []), toText(p)].join("\n");
  // Drop the notes first, then a retry hint (the first line of a two-line body).
  let text = lines(prompt, true);
  if (text.length > room) text = lines(prompt, false);
  if (text.length > room && prompt.body.includes("\n")) text = lines({ ...prompt, body: prompt.body.slice(prompt.body.indexOf("\n") + 1) }, false);
  if (text.length > room) {
    // Last resort (a long message from Felix): shorten the body, keep the options.
    const options = prompt.options.map((o) => `${o.reply} ${o.label}`).join("\n");
    const header = prompt.header ? `${prompt.header}\n` : "";
    text = `${header}${clip(prompt.body, room - header.length - options.length - 1)}\n${options}`;
  }
  return lead + text;
}

function clip(text: string, room: number): string {
  return text.length <= room ? text : `${text.slice(0, Math.max(0, room - 3)).trimEnd()}...`;
}

/**
 * Plain GSM characters only: many phones show anything else as "?", and some
 * networks switch the whole screen to a smaller character set.
 */
export function gsm(text: string): string {
  return text
    .replace(/·/g, "-")
    .replace(/…/g, "...")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-");
}
