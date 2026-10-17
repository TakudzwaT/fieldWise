// Everything sent to a farmer goes through here: it is handed to the farmer's
// channel, then logged with how delivery went. "sim" farmers have no delivery;
// the web simulator reads their messages from the log.

import { toText, type Prompt } from "./engine";
import type { Channel, DeliveryStatus, Farmer, Message, Store } from "./store";

/** A plain message, or a question with reply options. */
export type Outgoing = string | Prompt;

/** Sends one message; returns the channel's id for it. Throws if it fails. */
export type Deliver = (farmer: Farmer, message: Outgoing) => Promise<{ id: string }>;

export class Outbox {
  constructor(
    private store: Store,
    private now: () => Date,
    private deliverers: Partial<Record<Channel, Deliver>> = {},
    /** Called after logging, once per failed message (for WhatsApp's template fallback). */
    private onFailure?: (farmer: Farmer, error: unknown) => Promise<void>,
  ) {}

  async send(farmer: Farmer, messages: Outgoing[]): Promise<void> {
    const at = this.now().toISOString();
    const log: Omit<Message, "id">[] = [];
    const failures: unknown[] = [];
    for (const message of messages) {
      const body = typeof message === "string" ? message : toText(message);
      let status: DeliveryStatus | null = null;
      let error: string | null = null;
      let providerId: string | null = null;
      if (farmer.channel !== "sim") {
        const deliver = this.deliverers[farmer.channel];
        try {
          if (!deliver) throw new Error(`${farmer.channel} is not configured`);
          providerId = (await deliver(farmer, message)).id;
          status = "sent";
        } catch (err) {
          // Keep going: the message is logged as failed, the flow carries on,
          // and the farmer can still answer when the channel works again.
          console.error(`Delivery to ${farmer.id} failed`, err);
          status = "failed";
          error = err instanceof Error ? err.message : String(err);
          failures.push(err);
        }
      }
      log.push({ farmer_id: farmer.id, direction: "out", channel: farmer.channel, body, at, status, error, provider_id: providerId });
    }
    await this.store.logMessages(log);
    for (const failure of failures) await this.onFailure?.(farmer, failure);
  }
}
