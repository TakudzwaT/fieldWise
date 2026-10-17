// The farmer's side of a flag. A farm's new flags go out together as one
// alert, which opens a round: the farmer picks a language and their ward (the
// first time only), then which at-risk plant to report on, answers its questionnaire (every flagged one for that plant, one after
// another), and is then asked whether to report on another plant. "No", or no
// plants left, closes the round; plants not picked are marked skipped and left
// off Felix's list. Black rot's re-check skips the pick and goes straight to
// the cabbage questions.
//
// A farmer on USSD can also report a problem themselves (report): that opens a
// round straight on the plant's questions, with no alert, because they are
// already looking at the screen.
//
// Housekeeping (sweep) runs on the cron: one reminder after a day of silence
// (sooner on WhatsApp, see reminderDueAt), "no response" 24 h after that, and
// black rot's re-ask a week after a clear.
//
// Replies can arrive at the same moment (two quick taps on WhatsApp are two
// webhook calls). Every reply saves its round first, and only if nobody saved
// it since it was read; otherwise the reply is handled again on the fresh round.

import { languagePrompt, normalize, parseLanguage, parseYesNo, render, reply, start, toText, type Prompt } from "./engine";
import {
  allDoneText,
  alertText,
  cropDoneText,
  morePrompt,
  noQuestionsText,
  NOT_REGISTERED,
  parseWard,
  wardPrompt,
  nudgeText,
  parsePick,
  pickPrompt,
  reminderText,
  sameCropNextText,
  staleText,
} from "./messages";
import type { Outbox, Outgoing } from "./outbox";
import { CROPS, DISEASES, QUESTIONNAIRES, type Crop, type DiseaseId, type Lang } from "./questionnaires";
import { score } from "./scoring";
import type { Channel, Farmer, Flag, FlagDetails, FlagReason, FlagSource, Round, Store, StoredSession } from "./store";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
export const NO_RESPONSE_AFTER_MS = DAY_MS;
// How many times a reply is retried when another reply saves first.
const SAVE_ATTEMPTS = 3;

/**
 * When a silent session's reminder is due (ms). The simulator waits a day.
 * WhatsApp only delivers free-form messages for 24 hours after the farmer's
 * own last message, and a reminder at a day would always miss it, so on
 * WhatsApp it goes out 20 hours after the last activity, or 3 hours before
 * the window closes if that is sooner, but never within 4 hours of the last
 * activity.
 */
export function reminderDueAt(channel: Channel, lastActivity: string, lastInbound: string | null): number {
  const activity = Date.parse(lastActivity);
  if (channel !== "whatsapp") return activity + DAY_MS;
  const preferred = activity + 20 * HOUR_MS;
  if (!lastInbound) return preferred;
  const beforeWindowCloses = Date.parse(lastInbound) + DAY_MS - 3 * HOUR_MS;
  return Math.max(activity + 4 * HOUR_MS, Math.min(preferred, beforeWindowCloses));
}
// The empty string is a message with no text (a voice note, photo or sticker).
const RESUME = new Set(["", "start", "hi", "hello", "hey", "menu", "resume", "continue", "yambani", "moni", "moniwa"]);

/** One flag to raise. */
export interface Raise {
  disease: DiseaseId;
  reason: FlagReason;
  source: FlagSource;
  details: FlagDetails;
}

const cropOf = (s: StoredSession) => QUESTIONNAIRES[s.state.disease].crop;

/** The plants waiting to be picked, in the order they were first offered, so the list's numbers don't move. */
export function offeredCrops(sessions: StoredSession[]): Crop[] {
  const first = new Map<Crop, string>();
  for (const s of sessions) {
    if (s.status !== "offered") continue;
    const crop = cropOf(s);
    if (!first.has(crop) || s.created_at < first.get(crop)!) first.set(crop, s.created_at);
  }
  return [...first].sort((a, b) => a[1].localeCompare(b[1]) || CROPS.indexOf(a[0]) - CROPS.indexOf(b[0])).map(([crop]) => crop);
}

/** The screen the farmer is on, and what it looks like. */
export function currentPrompt(round: Round, sessions: StoredSession[], lang: Lang | null): Prompt {
  if (!lang || round.screen === "lang") return languagePrompt();
  if (round.screen === "ward") return wardPrompt(lang);
  if (round.screen === "questions") {
    const active = sessions.find((s) => s.status === "active");
    if (active) return render({ ...active.state, lang });
  }
  if (round.screen === "more") return morePrompt(lang);
  return pickPrompt(offeredCrops(sessions), lang);
}

/** Options for an incoming reply. */
export interface InboundOptions {
  /** For a WhatsApp button tap: the screen the button belonged to. */
  screen?: string;
  /**
   * The farmer is in a live USSD session: the replies are shown on their
   * screen by the caller, not sent, and their keypress is logged as USSD.
   */
  live?: boolean;
}

export class Conversations {
  constructor(
    private store: Store,
    private outbox: Outbox,
    private now: () => Date,
  ) {}

  /**
   * Raise a farm's new flags. They join the farmer's open round, or open a
   * new one with an alert and the "which plant?" list.
   */
  async raise(farmer: Farmer, raises: Raise[], { silent = false }: { silent?: boolean } = {}): Promise<Flag[]> {
    const at = this.now().toISOString();
    const flags: Flag[] = [];
    const sessions: StoredSession[] = [];
    const nudges: Outgoing[] = [];

    // Within a plant, ask the questionnaires in the document's order.
    const ordered = [...raises].sort((a, b) => DISEASES.indexOf(a.disease) - DISEASES.indexOf(b.disease));
    for (const r of ordered) {
      const flag: Flag = { id: newId("flag"), farmer_id: farmer.id, disease: r.disease, reason: r.reason, source: r.source, raised_at: at, details: r.details, status: "awaiting" };
      flags.push(flag);
      // A spell that got worse while its questionnaire is still open: nudge the
      // farmer to finish it rather than asking the same questions again.
      if (r.reason === "worse") {
        const open = await this.store.openSessionFor(farmer.id, r.disease);
        if (open) {
          flag.status = "merged";
          flag.details = { ...r.details, merged_into: open.flag_id };
          if (open.status === "active") nudges.push(nudgeText(QUESTIONNAIRES[r.disease].crop, farmer.lang), render(open.state));
          continue;
        }
      }
      sessions.push(newSession(flag, farmer, at));
    }

    const round = sessions.length ? await this.store.openRound(farmer.id) : null;
    if (!sessions.length || round) {
      if (round) {
        // Joins the open round. A plant the farmer is answering right now gets
        // its new questions next; any other plant goes on the list.
        const answering = (await this.store.roundSessions(round.id)).find((s) => s.status === "active");
        for (const s of sessions) {
          s.round_id = round.id;
          s.status = answering && cropOf(answering) === cropOf(s) ? "queued" : "offered";
        }
      }
      await this.store.addFlagsWithSessions(flags, sessions);
      if (nudges.length && !silent) await this.outbox.send(farmer, nudges);
      return flags;
    }

    // A re-check, or the farmer's own report, goes straight to its plant's
    // questions; anything else starts with the list of plants at risk.
    const reasons = new Set(sessions.map((s) => flags.find((f) => f.id === s.flag_id)!.reason));
    const direct = [...reasons].every((r) => r === "recheck" || r === "report");
    const reason: FlagReason = reasons.has("report")
      ? "report"
      : direct
        ? "recheck"
        : reasons.has("new")
          ? "new"
          : reasons.has("worse")
            ? "worse"
            : "manual";
    const opened: Round = {
      id: newId("rnd"),
      farmer_id: farmer.id,
      status: "open",
      screen: !farmer.lang ? "lang" : !farmer.ward ? "ward" : direct ? "questions" : "pick",
      reason,
      created_at: at,
      last_activity_at: at,
      reminded_at: null,
      closed_at: null,
      version: 0,
    };
    for (const s of sessions) {
      s.round_id = opened.id;
      s.status = direct ? "queued" : "offered";
    }
    if (direct) activate(sessions[0], farmer.lang, at);
    await this.store.addFlagsWithSessions(flags, sessions, opened);
    if (!silent) {
      await this.outbox.send(farmer, [...nudges, alertText(reason, cropOf(sessions[0]), farmer.lang), currentPrompt(opened, sessions, farmer.lang)]);
    }
    return flags;
  }

  /**
   * The farmer reports a problem with a plant (from the USSD menu). Opens a
   * round on that plant's first questionnaire, which asks about the other
   * likely problems too, and returns its first screen. Null if a round is
   * already open: the farmer answers that first.
   */
  async report(farmer: Farmer, crop: Crop): Promise<Prompt | null> {
    if (await this.store.openRound(farmer.id)) return null;
    const disease = DISEASES.find((d) => QUESTIONNAIRES[d].crop === crop)!;
    await this.raise(farmer, [{ disease, reason: "report", source: "farmer", details: {} }], { silent: true });
    const round = await this.store.openRound(farmer.id);
    return round ? currentPrompt(round, await this.store.roundSessions(round.id), farmer.lang) : null;
  }

  /** The screen in front of the farmer, or null when no round is open. */
  async current(farmer: Farmer): Promise<Prompt | null> {
    const round = await this.store.openRound(farmer.id);
    return round ? currentPrompt(round, await this.store.roundSessions(round.id), farmer.lang) : null;
  }

  /** A message from a farmer. Returns what was sent back, as text. */
  async inbound(phone: string, text: string, options: InboundOptions = {}): Promise<string[]> {
    const farmer = await this.store.getFarmerByPhone(phone);
    if (!farmer) return [NOT_REGISTERED];
    return (await this.respond(farmer, text, options)).map((m) => (typeof m === "string" ? m : toText(m)));
  }

  /**
   * A message from a known farmer. Returns the replies; they have been sent
   * unless the farmer is in a live USSD session (options.live).
   */
  async respond(farmer: Farmer, text: string, { screen, live = false }: InboundOptions = {}): Promise<Outgoing[]> {
    const at = this.now().toISOString();
    await this.store.logMessage({ farmer_id: farmer.id, direction: "in", channel: farmer.channel, body: text, at, kind: live ? "ussd" : null });

    for (let attempt = 0; attempt < SAVE_ATTEMPTS; attempt++) {
      const replies = await this.handle(farmer, text, screen, at);
      if (replies) {
        if (!live) await this.outbox.send(farmer, replies);
        return replies;
      }
    }
    console.error(`Reply from ${farmer.id} kept conflicting with other replies; dropped`);
    return [];
  }

  /** One attempt at a reply. Null when another reply saved the round first. */
  private async handle(farmer: Farmer, text: string, screen: string | undefined, at: string): Promise<Outgoing[] | null> {
    const round = await this.store.openRound(farmer.id);
    if (!round) return [noQuestionsText(farmer.lang)];
    // Within a plant, ask the questionnaires in the document's order.
    const sessions = (await this.store.roundSessions(round.id)).sort(
      (a, b) => a.created_at.localeCompare(b.created_at) || DISEASES.indexOf(a.state.disease) - DISEASES.indexOf(b.state.disease),
    );
    const lang = farmer.lang;
    // A farmer with no language (after a demo reset, say) picks one first.
    if (!lang && round.screen !== "lang") round.screen = "lang";
    round.last_activity_at = at;
    const replies: Outgoing[] = [];
    const saves: StoredSession[] = [];
    let answered: StoredSession | null = null;
    let skip = false;

    // A greeting, a template's Start button, or a voice note or photo shows the
    // current screen again rather than counting as a wrong answer. So does a
    // tap on an earlier screen's button, which would otherwise be taken as the
    // answer to the current one.
    const resume = RESUME.has(normalize(text));
    const stale = screen !== undefined && screen !== currentPrompt(round, sessions, lang).key;
    if (resume || stale) {
      if (stale) replies.push(staleText(lang));
      replies.push(currentPrompt(round, sessions, lang));
    } else if (round.screen === "lang") {
      const picked = parseLanguage(text);
      if (!picked) return (await this.save(round, [])) ? [languagePrompt(true)] : null;
      const active = sessions.find((s) => s.status === "active");
      round.screen = !farmer.ward ? "ward" : nextScreen(sessions);
      if (active) {
        active.state.lang = picked;
        saves.push(active);
      }
      if (!(await this.save(round, saves))) return null;
      await this.store.setLang(farmer.id, picked);
      farmer.lang = picked;
      return [currentPrompt(round, sessions, picked)];
    } else if (round.screen === "ward") {
      const ward = parseWard(text);
      if (!ward) return (await this.save(round, [])) ? [wardPrompt(lang!, true)] : null;
      round.screen = nextScreen(sessions);
      if (!(await this.save(round, []))) return null;
      await this.store.setWard(farmer.id, ward);
      farmer.ward = ward;
      return [currentPrompt(round, sessions, lang)];
    } else if (round.screen === "pick") {
      const crops = offeredCrops(sessions);
      const crop = parsePick(text, crops);
      if (!crop) replies.push(pickPrompt(crops, lang!, true));
      else {
        const chosen = sessions.filter((s) => s.status === "offered" && cropOf(s) === crop);
        for (const s of chosen) s.status = "queued";
        activate(chosen[0], lang, at);
        saves.push(...chosen);
        round.screen = "questions";
        replies.push(render(chosen[0].state));
      }
    } else if (round.screen === "more") {
      const yes = parseYesNo(text);
      if (yes === null) replies.push(morePrompt(lang!, true));
      else if (yes && offeredCrops(sessions).length) {
        round.screen = "pick";
        replies.push(pickPrompt(offeredCrops(sessions), lang!));
      } else {
        close(round, at);
        skip = true;
        replies.push(allDoneText(lang!));
      }
    } else {
      const active = sessions.find((s) => s.status === "active");
      if (!active) {
        // Nothing left to answer for this plant; move on.
        if (offeredCrops(sessions).length) {
          round.screen = "more";
          replies.push(morePrompt(lang!));
        } else {
          close(round, at);
          replies.push(allDoneText(lang!));
        }
      } else {
        const turn = reply(active.state, text);
        active.state = turn.session;
        active.last_activity_at = at;
        saves.push(active);
        if (!turn.done) replies.push(turn.prompt);
        else {
          const flag = await this.store.getFlag(active.flag_id);
          active.report = score(active.state.disease, active.state.answers, { leafWetHours: flag?.details.leaf_wet_hours ?? undefined });
          active.status = "done";
          active.completed_at = at;
          active.recheck_due_at = active.report.recheckInDays
            ? new Date(this.now().getTime() + active.report.recheckInDays * DAY_MS).toISOString()
            : null;
          answered = active;
          const crop = cropOf(active);
          const next = sessions.find((s) => s.status === "queued");
          if (next) {
            activate(next, lang, at);
            saves.push(next);
            replies.push(sameCropNextText(crop, lang!), render(next.state));
          } else if (offeredCrops(sessions).length) {
            round.screen = "more";
            replies.push(cropDoneText(crop, lang!), morePrompt(lang!));
          } else {
            close(round, at);
            replies.push(allDoneText(lang!));
          }
        }
      }
    }

    if (!(await this.save(round, saves))) return null;
    if (answered) await this.store.setFlagStatus(answered.flag_id, "answered");
    if (skip) await this.store.skipOffered(round.id);
    return replies;
  }

  /**
   * Save the round, then the sessions a reply changed. Only the round is
   * checked for a conflicting save: every reply saves it first.
   */
  private async save(round: Round, sessions: StoredSession[]): Promise<boolean> {
    if (!(await this.store.saveRound(round))) return false;
    for (const s of sessions) await this.store.saveSession(s);
    // A farmer who answers after being marked "no response" is back in.
    if (round.reminded_at) await this.store.setRoundResponse(round.id, "no_response", "awaiting");
    return true;
  }

  /** Reminders, no-response marks and re-asks that have come due. */
  async sweep(): Promise<{ reminded: number; noResponse: number; rechecks: number }> {
    const now = this.now();
    let reminded = 0;
    let noResponse = 0;
    let rechecks = 0;

    // Four hours is the soonest any reminder can be due; reminderDueAt decides.
    for (const round of await this.store.roundsNeedingReminder(new Date(now.getTime() - 4 * HOUR_MS).toISOString())) {
      const farmer = await this.store.getFarmer(round.farmer_id);
      if (!farmer) continue;
      const lastInbound = farmer.channel === "whatsapp" ? await this.store.lastInboundAt(farmer.id) : null;
      if (now.getTime() < reminderDueAt(farmer.channel, round.last_activity_at, lastInbound)) continue;
      round.reminded_at = now.toISOString();
      // A farmer who replied a moment ago doesn't need the reminder.
      if (!(await this.store.saveRound(round))) continue;
      const sessions = await this.store.roundSessions(round.id);
      await this.outbox.send(farmer, [reminderText(farmer.lang), currentPrompt(round, sessions, farmer.lang)]);
      reminded++;
    }

    for (const round of await this.store.roundsSilentAfterReminder(new Date(now.getTime() - NO_RESPONSE_AFTER_MS).toISOString())) {
      // The round stays open: a late reply still counts.
      noResponse += await this.store.setRoundResponse(round.id, "awaiting", "no_response");
    }

    for (const session of await this.store.rechecksDue(now.toISOString())) {
      session.recheck_due_at = null;
      if (!(await this.store.saveSession(session))) continue;
      const farmer = await this.store.getFarmer(session.farmer_id);
      const flag = await this.store.getFlag(session.flag_id);
      if (!farmer || !flag) continue;
      await this.raise(farmer, [{ disease: flag.disease, reason: "recheck", source: flag.source, details: flag.details }]);
      rechecks++;
    }

    return { reminded, noResponse, rechecks };
  }

}

/** Where a round goes once the language and ward are known. */
function nextScreen(sessions: StoredSession[]): Round["screen"] {
  if (sessions.some((s) => s.status === "active")) return "questions";
  return offeredCrops(sessions).length ? "pick" : "more";
}

function newSession(flag: Flag, farmer: Farmer, at: string): StoredSession {
  return {
    id: newId("ses"),
    flag_id: flag.id,
    farmer_id: farmer.id,
    round_id: null,
    status: "offered",
    state: start(flag.disease, farmer.lang).session,
    created_at: at,
    started_at: null,
    last_activity_at: null,
    reminded_at: null,
    completed_at: null,
    report: null,
    recheck_due_at: null,
    version: 0,
  };
}

/** Put a picked session in front of the farmer. */
function activate(session: StoredSession, lang: Lang | null, at: string): void {
  // The farmer may have picked a language since this session was made.
  if (lang) session.state.lang = lang;
  session.status = "active";
  session.started_at = at;
  session.last_activity_at = at;
}

function close(round: Round, at: string): void {
  round.status = "closed";
  round.closed_at = at;
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
}
