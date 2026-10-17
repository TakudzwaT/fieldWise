// SMS through Africa's Talking, for USSD farmers' alerts, reminders and
// officers' messages. Without AT_USERNAME and AT_API_KEY nothing is sent and
// the message is logged as failed. Demo farmers are never sent anything.
//
// The sandbox (AT_USERNAME=sandbox) delivers to Africa's Talking's web
// simulator instead of real phones; see docs/ussd-setup.md.

import type { Deliver } from "./outbox";
import { toText } from "./engine";

export interface SmsEnv {
  AT_USERNAME?: string;
  AT_API_KEY?: string;
  /** A registered sender id or short code; Africa's Talking's default when unset. */
  AT_SENDER_ID?: string;
}

export interface SmsConfig {
  username: string;
  apiKey: string;
  from: string | null;
}

export function smsConfig(env: SmsEnv): SmsConfig | null {
  if (!env.AT_USERNAME || !env.AT_API_KEY) return null;
  return { username: env.AT_USERNAME, apiKey: env.AT_API_KEY, from: env.AT_SENDER_ID || null };
}

export function smsUrl(config: SmsConfig): string {
  return config.username === "sandbox"
    ? "https://api.sandbox.africastalking.com/version1/messaging"
    : "https://api.africastalking.com/version1/messaging";
}

export function smsDeliver(config: SmsConfig, fetchFn: typeof fetch = fetch): Deliver {
  return async (farmer, message) => {
    const form = new URLSearchParams({ username: config.username, to: farmer.phone, message: typeof message === "string" ? message : toText(message) });
    if (config.from) form.set("from", config.from);
    const response = await fetchFn(smsUrl(config), {
      method: "POST",
      headers: { apiKey: config.apiKey, Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
    });
    if (!response.ok) throw new Error(`Africa's Talking SMS: HTTP ${response.status}`);
    const data = (await response.json()) as { SMSMessageData?: { Recipients?: { status: string; messageId: string }[] } };
    const recipient = data.SMSMessageData?.Recipients?.[0];
    if (!recipient || recipient.status !== "Success") throw new Error(`Africa's Talking SMS: ${recipient?.status ?? "no recipient"}`);
    return { id: recipient.messageId };
  };
}
