// Everything sent to a farmer goes through here: it is handed to the farmer's
// channel, then logged with how delivery went. "sim" farmers and demo farmers
// have no delivery; the simulators read their messages from the log.
//
// For USSD farmers, a batch that asks a question (an alert and its first
// question, say) is pushed: FieldWise opens a USSD session on the phone with
// the question on screen, so the farmer doesn't have to dial (see ussd.ts).
// When a push isn't possible, or for a batch with no question (a message from
// Felix), it goes out as one SMS: the text, and "Dial *384*123# to answer."
// when a question is waiting.

import { toText, type Prompt } from "./engine";
import { dialText } from "./messages";
import type { Channel, DeliveryStatus, Farmer, Message, Store } from "./store";

/** A plain message, or a question with reply options. */
export type Outgoing = string | Prompt;

/** Sends one message; returns the channel's id for it. Throws if it fails. */
export type Deliver = (farmer: Farmer, message: Outgoing) => Promise<{ id: string }>;

/** Opens a USSD session on the farmer's phone with this batch. False if it can't. */
export type Push = (farmer: Farmer, messages: Outgoing[]) => Promise<boolean>;

/** Who wrote a message, when it wasn't FieldWise itself. */
export interface SendOptions {
  officerId?: string;
}

export class Outbox {
  constructor(
    private store: Store,
    private now: () => Date,
    private deliverers: Partial<Record<Channel, Deliver>> = {},
    /** Called after logging, once per failed message (for WhatsApp's template fallback). */
    private onFailure?: (farmer: Farmer, error: unknown) => Promise<void>,
    private push?: Push,
  ) {}

  async send(farmer: Farmer, messages: Outgoing[], options: SendOptions = {}): Promise<void> {
    if (farmer.channel === "ussd") {
      if (this.push && asks(messages) && (await this.push(farmer, messages))) return;
      messages = asSms(farmer, messages);
    }
    if (!messages.length) return;
    const at = this.now().toISOString();
    const log: Omit<Message, "id">[] = [];
    const failures: unknown[] = [];
    for (const message of messages) {
      const body = typeof message === "string" ? message : toText(message);
      let status: DeliveryStatus | null = null;
      let error: string | null = null;
      let providerId: string | null = null;
      if (farmer.channel !== "sim" && !farmer.demo) {
        const deliver = this.deliverers[farmer.channel];
        try {
          if (!deliver) throw new Error(`${farmer.channel === "ussd" ? "SMS" : farmer.channel} is not configured`);
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
      // A question with reply buttons keeps its screen, so the simulator can send it back with a tap.
      const screen = typeof message === "string" || !message.options.length ? null : message.key;
      log.push({
        farmer_id: farmer.id,
        direction: "out",
        channel: farmer.channel,
        body,
        at,
        status,
        error,
        provider_id: providerId,
        screen,
        kind: farmer.channel === "ussd" ? "sms" : null,
        officer_id: options.officerId ?? null,
      });
    }
    await this.store.logMessages(log);
    for (const failure of failures) await this.onFailure?.(farmer, failure);
  }
}

/** A batch as one SMS: the text, and how to answer if it held a question. */
export function asSms(farmer: Farmer, messages: Outgoing[]): string[] {
  const texts = messages.filter((m): m is string => typeof m === "string");
  if (asks(messages)) texts.push(dialText(farmer.lang));
  return texts.length ? [texts.join("\n")] : [];
}

/** True when the batch puts a question to the farmer. */
function asks(messages: Outgoing[]): boolean {
  return messages.some((m) => typeof m !== "string" && m.options.length > 0);
}
