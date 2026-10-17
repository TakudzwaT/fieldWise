// The farmer's side of a flag: raising it sends an alert and the first
// question, each reply moves the questionnaire on, and the last answer is
// scored for Felix. A farmer answers one questionnaire at a time; any others
// wait in a queue and start when the current one is done.
//
// Housekeeping (sweep) runs on the cron: one reminder after a day of silence
// (sooner on WhatsApp, see reminderDueAt), "no response" 24 h after that, and
// black rot's re-ask a week after a clear.
//
// Replies can arrive at the same moment (two quick taps on WhatsApp are two
// webhook calls). A session is only saved if nobody saved it since it was
// read; otherwise the reply is handled again on the fresh session.

import { render, reply, screenKey, start, toText } from "./engine";
import { alertText, noQuestionsText, nudgeText, NOT_REGISTERED, reminderText, staleText } from "./messages";
import type { Outbox, Outgoing } from "./outbox";
import type { DiseaseId } from "./questionnaires";
import { score } from "./scoring";
import type { Channel, Farmer, Flag, FlagDetails, FlagReason, FlagSource, Store, StoredSession } from "./store";

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

export class Conversations {
  constructor(
    private store: Store,
    private outbox: Outbox,
    private now: () => Date,
  ) {}

  /** Raise a flag for a farmer: queue its questionnaire and alert if it is their turn. */
  async raise(farmer: Farmer, disease: DiseaseId, reason: FlagReason, source: FlagSource, details: FlagDetails): Promise<Flag> {
    const at = this.now().toISOString();
    const flag: Flag = { id: newId("flag"), farmer_id: farmer.id, disease, reason, source, raised_at: at, details, status: "awaiting" };

    // A spell that got worse while its questionnaire is still open: nudge the
    // farmer to finish it rather than starting the same questions again.
    if (reason === "worse") {
      const open = await this.store.openSessionFor(farmer.id, disease);
      if (open) {
        flag.status = "merged";
        flag.details = { ...details, merged_into: open.flag_id };
        await this.store.addFlag(flag);
        if (open.status === "active") await this.outbox.send(farmer, [nudgeText(farmer.crop, farmer.lang), render(open.state)]);
        return flag;
      }
    }

    // Starts now if the farmer has nothing else open; otherwise it waits.
    const startsNow = !(await this.store.activeSession(farmer.id));
    const session: StoredSession = {
      id: newId("ses"),
      flag_id: flag.id,
      farmer_id: farmer.id,
      status: startsNow ? "active" : "queued",
      state: start(disease, farmer.lang).session,
      created_at: at,
      started_at: startsNow ? at : null,
      last_activity_at: startsNow ? at : null,
      reminded_at: null,
      completed_at: null,
      report: null,
      recheck_due_at: null,
      version: 0,
    };
    await this.store.addFlagWithSession(flag, session);
    if (startsNow) await this.outbox.send(farmer, [alertText(reason, farmer.crop, farmer.lang), render(session.state)]);
    return flag;
  }

  /**
   * A message from a farmer. Returns what was sent back. `screen` is set for a
   * WhatsApp button tap: the screen the button belonged to.
   */
  async inbound(phone: string, text: string, { screen }: { screen?: string } = {}): Promise<string[]> {
    const farmer = await this.store.getFarmerByPhone(phone);
    if (!farmer) return [NOT_REGISTERED];
    const at = this.now().toISOString();
    await this.store.logMessage({ farmer_id: farmer.id, direction: "in", channel: farmer.channel, body: text, at });

    for (let attempt = 0; attempt < SAVE_ATTEMPTS; attempt++) {
      const replies = await this.handle(farmer, text, screen, at);
      if (replies) return this.send(farmer, replies);
    }
    console.error(`Reply from ${farmer.id} kept conflicting with other replies; dropped`);
    return [];
  }

  /** One attempt at a reply. Null when another reply saved the session first. */
  private async handle(farmer: Farmer, text: string, screen: string | undefined, at: string): Promise<Outgoing[] | null> {
    const session = await this.store.activeSession(farmer.id);
    if (!session) return [noQuestionsText(farmer.lang)];

    // A greeting, a template's Start button, or a voice note or photo shows the
    // current screen again rather than counting as a wrong answer. So does a
    // tap on an earlier question's button, which would otherwise be taken as
    // the answer to the current one.
    const resume = RESUME.has(text.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ""));
    const stale = screen !== undefined && screen !== screenKey(session.state);
    if (resume || stale) {
      session.last_activity_at = at;
      if (!(await this.store.saveSession(session))) return null;
      return stale ? [staleText(farmer.lang), render(session.state)] : [render(session.state)];
    }

    const turn = reply(session.state, text);
    session.state = turn.session;
    session.last_activity_at = at;
    const flag = await this.store.getFlag(session.flag_id);

    if (!turn.done) {
      if (!(await this.store.saveSession(session))) return null;
      await this.afterSave(farmer, turn.session.lang, flag);
      return [turn.prompt];
    }

    const report = score(session.state.disease, session.state.answers, { leafWetHours: flag?.details.leaf_wet_hours ?? undefined });
    session.status = "done";
    session.completed_at = at;
    session.report = report;
    session.recheck_due_at = report.recheckInDays ? new Date(this.now().getTime() + report.recheckInDays * DAY_MS).toISOString() : null;
    if (!(await this.store.saveSession(session))) return null;
    await this.afterSave(farmer, turn.session.lang, flag);
    if (flag) await this.store.setFlagStatus(flag.id, "answered");

    const replies: Outgoing[] = [turn.prompt];
    const next = await this.store.nextQueued(farmer.id);
    if (next) replies.push(...(await this.begin(farmer, next)));
    return replies;
  }

  /** Remember a newly picked language, and lift "no response" once the farmer answers. */
  private async afterSave(farmer: Farmer, lang: Farmer["lang"], flag: Flag | null): Promise<void> {
    if (lang && !farmer.lang) {
      await this.store.setLang(farmer.id, lang);
      farmer.lang = lang;
    }
    if (flag?.status === "no_response") await this.store.setFlagStatus(flag.id, "awaiting");
  }

  /** Reminders, no-response marks and re-asks that have come due. */
  async sweep(): Promise<{ reminded: number; noResponse: number; rechecks: number }> {
    const now = this.now();
    let reminded = 0;
    let noResponse = 0;
    let rechecks = 0;

    // Four hours is the soonest any reminder can be due; reminderDueAt decides.
    for (const session of await this.store.needingReminder(new Date(now.getTime() - 4 * HOUR_MS).toISOString())) {
      const farmer = await this.store.getFarmer(session.farmer_id);
      if (!farmer || !session.last_activity_at) continue;
      const lastInbound = farmer.channel === "whatsapp" ? await this.store.lastInboundAt(farmer.id) : null;
      if (now.getTime() < reminderDueAt(farmer.channel, session.last_activity_at, lastInbound)) continue;
      session.reminded_at = now.toISOString();
      // A farmer who replied a moment ago doesn't need the reminder.
      if (!(await this.store.saveSession(session))) continue;
      await this.outbox.send(farmer, [reminderText(farmer.crop, farmer.lang), render(session.state)]);
      reminded++;
    }

    for (const session of await this.store.silentAfterReminder(new Date(now.getTime() - NO_RESPONSE_AFTER_MS).toISOString())) {
      // The session stays open: a late reply still counts.
      await this.store.setFlagStatus(session.flag_id, "no_response");
      noResponse++;
    }

    for (const session of await this.store.rechecksDue(now.toISOString())) {
      session.recheck_due_at = null;
      if (!(await this.store.saveSession(session))) continue;
      const farmer = await this.store.getFarmer(session.farmer_id);
      const flag = await this.store.getFlag(session.flag_id);
      if (!farmer || !flag) continue;
      await this.raise(farmer, flag.disease, "recheck", flag.source, flag.details);
      rechecks++;
    }

    return { reminded, noResponse, rechecks };
  }

  /** Start a queued session and return its opening messages. */
  private async begin(farmer: Farmer, session: StoredSession): Promise<Outgoing[]> {
    const at = this.now().toISOString();
    // The farmer may have picked a language since this session was queued.
    if (!session.state.lang && farmer.lang) session.state.lang = farmer.lang;
    session.status = "active";
    session.started_at = at;
    session.last_activity_at = at;
    await this.store.saveSession(session);
    const flag = await this.store.getFlag(session.flag_id);
    return [alertText(flag?.reason ?? "new", farmer.crop, farmer.lang), render(session.state)];
  }

  private async send(farmer: Farmer, messages: Outgoing[]): Promise<string[]> {
    await this.outbox.send(farmer, messages);
    return messages.map((m) => (typeof m === "string" ? m : toText(m)));
  }
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
}
