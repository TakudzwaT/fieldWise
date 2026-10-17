// D1 storage for farmers, alert tracks, flags, sessions and messages.

import type { Session } from "./engine";
import type { Crop, DiseaseId, Lang } from "./questionnaires";
import type { Report } from "./scoring";
import type { Status, Track } from "./trigger";

export type Channel = "whatsapp" | "sim";
export type FlagReason = "new" | "worse" | "recheck" | "manual";
export type FlagSource = "forecast" | "scenario" | "manual";
export type FlagStatus = "awaiting" | "answered" | "no_response" | "merged";
export type SessionStatus = "queued" | "active" | "done";

export interface Farmer {
  id: string;
  name: string;
  farm_name: string | null;
  phone: string;
  crop: Crop;
  latitude: number;
  longitude: number;
  lang: Lang | null;
  channel: Channel;
  created_at: string;
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

export interface StoredSession {
  id: string;
  flag_id: string;
  farmer_id: string;
  status: SessionStatus;
  state: Session;
  created_at: string;
  started_at: string | null;
  last_activity_at: string | null;
  reminded_at: string | null;
  completed_at: string | null;
  report: Report | null;
  recheck_due_at: string | null;
}

export interface Message {
  id: number;
  farmer_id: string;
  direction: "in" | "out";
  channel: string;
  body: string;
  at: string;
}

type Row = Record<string, unknown>;

export class Store {
  constructor(private db: D1Database) {}

  // Farmers

  async listFarmers(): Promise<Farmer[]> {
    const { results } = await this.db.prepare("SELECT * FROM farmers ORDER BY id").all<Farmer>();
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
        `INSERT INTO farmers (id, name, farm_name, phone, crop, latitude, longitude, lang, channel, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        farmer.id,
        farmer.name,
        farmer.farm_name,
        farmer.phone,
        farmer.crop,
        farmer.latitude,
        farmer.longitude,
        farmer.lang,
        farmer.channel,
        farmer.created_at,
      )
      .run();
  }

  async setLang(farmerId: string, lang: Lang): Promise<void> {
    await this.db.prepare("UPDATE farmers SET lang = ? WHERE id = ?").bind(lang, farmerId).run();
  }

  // Tracks

  async getTrack(farmerId: string, disease: DiseaseId): Promise<Track | undefined> {
    const row = await this.db
      .prepare("SELECT status, armed, peak, alerted_at FROM tracks WHERE farmer_id = ? AND disease = ?")
      .bind(farmerId, disease)
      .first<{ status: Status; armed: number; peak: number | null; alerted_at: string | null }>();
    return row ? { status: row.status, armed: row.armed === 1, peak: row.peak, alertedAt: row.alerted_at } : undefined;
  }

  async saveTrack(farmerId: string, disease: DiseaseId, track: Track, checkedAt: string): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO tracks (farmer_id, disease, status, armed, peak, alerted_at, checked_at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (farmer_id, disease) DO UPDATE SET
           status = excluded.status, armed = excluded.armed, peak = excluded.peak,
           alerted_at = excluded.alerted_at, checked_at = excluded.checked_at`,
      )
      .bind(farmerId, disease, track.status, track.armed ? 1 : 0, track.peak, track.alertedAt, checkedAt)
      .run();
  }

  // Flags

  async addFlag(flag: Flag): Promise<void> {
    await this.db
      .prepare("INSERT INTO flags (id, farmer_id, disease, reason, source, raised_at, details, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(flag.id, flag.farmer_id, flag.disease, flag.reason, flag.source, flag.raised_at, JSON.stringify(flag.details), flag.status)
      .run();
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

  // Sessions

  async addSession(session: StoredSession): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO sessions (id, flag_id, farmer_id, status, state, created_at, started_at, last_activity_at,
           reminded_at, completed_at, report, recheck_due_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(...sessionValues(session))
      .run();
  }

  async saveSession(session: StoredSession): Promise<void> {
    const [id, ...rest] = sessionValues(session);
    await this.db
      .prepare(
        `UPDATE sessions SET flag_id = ?, farmer_id = ?, status = ?, state = ?, created_at = ?, started_at = ?,
           last_activity_at = ?, reminded_at = ?, completed_at = ?, report = ?, recheck_due_at = ?
         WHERE id = ?`,
      )
      .bind(...rest, id)
      .run();
  }

  async getSessionByFlag(flagId: string): Promise<StoredSession | null> {
    const row = await this.db.prepare("SELECT * FROM sessions WHERE flag_id = ?").bind(flagId).first<Row>();
    return row ? toSession(row) : null;
  }

  async activeSession(farmerId: string): Promise<StoredSession | null> {
    const row = await this.db
      .prepare("SELECT * FROM sessions WHERE farmer_id = ? AND status = 'active' ORDER BY created_at LIMIT 1")
      .bind(farmerId)
      .first<Row>();
    return row ? toSession(row) : null;
  }

  async nextQueued(farmerId: string): Promise<StoredSession | null> {
    const row = await this.db
      .prepare("SELECT * FROM sessions WHERE farmer_id = ? AND status = 'queued' ORDER BY created_at, id LIMIT 1")
      .bind(farmerId)
      .first<Row>();
    return row ? toSession(row) : null;
  }

  /** An unfinished session for this farm and disease, if one is open. */
  async openSessionFor(farmerId: string, disease: DiseaseId): Promise<StoredSession | null> {
    const row = await this.db
      .prepare(
        `SELECT s.* FROM sessions s JOIN flags f ON f.id = s.flag_id
         WHERE s.farmer_id = ? AND f.disease = ? AND s.status != 'done' ORDER BY s.created_at LIMIT 1`,
      )
      .bind(farmerId, disease)
      .first<Row>();
    return row ? toSession(row) : null;
  }

  /** Active sessions with no reply since `before` and no reminder yet. */
  async needingReminder(before: string): Promise<StoredSession[]> {
    const { results } = await this.db
      .prepare("SELECT * FROM sessions WHERE status = 'active' AND reminded_at IS NULL AND last_activity_at <= ?")
      .bind(before)
      .all<Row>();
    return results.map(toSession);
  }

  /** Active sessions reminded at or before `before` and still silent since. */
  async silentAfterReminder(before: string): Promise<StoredSession[]> {
    const { results } = await this.db
      .prepare(
        `SELECT s.* FROM sessions s JOIN flags f ON f.id = s.flag_id
         WHERE s.status = 'active' AND s.reminded_at <= ? AND s.last_activity_at <= s.reminded_at
           AND f.status = 'awaiting'`,
      )
      .bind(before)
      .all<Row>();
    return results.map(toSession);
  }

  async rechecksDue(now: string): Promise<StoredSession[]> {
    const { results } = await this.db
      .prepare("SELECT * FROM sessions WHERE recheck_due_at IS NOT NULL AND recheck_due_at <= ?")
      .bind(now)
      .all<Row>();
    return results.map(toSession);
  }

  // Messages

  async logMessage(message: Omit<Message, "id">): Promise<void> {
    await this.db
      .prepare("INSERT INTO messages (farmer_id, direction, channel, body, at) VALUES (?, ?, ?, ?, ?)")
      .bind(message.farmer_id, message.direction, message.channel, message.body, message.at)
      .run();
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
  ];
}
