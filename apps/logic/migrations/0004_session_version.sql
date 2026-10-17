-- A version number on each session, so two replies handled at the same moment
-- (two quick taps on WhatsApp) can't overwrite each other. A save only lands
-- if the version is still the one that was read.

ALTER TABLE sessions ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
