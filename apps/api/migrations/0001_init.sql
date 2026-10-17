-- Weather is stored per grid cell. Hourly and daily rows hold JSON, one row per
-- cell per local day, which keeps writes low enough for D1's free plan.

CREATE TABLE cells (
  id TEXT PRIMARY KEY,          -- e.g. "-13.0_33.5"
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  name TEXT,                    -- set for named places such as "kasungu"
  fetched_at TEXT               -- last successful Open-Meteo fetch, UTC ISO
);

-- One row per cell per day; `hours` is a JSON array of that day's 24 hourly rows.
CREATE TABLE hourly (
  cell TEXT NOT NULL,
  date TEXT NOT NULL,           -- local date, YYYY-MM-DD
  hours TEXT NOT NULL,
  PRIMARY KEY (cell, date)
);

-- One row per cell per day; `data` is a JSON object of the daily summary.
CREATE TABLE daily (
  cell TEXT NOT NULL,
  date TEXT NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (cell, date)
);
