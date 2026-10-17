-- Delivery status for messages sent through WhatsApp, and the inbound message
-- ids already handled, because Meta retries webhooks.

ALTER TABLE messages ADD COLUMN status TEXT;      -- sent, delivered, read or failed; null for the simulator
ALTER TABLE messages ADD COLUMN error TEXT;       -- why delivery failed
ALTER TABLE messages ADD COLUMN provider_id TEXT; -- WhatsApp's message id
CREATE INDEX messages_provider ON messages (provider_id);

CREATE TABLE whatsapp_seen (
  id TEXT PRIMARY KEY,                            -- WhatsApp's id for an inbound message
  at TEXT NOT NULL
);
