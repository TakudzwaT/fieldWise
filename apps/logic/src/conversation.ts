// The farmer's side of a flag: raising it sends an alert and the first
// question, each reply moves the questionnaire on, and the last answer is
// scored for Felix. A farmer answers one questionnaire at a time; any others
// wait in a queue and start when the current one is done.
//
// Housekeeping (sweep) runs on the cron: one reminder after 24 h of silence,
// "no response" 24 h after that, and black rot's re-ask a week after a clear.

import { render, reply, start, toText } from "./engine";
import { alertText, noQuestionsText, nudgeText, NOT_REGISTERED, reminderText } from "./messages";
import type { Outbox, Outgoing } from "./outbox";
import type { DiseaseId } from "./questionnaires";
import { score } from "./scoring";
import type { Farmer, Flag, FlagDetails, FlagReason, FlagSource, Store, StoredSession } from "./store";

const DAY_MS = 24 * 60 * 60 * 1000;
export const REMIND_AFTER_MS = DAY_MS;
export const NO_RESPONSE_AFTER_MS = DAY_MS;
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
    };
    await this.store.addFlagWithSession(flag, session);
    if (startsNow) await this.outbox.send(farmer, [alertText(reason, farmer.crop, farmer.lang), render(session.state)]);
    return flag;
  }

  /** A message from a farmer. Returns what was sent back. */
  async inbound(phone: string, text: string): Promise<string[]> {
    const farmer = await this.store.getFarmerByPhone(phone);
    if (!farmer) return [NOT_REGISTERED];
    const at = this.now().toISOString();
    await this.store.logMessage({ farmer_id: farmer.id, direction: "in", channel: farmer.channel, body: text, at });

    const session = await this.store.activeSession(farmer.id);
    if (!session) return this.send(farmer, [noQuestionsText(farmer.lang)]);

    // A greeting, a template's Start button, or a voice note or photo: show the
    // current screen again rather than counting it as a wrong answer.
    if (RESUME.has(text.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ""))) {
      session.last_activity_at = at;
      await this.store.saveSession(session);
      return this.send(farmer, [render(session.state)]);
    }

    const turn = reply(session.state, text);
    session.state = turn.session;
    session.last_activity_at = at;
    if (turn.session.lang && !farmer.lang) {
      await this.store.setLang(farmer.id, turn.session.lang);
      farmer.lang = turn.session.lang;
    }

    const flag = await this.store.getFlag(session.flag_id);
    if (flag?.status === "no_response") await this.store.setFlagStatus(flag.id, "awaiting");

    if (!turn.done) {
      await this.store.saveSession(session);
      return this.send(farmer, [turn.prompt]);
    }

    const report = score(session.state.disease, session.state.answers, { leafWetHours: flag?.details.leaf_wet_hours ?? undefined });
    session.status = "done";
    session.completed_at = at;
    session.report = report;
    session.recheck_due_at = report.recheckInDays ? new Date(this.now().getTime() + report.recheckInDays * DAY_MS).toISOString() : null;
    await this.store.saveSession(session);
    if (flag) await this.store.setFlagStatus(flag.id, "answered");

    const replies: Outgoing[] = [turn.prompt];
    const next = await this.store.nextQueued(farmer.id);
    if (next) replies.push(...(await this.begin(farmer, next)));
    return this.send(farmer, replies);
  }

  /** Reminders, no-response marks and re-asks that have come due. */
  async sweep(): Promise<{ reminded: number; noResponse: number; rechecks: number }> {
    const now = this.now();
    let reminded = 0;
    let noResponse = 0;
    let rechecks = 0;

    for (const session of await this.store.needingReminder(new Date(now.getTime() - REMIND_AFTER_MS).toISOString())) {
      const farmer = await this.store.getFarmer(session.farmer_id);
      if (!farmer) continue;
      session.reminded_at = now.toISOString();
      await this.store.saveSession(session);
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
      await this.store.saveSession(session);
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
