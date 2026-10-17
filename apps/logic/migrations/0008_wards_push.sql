-- The farmer's ward, asked once (the first question, before the crop) and
-- kept, so Felix can see and group farms by ward.
ALTER TABLE farmers ADD COLUMN ward TEXT;

-- USSD sessions FieldWise opened on the farmer's phone (network-initiated,
-- "pushed"), rather than ones the farmer dialled. A push nobody answers is
-- followed by an SMS saying what to dial; fallback_at records when.
ALTER TABLE ussd_sessions ADD COLUMN pushed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ussd_sessions ADD COLUMN fallback_at TEXT;
CREATE INDEX ussd_sessions_pushed ON ussd_sessions (pushed, inputs, fallback_at);
