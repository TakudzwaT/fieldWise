-- Farmers no longer register one crop: the weather is checked for every crop,
-- and the farmer picks which at-risk plant to report on. One alert opens a
-- round; the farmer reports on plants one at a time until they say they are
-- done.

ALTER TABLE farmers DROP COLUMN crop;

CREATE TABLE rounds (
  id TEXT PRIMARY KEY,
  farmer_id TEXT NOT NULL,
  status TEXT NOT NULL,         -- open or closed
  screen TEXT NOT NULL,         -- lang, pick, questions or more
  reason TEXT NOT NULL,         -- the alert that opened it: new, worse, recheck or manual
  created_at TEXT NOT NULL,
  last_activity_at TEXT NOT NULL,
  reminded_at TEXT,
  closed_at TEXT,
  version INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX rounds_farmer ON rounds (farmer_id, status);

-- Sessions now also wait as "offered" (at risk, not picked yet) or end as
-- "skipped" (the farmer said they were done without picking it).
ALTER TABLE sessions ADD COLUMN round_id TEXT;
CREATE INDEX sessions_round ON sessions (round_id, status);
