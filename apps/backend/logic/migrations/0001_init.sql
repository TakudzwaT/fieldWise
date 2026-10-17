-- Farmers, the alert state per farm and disease, the flags raised, the
-- questionnaire sessions they start, and every message in and out.
-- Times are UTC ISO strings.

CREATE TABLE farmers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  farm_name TEXT,
  phone TEXT NOT NULL UNIQUE,   -- E.164, e.g. "+265991234567"
  crop TEXT NOT NULL,           -- tomato, maize, beans or cabbage
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  lang TEXT,                    -- "en" or "ny"; null until the farmer picks
  channel TEXT NOT NULL DEFAULT 'whatsapp', -- "whatsapp", or "sim" (never leaves FieldWise)
  created_at TEXT NOT NULL
);

-- Last forecast status per farm and disease, so alerts follow changes.
CREATE TABLE tracks (
  farmer_id TEXT NOT NULL,
  disease TEXT NOT NULL,
  status TEXT NOT NULL,         -- flag, watch or clear
  armed INTEGER NOT NULL,       -- 1 when the next flag should alert
  peak REAL,                    -- severity at the last alert
  alerted_at TEXT,
  checked_at TEXT NOT NULL,
  PRIMARY KEY (farmer_id, disease)
);

CREATE TABLE flags (
  id TEXT PRIMARY KEY,
  farmer_id TEXT NOT NULL,
  disease TEXT NOT NULL,
  reason TEXT NOT NULL,         -- new, worse, recheck or manual
  source TEXT NOT NULL,         -- forecast, scenario or manual
  raised_at TEXT NOT NULL,
  details TEXT NOT NULL,        -- JSON: the conditions and weather behind it
  status TEXT NOT NULL          -- awaiting, answered, no_response or merged
);
CREATE INDEX flags_farmer ON flags (farmer_id, raised_at);

-- One questionnaire per flag. A farmer answers one at a time; the rest queue.
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  flag_id TEXT NOT NULL UNIQUE,
  farmer_id TEXT NOT NULL,
  status TEXT NOT NULL,         -- queued, active or done
  state TEXT NOT NULL,          -- JSON: the engine's Session
  created_at TEXT NOT NULL,
  started_at TEXT,
  last_activity_at TEXT,
  reminded_at TEXT,
  completed_at TEXT,
  report TEXT,                  -- JSON: the scoring Report, once done
  recheck_due_at TEXT           -- set when a clear result should be asked again
);
CREATE INDEX sessions_farmer ON sessions (farmer_id, status, created_at);

CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  farmer_id TEXT NOT NULL,
  direction TEXT NOT NULL,      -- in or out
  channel TEXT NOT NULL,
  body TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX messages_farmer ON messages (farmer_id, id);
