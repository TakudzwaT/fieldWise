-- USSD for farmers without a smartphone (about 9 in 10 in Kasungu), and the
-- officer's side: logins, replies to farmers and call-back requests.
--
-- USSD farmers get alerts and Felix's messages by SMS, and dial the USSD code
-- to answer. Seven of the eight demo farmers move to USSD. John Banda (F056)
-- stays on the simulated WhatsApp chat, as the 1 in 10 with a smartphone.

-- demo = 1: a made-up farmer whose messages never leave FieldWise, whatever
-- the channel. The seeded farmers' numbers (+265 0...) aren't real.
ALTER TABLE farmers ADD COLUMN demo INTEGER NOT NULL DEFAULT 0;
ALTER TABLE farmers ADD COLUMN officer_id TEXT;
UPDATE farmers SET demo = 1 WHERE phone LIKE '+2650%';
UPDATE farmers SET channel = 'ussd' WHERE id IN ('F014', 'F027', 'F043', 'F062', 'F075', 'F084', 'F091');

-- Extension officers. A login token is shown once when made; only its
-- SHA-256 hash is kept.
CREATE TABLE officers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  area TEXT,
  token_hash TEXT UNIQUE,
  created_at TEXT NOT NULL
);
INSERT INTO officers (id, name, area, created_at) VALUES ('OFF01', 'Felix', 'Kasungu', '2026-10-17T00:00:00Z');
UPDATE farmers SET officer_id = 'OFF01';

-- kind: "sms" for a text message, "ussd" for a USSD screen or a key pressed
-- in one, null for a chat (WhatsApp or its simulator).
-- officer_id: set when an officer wrote the message.
ALTER TABLE messages ADD COLUMN kind TEXT;
ALTER TABLE messages ADD COLUMN officer_id TEXT;

-- One row per USSD session (one dial). The gateway sends every input so far
-- with each request, so `inputs` tells a repeated request from a new answer,
-- and `response` is what to send back if it is repeated.
CREATE TABLE ussd_sessions (
  id TEXT PRIMARY KEY,          -- the gateway's sessionId
  farmer_id TEXT NOT NULL,
  mode TEXT NOT NULL,           -- lang, home, report, round, inbox or menu_lang
  page INTEGER NOT NULL DEFAULT 0, -- which message the inbox is showing
  inputs INTEGER NOT NULL,      -- how many inputs have been handled
  response TEXT NOT NULL,       -- the last "CON ..." or "END ..." sent
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX ussd_sessions_updated ON ussd_sessions (updated_at);

-- "Ask Felix to call me", from the USSD menu. Open until the officer marks it done.
CREATE TABLE callbacks (
  id TEXT PRIMARY KEY,
  farmer_id TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  done_at TEXT,
  done_by TEXT
);
CREATE INDEX callbacks_open ON callbacks (done_at, requested_at);
