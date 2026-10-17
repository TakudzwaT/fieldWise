// Everything sent to a farmer goes through here: it is logged, then handed to
// the farmer's channel. "sim" farmers have no delivery; the web simulator reads
// their messages from the log. WhatsApp delivery plugs in as a Deliver.

import { toText, type Prompt } from "./engine";
import type { Channel, Farmer, Store } from "./store";

/** A plain message, or a question with reply options. */
export type Outgoing = string | Prompt;

export type Deliver = (farmer: Farmer, message: Outgoing) => Promise<void>;

export class Outbox {
  constructor(
    private store: Store,
    private now: () => Date,
    private deliverers: Partial<Record<Channel, Deliver>> = {},
  ) {}

  async send(farmer: Farmer, messages: Outgoing[]): Promise<void> {
    const at = this.now().toISOString();
    await this.store.logMessages(
      messages.map((message) => ({
        farmer_id: farmer.id,
        direction: "out",
        channel: farmer.channel,
        body: typeof message === "string" ? message : toText(message),
        at,
      })),
    );
    const deliver = this.deliverers[farmer.channel];
    if (deliver) for (const message of messages) await deliver(farmer, message);
  }
}
