-- Which questionnaire screen an outgoing question was ("lang", "s0" to "s7"),
-- so the phone simulator can draw its buttons and send the screen back with
-- a tap, the way WhatsApp's buttons do.

ALTER TABLE messages ADD COLUMN screen TEXT;
