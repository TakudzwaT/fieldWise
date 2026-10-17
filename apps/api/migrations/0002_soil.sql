-- Soil per farm point, rounded to 0.01° (about 1 km). Soil doesn't change from
-- week to week, so each point is fetched from SoilGrids once and kept.

CREATE TABLE soil (
  id TEXT PRIMARY KEY,          -- e.g. "-13.08_33.46"
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  data TEXT NOT NULL,           -- JSON: ph, clay_pct, sand_pct, silt_pct, drainage
  fetched_at TEXT NOT NULL      -- UTC ISO
);
