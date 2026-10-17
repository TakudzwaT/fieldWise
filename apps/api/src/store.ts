// D1 storage. Hourly and daily data are kept as one JSON row per cell per local
// day: ISO dates sort in time order, so ranges and pruning are simple
// comparisons, and a full refresh is a few dozen row writes, not hundreds.

import type { Cell } from "./cells";
import { groupByDay, type Day, type Hour } from "./summarize";

export interface StoredCell extends Cell {
  fetched_at: string | null;
}

export class Store {
  constructor(private db: D1Database) {}

  async getCell(id: string): Promise<StoredCell | null> {
    const row = await this.db
      .prepare("SELECT id, latitude, longitude, name, fetched_at FROM cells WHERE id = ?")
      .bind(id)
      .first<StoredCell>();
    return row && clean(row);
  }

  async listCells(): Promise<StoredCell[]> {
    const { results } = await this.db
      .prepare("SELECT id, latitude, longitude, name, fetched_at FROM cells ORDER BY id")
      .all<StoredCell>();
    return results.map(clean);
  }

  /**
   * Save one cell's fetch. Pass `since` (a local date) to skip days before it,
   * which earlier fetches already stored; this keeps daily writes low.
   */
  async save(cell: Cell, hours: Hour[], days: Day[], fetchedAt: string, since?: string) {
    const statements: D1PreparedStatement[] = [];
    for (const [date, rows] of groupByDay(hours)) {
      if (since && date < since) continue;
      statements.push(
        this.db
          .prepare("INSERT INTO hourly (cell, date, hours) VALUES (?, ?, ?) ON CONFLICT (cell, date) DO UPDATE SET hours = excluded.hours")
          .bind(cell.id, date, JSON.stringify(rows)),
      );
    }
    for (const { date, ...data } of days) {
      if (since && (date as string) < since) continue;
      // Merged, not replaced: the oldest days in a fetch have no risk_7d, and
      // merging keeps the value an earlier fetch calculated for them.
      statements.push(
        this.db
          .prepare("INSERT INTO daily (cell, date, data) VALUES (?, ?, ?) ON CONFLICT (cell, date) DO UPDATE SET data = json_patch(daily.data, excluded.data)")
          .bind(cell.id, date, JSON.stringify(data)),
      );
    }
    statements.push(
      this.db
        .prepare(
          "INSERT INTO cells (id, latitude, longitude, name, fetched_at) VALUES (?, ?, ?, ?, ?) " +
            "ON CONFLICT (id) DO UPDATE SET fetched_at = excluded.fetched_at, name = COALESCE(excluded.name, cells.name)",
        )
        .bind(cell.id, cell.latitude, cell.longitude, cell.name ?? null, fetchedAt),
    );
    await this.db.batch(statements);
  }

  async readDaily(cellId: string, start: string, end: string): Promise<Day[]> {
    const { results } = await this.db
      .prepare("SELECT date, data FROM daily WHERE cell = ? AND date >= ? AND date < ? ORDER BY date")
      .bind(cellId, start, end)
      .all<{ date: string; data: string }>();
    return results.map(({ date, data }) => ({ date, ...JSON.parse(data) }));
  }

  /** Hours with start <= time < end, both local "YYYY-MM-DDTHH:MM". */
  async readHourly(cellId: string, start: string, end: string): Promise<Hour[]> {
    const { results } = await this.db
      .prepare("SELECT hours FROM hourly WHERE cell = ? AND date >= ? AND date <= ? ORDER BY date")
      .bind(cellId, start.slice(0, 10), end.slice(0, 10))
      .all<{ hours: string }>();
    return results
      .flatMap(({ hours }) => JSON.parse(hours) as Hour[])
      .filter((hour) => hour.time >= start && hour.time < end);
  }

  async prune(hourlyBefore: string, dailyBefore: string): Promise<number> {
    const [hourly, daily] = await this.db.batch([
      this.db.prepare("DELETE FROM hourly WHERE date < ?").bind(hourlyBefore),
      this.db.prepare("DELETE FROM daily WHERE date < ?").bind(dailyBefore),
    ]);
    return hourly.meta.changes + daily.meta.changes;
  }
}

function clean(row: StoredCell): StoredCell {
  const cell: StoredCell = { id: row.id, latitude: row.latitude, longitude: row.longitude, fetched_at: row.fetched_at };
  if (row.name) cell.name = row.name;
  return cell;
}
