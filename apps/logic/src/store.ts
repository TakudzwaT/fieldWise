// D1 storage for farmers, alert tracks, flags, rounds, sessions and messages.

import type { Session } from "./engine";
import type { DiseaseId, Lang } from "./questionnaires";
import type { Report } from "./scoring";
import type { Status, Track } from "./trigger";

/** ussd: alerts and Felix's messages go out by SMS, and the farmer dials in to answer. */
export type Channel = "whatsapp" | "sim" | "ussd";
/** report: the farmer reported a problem themselves, from the USSD menu. */
export type FlagReason = "new" | "worse" | "recheck" | "manual" | "report";
export type FlagSource = "forecast" | "scenario" | "manual" | "farmer";
export type FlagStatus = "awaiting" | "answered" | "no_response" | "merged" | "skipped";
/**
 * offered: at risk, waiting for the farmer to pick its plant. queued: picked,
 * behind another questionnaire for the same plant. skipped: the farmer said
 * they were done without picking it.
 */
export type SessionStatus = "offered" | "queued" | "active" | "done" | "skipped";
/** What the farmer is looking at in a round. */
export type Screen = "lang" | "pick" | "questions" | "more";

export interface Farmer {
  id: string;
  name: string;
  farm_name: string | null;
  phone: string;
  latitude: number;
  longitude: number;
  lang: Lang | null;
  channel: Channel;
  created_at: string;
  /** 1 for a made-up farmer: nothing sent to them leaves FieldWise. */
  demo?: number;
  officer_id?: string | null;
}

export interface Officer {
  id: string;
  name: string;
  phone: string | null;
  area: string | null;
  created_at: string;
}

/** One USSD session (one dial); see migrations/0007_ussd.sql. */
export interface UssdSession {
  id: string;
  farmer_id: string;
  mode: "lang" | "home" | "report" | "round" | "inbox" | "menu_lang";
  page: number;
  inputs: number;
  response: string;
  started_at: string;
  updated_at: string;
}

/** "Ask Felix to call me". */
export interface Callback {
  id: string;
  farmer_id: string;
  requested_at: string;
  done_at: string | null;
  done_by: string | null;
}

/** The weather and soil behind a flag, kept for Felix's line. */
export interface FlagDetails {
  conditions?: { condition: string; value: number | string | null; met: boolean | null }[];
  air_temp?: number | null;
  soil_temp?: number | null;
  leaf_wet_hours?: number | null;
  rain_mm?: number | null;
  drainage?: string | null;
  /** For a "worse" flag merged into an open questionnaire. */
  merged_into?: string;
}

export interface Flag {
  id: string;
  farmer_id: string;
  disease: DiseaseId;
  reason: FlagReason;
  source: FlagSource;
  raised_at: string;
  details: FlagDetails;
  status: FlagStatus;
}

/**
 * One alert to a farmer and everything they answer for it: pick a plant,
 * answer its questions, then pick another or say they are done.
 */
export interface Round {
  id: string;
  farmer_id: string;
  status: "open" | "closed";
  screen: Screen;
  reason: FlagReason;
  created_at: string;
  last_activity_at: string;
  reminded_at: string | null;
  closed_at: string | null;
  /** Bumped on every save; see saveRound. */
  version: number;
}

export interface StoredSession {
  id: string;
  flag_id: string;
  farmer_id: string;
  round_id: string | null;
  status: SessionStatus;
  state: Session;
  created_at: string;
  started_at: string | null;
  last_activity_at: string | null;
  reminded_at: string | null;
  completed_at: string | null;
  report: Report | null;
  recheck_due_at: string | null;
  /** Bumped on every save; see saveSession. */
  version: number;
}

export type DeliveryStatus = "sent" | "delivered" | "read" | "failed";

export interface Message {
  id: number;
  farmer_id: string;
  direction: "in" | "out";
  channel: string;
  body: string;
  at: string;
  status?: DeliveryStatus | null;
  error?: string | null;
  provider_id?: string | null;
  /** For a question sent out: its screen (see Prompt.key). */
  screen?: string | null;
  /** "sms", "ussd", or null for a chat. */
  kind?: "sms" | "ussd" | null;
  /** The officer who wrote it, for an officer's message. */
  officer_id?: string | null;
}

export interface FlagRow {
  flag: Flag;
  session: StoredSession | null;
  farmer: Pick<Farmer, "id" | "name" | "farm_name" | "phone" | "channel">;
}

type Row = Record<string, unknown>;

export const trackKey = (farmerId: string, disease: string) => `${farmerId}|${disease}`;

export class Store {
  constructor(private db: D1Database) {}

  // Farmers

  /** Every farmer, or only one officer's. */
  async listFarmers(officerId?: string): Promise<Farmer[]> {
    const statement = officerId
      ? this.db.prepare("SELECT * FROM farmers WHERE officer_id = ? ORDER BY id").bind(officerId)
      : this.db.prepare("SELECT * FROM farmers ORDER BY id");
    const { results } = await statement.all<Farmer>();
    return results;
  }

  async getFarmer(id: string): Promise<Farmer | null> {
    return this.db.prepare("SELECT * FROM farmers WHERE id = ?").bind(id).first<Farmer>();
  }

  async getFarmerByPhone(phone: string): Promise<Farmer | null> {
    return this.db.prepare("SELECT * FROM farmers WHERE phone = ?").bind(phone).first<Farmer>();
  }

  async addFarmer(farmer: Farmer): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO farmers (id, name, farm_name, phone, latitude, longitude, lang, channel, created_at, demo, officer_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        farmer.id,
        farmer.name,
        farmer.farm_name,
        farmer.phone,
        farmer.latitude,
        farmer.longitude,
        farmer.lang,
        farmer.channel,
        farmer.created_at,
        farmer.demo ?? 0,
        farmer.officer_id ?? null,
      )
      .run();
  }

  async setLang(farmerId: string, lang: Lang): Promise<void> {
    await this.db.prepare("UPDATE farmers SET lang = ? WHERE id = ?").bind(lang, farmerId).run();
  }

  // Tracks

  /** Every track, keyed "farmerId|disease", in one query. */
  async listTracks(): Promise<Map<string, Track>> {
    const { results } = await this.db
      .prepare("SELECT farmer_id, disease, status, armed, peak, alerted_at FROM tracks")
      .all<{ farmer_id: string; disease: DiseaseId; status: Status; armed: number; peak: number | null; alerted_at: string | null }>();
    return new Map(
      results.map((row) => [
        trackKey(row.farmer_id, row.disease),
        { status: row.status, armed: row.armed === 1, peak: row.peak, alertedAt: row.alerted_at },
      ]),
    );
  }

  /** Save many tracks in one batch. */
  async saveTracks(rows: { farmerId: string; disease: DiseaseId; track: Track }[], checkedAt: string): Promise<void> {
    if (!rows.length) return;
    await this.db.batch(rows.map(({ farmerId, disease, track }) => this.trackStatement(farmerId, disease, track, checkedAt)));
  }

  private trackStatement(farmerId: string, disease: DiseaseId, track: Track, checkedAt: string): D1PreparedStatement {
    return this.db
      .prepare(
        `INSERT INTO tracks (farmer_id, disease, status, armed, peak, alerted_at, checked_at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (farmer_id, disease) DO UPDATE SET
           status = excluded.status, armed = excluded.armed, peak = excluded.peak,
           alerted_at = excluded.alerted_at, checked_at = excluded.checked_at`,
      )
      .bind(farmerId, disease, track.status, track.armed ? 1 : 0, track.peak, track.alertedAt, checkedAt);
  }

  // Flags

  async addFlag(flag: Flag): Promise<void> {
    await this.flagInsert(flag).run();
  }

  private flagInsert(flag: Flag): D1PreparedStatement {
    return this.db
      .prepare("INSERT INTO flags (id, farmer_id, disease, reason, source, raised_at, details, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(flag.id, flag.farmer_id, flag.disease, flag.reason, flag.source, flag.raised_at, JSON.stringify(flag.details), flag.status);
  }

  async getFlag(id: string): Promise<Flag | null> {
    const row = await this.db.prepare("SELECT * FROM flags WHERE id = ?").bind(id).first<Row>();
    return row ? toFlag(row) : null;
  }

  async listFlags(farmerId?: string): Promise<Flag[]> {
    const statement = farmerId
      ? this.db.prepare("SELECT * FROM flags WHERE farmer_id = ? ORDER BY raised_at DESC, id").bind(farmerId)
      : this.db.prepare("SELECT * FROM flags ORDER BY raised_at DESC, id");
    const { results } = await statement.all<Row>();
    return results.map(toFlag);
  }

  async setFlagStatus(id: string, status: FlagStatus): Promise<void> {
    await this.db.prepare("UPDATE flags SET status = ? WHERE id = ?").bind(status, id).run();
  }

  /**
   * Flags with their session and farmer, newest first, in one query. D1's
   * free plan allows 50 queries per request, so lists never query per row.
   */
  async flagRows(filter: { farmerId?: string; since?: string; officerId?: string } = {}): Promise<FlagRow[]> {
    const where: string[] = [];
    const params: string[] = [];
    if (filter.farmerId) {
      where.push("f.farmer_id = ?");
      params.push(filter.farmerId);
    }
    if (filter.since) {
      where.push("f.raised_at >= ?");
      params.push(filter.since);
    }
    if (filter.officerId) {
      where.push("fa.officer_id = ?");
      params.push(filter.officerId);
    }
    const { results } = await this.db
      .prepare(
        `SELECT f.*,
           s.id AS s_id, s.flag_id AS s_flag_id, s.farmer_id AS s_farmer_id, s.status AS s_status, s.state AS s_state,
           s.created_at AS s_created_at, s.started_at AS s_started_at, s.last_activity_at AS s_last_activity_at,
           s.reminded_at AS s_reminded_at, s.completed_at AS s_completed_at, s.report AS s_report,
           s.recheck_due_at AS s_recheck_due_at, s.version AS s_version, s.round_id AS s_round_id,
           fa.name AS fa_name, fa.farm_name AS fa_farm_name, fa.phone AS fa_phone, fa.channel AS fa_channel
         FROM flags f
         JOIN farmers fa ON fa.id = f.farmer_id
         LEFT JOIN sessions s ON s.flag_id = f.id
         ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
         ORDER BY f.raised_at DESC, f.id`,
      )
      .bind(...params)
      .all<Row>();
    return results.map((row) => {
      const pick = (prefix: string) =>
        Object.fromEntries(Object.entries(row).filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k.slice(prefix.length), v]));
      const flagRow = Object.fromEntries(Object.entries(row).filter(([k]) => !/^(s|fa)_/.test(k)));
      return {
        flag: toFlag(flagRow),
        session: row.s_id ? toSession(pick("s_")) : null,
        farmer: { id: row.farmer_id as string, ...(pick("fa_") as Pick<Farmer, "name" | "farm_name" | "phone" | "channel">) },
      };
    });
  }

  // Rounds and sessions

  /** Flags and their sessions, and the round they open if there is one, in one batch. */
  async addFlagsWithSessions(flags: Flag[], sessions: StoredSession[], round?: Round): Promise<void> {
    const statements = [...flags.map((f) => this.flagInsert(f)), ...sessions.map((s) => this.sessionInsert(s))];
    if (round) {
      statements.unshift(
        this.db
          .prepare(
            `INSERT INTO rounds (id, farmer_id, status, screen, reason, created_at, last_activity_at, reminded_at, closed_at, version)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(...roundValues(round), round.version),
      );
    }
    if (statements.length) await this.db.batch(statements);
  }

  async openRound(farmerId: string): Promise<Round | null> {
    return this.db
      .prepare("SELECT * FROM rounds WHERE farmer_id = ? AND status = 'open' ORDER BY created_at LIMIT 1")
      .bind(farmerId)
      .first<Round>();
  }

  /**
   * Save a round if nobody else has saved it since it was read. Every reply
   * saves its round first, so this is what keeps two replies handled at the
   * same moment from both landing. Returns false (and saves nothing) when
   * another reply got there first; the caller should read again and redo.
   */
  async saveRound(round: Round): Promise<boolean> {
    const [id, ...rest] = roundValues(round);
    const result = await this.db
      .prepare(
        `UPDATE rounds SET farmer_id = ?, status = ?, screen = ?, reason = ?, created_at = ?, last_activity_at = ?,
           reminded_at = ?, closed_at = ?, version = version + 1
         WHERE id = ? AND version = ?`,
      )
      .bind(...rest, id, round.version)
      .run();
    if (result.meta.changes === 0) return false;
    round.version++;
    return true;
  }

  /** A round's sessions, oldest first. */
  async roundSessions(roundId: string): Promise<StoredSession[]> {
    const { results } = await this.db
      .prepare("SELECT * FROM sessions WHERE round_id = ? ORDER BY created_at, id")
      .bind(roundId)
      .all<Row>();
    return results.map(toSession);
  }

  /** Open rounds with no activity since `before` and no reminder yet. */
  async roundsNeedingReminder(before: string): Promise<Round[]> {
    const { results } = await this.db
      .prepare("SELECT * FROM rounds WHERE status = 'open' AND reminded_at IS NULL AND last_activity_at <= ?")
      .bind(before)
      .all<Round>();
    return results;
  }

  /** Open rounds reminded at or before `before` and still silent since. */
  async roundsSilentAfterReminder(before: string): Promise<Round[]> {
    const { results } = await this.db
      .prepare("SELECT * FROM rounds WHERE status = 'open' AND reminded_at <= ? AND last_activity_at <= reminded_at")
      .bind(before)
      .all<Round>();
    return results;
  }

  /**
   * Move a round's unanswered flags between "awaiting" and "no_response".
   * Returns how many changed.
   */
  async setRoundResponse(roundId: string, from: "awaiting" | "no_response", to: "awaiting" | "no_response"): Promise<number> {
    const result = await this.db
      .prepare(
        `UPDATE flags SET status = ? WHERE status = ? AND id IN
           (SELECT flag_id FROM sessions WHERE round_id = ? AND status IN ('offered', 'queued', 'active'))`,
      )
      .bind(to, from, roundId)
      .run();
    return result.meta.changes;
  }

  /** Mark every plant the farmer didn't pick in a round as skipped, with its flag. */
  async skipOffered(roundId: string): Promise<void> {
    await this.db.batch([
      this.db
        .prepare("UPDATE flags SET status = 'skipped' WHERE id IN (SELECT flag_id FROM sessions WHERE round_id = ? AND status = 'offered')")
        .bind(roundId),
      this.db.prepare("UPDATE sessions SET status = 'skipped' WHERE round_id = ? AND status = 'offered'").bind(roundId),
    ]);
  }

  private sessionInsert(session: StoredSession): D1PreparedStatement {
    return this.db
      .prepare(
        `INSERT INTO sessions (id, flag_id, farmer_id, status, state, created_at, started_at, last_activity_at,
           reminded_at, completed_at, report, recheck_due_at, round_id, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(...sessionValues(session), session.version);
  }

  /**
   * Save a session if nobody else has saved it since it was read. Returns false
   * (and saves nothing) when something else got there first.
   */
  async saveSession(session: StoredSession): Promise<boolean> {
    const [id, ...rest] = sessionValues(session);
    const result = await this.db
      .prepare(
        `UPDATE sessions SET flag_id = ?, farmer_id = ?, status = ?, state = ?, created_at = ?, started_at = ?,
           last_activity_at = ?, reminded_at = ?, completed_at = ?, report = ?, recheck_due_at = ?, round_id = ?,
           version = version + 1
         WHERE id = ? AND version = ?`,
      )
      .bind(...rest, id, session.version)
      .run();
    if (result.meta.changes === 0) return false;
    session.version++;
    return true;
  }

  async getSessionByFlag(flagId: string): Promise<StoredSession | null> {
    const row = await this.db.prepare("SELECT * FROM sessions WHERE flag_id = ?").bind(flagId).first<Row>();
    return row ? toSession(row) : null;
  }

  /** An unfinished session for this farm and disease, if one is open. */
  async openSessionFor(farmerId: string, disease: DiseaseId): Promise<StoredSession | null> {
    const row = await this.db
      .prepare(
        `SELECT s.* FROM sessions s JOIN flags f ON f.id = s.flag_id
         WHERE s.farmer_id = ? AND f.disease = ? AND s.status NOT IN ('done', 'skipped') ORDER BY s.created_at LIMIT 1`,
      )
      .bind(farmerId, disease)
      .first<Row>();
    return row ? toSession(row) : null;
  }

  async rechecksDue(now: string): Promise<StoredSession[]> {
    const { results } = await this.db
      .prepare("SELECT * FROM sessions WHERE recheck_due_at IS NOT NULL AND recheck_due_at <= ?")
      .bind(now)
      .all<Row>();
    return results.map(toSession);
  }

  /**
   * Delete every flag, round, session, track and message. Farmers stay, but forget
   * their language, so the next demo starts with the language question. For demos.
   */
  async resetActivity(): Promise<void> {
    await this.db.batch([
      ...["flags", "rounds", "sessions", "tracks", "messages", "ussd_sessions", "callbacks"].map((table) => this.db.prepare(`DELETE FROM ${table}`)),
      this.db.prepare("UPDATE farmers SET lang = NULL"),
    ]);
  }

  // Messages

  async logMessage(message: Omit<Message, "id">): Promise<void> {
    await this.logMessages([message]);
  }

  async logMessages(messages: Omit<Message, "id">[]): Promise<void> {
    if (!messages.length) return;
    await this.db.batch(
      messages.map((m) =>
        this.db
          .prepare(
            `INSERT INTO messages (farmer_id, direction, channel, body, at, status, error, provider_id, screen, kind, officer_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            m.farmer_id,
            m.direction,
            m.channel,
            m.body,
            m.at,
            m.status ?? null,
            m.error ?? null,
            m.provider_id ?? null,
            m.screen ?? null,
            m.kind ?? null,
            m.officer_id ?? null,
          ),
      ),
    );
  }

  /**
   * Record a delivery receipt. Receipts can arrive out of order, so a status
   * only moves forward (sent, delivered, read); failed always wins.
   */
  async setDeliveryStatus(providerId: string, status: DeliveryStatus, error: string | null): Promise<Message | null> {
    const rank = (column: string) => `CASE ${column} WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2 WHEN 'read' THEN 3 WHEN 'failed' THEN 4 ELSE 0 END`;
    await this.db
      .prepare(
        `UPDATE messages SET status = ?1, error = COALESCE(?2, error)
         WHERE provider_id = ?3 AND (?1 = 'failed' OR ${rank("status")} < ${rank("?1")})`,
      )
      .bind(status, error, providerId)
      .run();
    return this.db.prepare("SELECT * FROM messages WHERE provider_id = ?").bind(providerId).first<Message>();
  }

  /** The farmer's most recent message whose body starts with `prefix`, sent since `since`. */
  async lastMessageLike(farmerId: string, prefix: string, since: string): Promise<Message | null> {
    return this.db
      .prepare("SELECT * FROM messages WHERE farmer_id = ? AND direction = 'out' AND body LIKE ? AND at >= ? ORDER BY id DESC LIMIT 1")
      .bind(farmerId, `${prefix}%`, since)
      .first<Message>();
  }

  /** When the farmer last messaged FieldWise, or null if never. */
  async lastInboundAt(farmerId: string): Promise<string | null> {
    const row = await this.db
      .prepare("SELECT at FROM messages WHERE farmer_id = ? AND direction = 'in' ORDER BY id DESC LIMIT 1")
      .bind(farmerId)
      .first<{ at: string }>();
    return row?.at ?? null;
  }

  /** Delete a farmer and everything about them. For STOP. */
  async deleteFarmer(farmerId: string): Promise<void> {
    await this.db.batch(
      ["messages", "rounds", "sessions", "flags", "tracks", "ussd_sessions", "callbacks"]
        .map((table) => this.db.prepare(`DELETE FROM ${table} WHERE farmer_id = ?`).bind(farmerId))
        .concat(this.db.prepare("DELETE FROM farmers WHERE id = ?").bind(farmerId)),
    );
  }

  /** True the first time an inbound WhatsApp message id is seen. */
  async markSeen(providerId: string, at: string): Promise<boolean> {
    const result = await this.db.prepare("INSERT OR IGNORE INTO whatsapp_seen (id, at) VALUES (?, ?)").bind(providerId, at).run();
    return result.meta.changes > 0;
  }

  /** Messages officers sent the farmer, newest first. */
  async officerMessages(farmerId: string, limit = 5): Promise<Message[]> {
    const { results } = await this.db
      .prepare("SELECT * FROM messages WHERE farmer_id = ? AND officer_id IS NOT NULL ORDER BY id DESC LIMIT ?")
      .bind(farmerId, limit)
      .all<Message>();
    return results;
  }

  // Officers

  async getOfficer(id: string): Promise<Officer | null> {
    return this.db.prepare("SELECT id, name, phone, area, created_at FROM officers WHERE id = ?").bind(id).first<Officer>();
  }

  async listOfficers(): Promise<Officer[]> {
    const { results } = await this.db.prepare("SELECT id, name, phone, area, created_at FROM officers ORDER BY id").all<Officer>();
    return results;
  }

  async officerByTokenHash(hash: string): Promise<Officer | null> {
    return this.db.prepare("SELECT id, name, phone, area, created_at FROM officers WHERE token_hash = ?").bind(hash).first<Officer>();
  }

  async addOfficer(officer: Officer): Promise<void> {
    await this.db
      .prepare("INSERT INTO officers (id, name, phone, area, created_at) VALUES (?, ?, ?, ?, ?)")
      .bind(officer.id, officer.name, officer.phone, officer.area, officer.created_at)
      .run();
  }

  /** Replace an officer's login; the old token stops working. */
  async setOfficerToken(id: string, hash: string): Promise<boolean> {
    const result = await this.db.prepare("UPDATE officers SET token_hash = ? WHERE id = ?").bind(hash, id).run();
    return result.meta.changes > 0;
  }

  async setFarmerOfficer(farmerId: string, officerId: string | null): Promise<void> {
    await this.db.prepare("UPDATE farmers SET officer_id = ? WHERE id = ?").bind(officerId, farmerId).run();
  }

  // Call-back requests

  async addCallback(callback: Callback): Promise<void> {
    await this.db
      .prepare("INSERT INTO callbacks (id, farmer_id, requested_at, done_at, done_by) VALUES (?, ?, ?, ?, ?)")
      .bind(callback.id, callback.farmer_id, callback.requested_at, callback.done_at, callback.done_by)
      .run();
  }

  async openCallback(farmerId: string): Promise<Callback | null> {
    return this.db.prepare("SELECT * FROM callbacks WHERE farmer_id = ? AND done_at IS NULL LIMIT 1").bind(farmerId).first<Callback>();
  }

  /** Open call-back requests with their farmer, oldest first. */
  async openCallbacks(officerId?: string): Promise<(Callback & { farmer: Pick<Farmer, "id" | "name" | "farm_name" | "phone"> })[]> {
    const { results } = await this.db
      .prepare(
        `SELECT c.*, f.name AS f_name, f.farm_name AS f_farm_name, f.phone AS f_phone FROM callbacks c
         JOIN farmers f ON f.id = c.farmer_id
         WHERE c.done_at IS NULL ${officerId ? "AND f.officer_id = ?" : ""} ORDER BY c.requested_at`,
      )
      .bind(...(officerId ? [officerId] : []))
      .all<Callback & { f_name: string; f_farm_name: string | null; f_phone: string }>();
    return results.map(({ f_name, f_farm_name, f_phone, ...c }) => ({
      ...c,
      farmer: { id: c.farmer_id, name: f_name, farm_name: f_farm_name, phone: f_phone },
    }));
  }

  async getCallback(id: string): Promise<Callback | null> {
    return this.db.prepare("SELECT * FROM callbacks WHERE id = ?").bind(id).first<Callback>();
  }

  async closeCallback(id: string, at: string, by: string): Promise<boolean> {
    const result = await this.db.prepare("UPDATE callbacks SET done_at = ?, done_by = ? WHERE id = ? AND done_at IS NULL").bind(at, by, id).run();
    return result.meta.changes > 0;
  }

  // USSD sessions

  async getUssdSession(id: string): Promise<UssdSession | null> {
    return this.db.prepare("SELECT * FROM ussd_sessions WHERE id = ?").bind(id).first<UssdSession>();
  }

  async saveUssdSession(s: UssdSession): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO ussd_sessions (id, farmer_id, mode, page, inputs, response, started_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET mode = excluded.mode, page = excluded.page, inputs = excluded.inputs,
           response = excluded.response, updated_at = excluded.updated_at`,
      )
      .bind(s.id, s.farmer_id, s.mode, s.page, s.inputs, s.response, s.started_at, s.updated_at)
      .run();
  }

  /** Forget USSD sessions untouched since `before`; networks end them within minutes. */
  async pruneUssdSessions(before: string): Promise<number> {
    const result = await this.db.prepare("DELETE FROM ussd_sessions WHERE updated_at < ?").bind(before).run();
    return result.meta.changes;
  }

  async listMessages(farmerId: string, limit = 200): Promise<Message[]> {
    const { results } = await this.db
      .prepare("SELECT * FROM (SELECT * FROM messages WHERE farmer_id = ? ORDER BY id DESC LIMIT ?) ORDER BY id")
      .bind(farmerId, limit)
      .all<Message>();
    return results;
  }
}

function toFlag(row: Row): Flag {
  return { ...(row as unknown as Flag), details: JSON.parse(row.details as string) };
}

function toSession(row: Row): StoredSession {
  return {
    ...(row as unknown as StoredSession),
    state: JSON.parse(row.state as string),
    report: row.report ? JSON.parse(row.report as string) : null,
  };
}

function sessionValues(s: StoredSession) {
  return [
    s.id,
    s.flag_id,
    s.farmer_id,
    s.status,
    JSON.stringify(s.state),
    s.created_at,
    s.started_at,
    s.last_activity_at,
    s.reminded_at,
    s.completed_at,
    s.report ? JSON.stringify(s.report) : null,
    s.recheck_due_at,
    s.round_id,
  ];
}

function roundValues(r: Round) {
  return [r.id, r.farmer_id, r.status, r.screen, r.reason, r.created_at, r.last_activity_at, r.reminded_at, r.closed_at];
}
