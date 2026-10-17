# USSD and SMS setup

About 9 in 10 farmers around Kasungu have a basic keypad phone, not a
smartphone. They answer FieldWise by USSD: when there's a question for them,
FieldWise opens the USSD session on their phone (a "push"), so they don't
have to dial. They can also dial `*384*123#` themselves, and Felix's messages
reach them by SMS. This guide covers the demo, the
Africa's Talking sandbox, and what going live needs.

## How it works

| Step | What happens |
|---|---|
| The forecast flags a farm | A USSD session **opens on the farmer's phone** with the alert and the first question. |
| First time only | The language, then **"Which ward is your farm in?"** (10 wards), before the crop. Both are kept, so later alerts go straight to the crop. |
| Push not answered | After 5 minutes (at the next hourly run, or **Send reminders** in the demo) the farmer gets **one SMS**: "Dial *384*123# to answer." |
| The farmer dials | They go straight to the waiting questions, where they left off. `0` opens the menu. |
| Each answer | Saved at once. A dropped call or a timeout resumes at the same question on the next dial. |
| Nothing waiting | The menu: **1** report a crop problem, **2** messages from Felix, **3** ask Felix to call me, **4** language. |
| Felix replies | From his phone or the dashboard: a ready-made reply or his own words, by SMS (WhatsApp for smartphone farmers). |

A USSD screen holds about 182 characters. The longest question is 148, so
questions always fit. A "thank you" line, or a retry hint, is dropped when a
screen would be too long. Screens use plain GSM characters only, because many
keypad phones show anything else as `?`.

The wards in `WARDS` (`src/messages.ts`) are placeholders: ten places around
Kasungu district. Replace them with the official ward list for Felix's area.
Felix's phone, dashboard and app show each farm's ward.

A pushed screen starts with the alert when it fits, else a one-line intro,
else just "FieldWise". Reminders are pushed too.

**Push needs the right gateway.** Network-initiated (pushed) USSD is only
offered by some aggregators, and Africa's Talking's standard USSD API is
dial-in only. Until a push gateway is wired in (`ussdPusher`'s `gateway` in
`src/ussd.ts`), only the demo farmers' pushes happen (simulated); real
farmers get the SMS with the dial code instead.

## The demo (no account needed)

Open `/demo`. The left phone is a keypad phone for the seven USSD farmers
(John Banda, F056, stays on WhatsApp). `/phone` opens it on its own.

1. Press **Wet spell**. The phone buzzes and the USSD session opens by
   itself: language, then ward, then the plant, then its questions.
2. Type a number on the keypad (or your keyboard) and press **OK** (or Enter).
3. To get back in later, press **Dial *384*123#** (or type `*384*123#` and
   press the green key). It resumes at the same question.
4. Felix's messages arrive as SMS: press the left key, or **Messages**.
   The right key clears, then cancels; the red key hangs up.
5. A session idle for 2 minutes times out, as on a real network. Dial again to
   carry on.

On Felix's phone, open a farm and tap **Message <name>** to send a reply; it
arrives on the keypad phone as an SMS. A farmer's **Ask Felix to call me**
shows on Felix's phone and the dashboard under **Call back**.

Demo farmers (`demo = 1`, numbers starting `+265 0`) are never sent a real
SMS, whatever is configured.

## The Africa's Talking sandbox

The sandbox is free and needs no shortcode. Its web simulator plays the part
of the phone.

1. Sign up at [africastalking.com](https://africastalking.com) and open the
   **Sandbox** app.
2. **USSD → Create channel.** Pick a sandbox service code (it looks like
   `*384*1234#`). Set the callback URL to:

   ```
   https://<your-worker>.workers.dev/ussd?key=<USSD_KEY>
   ```

   where `USSD_KEY` is a long random string you choose. Africa's Talking
   doesn't sign its requests, so the key in the URL is what keeps others out.
3. **Settings → API key.** Generate a sandbox API key.
4. Set the Worker's secrets, from `apps/logic`:

   ```bash
   npx wrangler secret put USSD_KEY
   ```

   ```bash
   npx wrangler secret put AT_API_KEY
   ```

   and set `AT_USERNAME` to `sandbox` (it isn't secret, so it can go in
   `wrangler.jsonc` under `vars`, or as a secret too).
5. Register the simulator's phone number as a farmer on USSD:

   ```bash
   curl -X POST https://<your-worker>.workers.dev/farmers \
     -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
     -d '{"name":"Test Farmer","phone":"+265991234567","latitude":-13.04,"longitude":33.49,"channel":"ussd","officer_id":"OFF01"}'
   ```

6. In the sandbox's simulator, use that number and dial your service code.
   SMS from FieldWise show in the simulator's inbox.
7. Change `USSD_CODE` in `src/messages.ts` to your service code, so the SMS
   says the right thing to dial.

| Setting | Secret? | What it is |
|---|---|---|
| `USSD_KEY` | yes | The `key` in the USSD callback URL |
| `AT_USERNAME` | | `sandbox`, or your live app's username |
| `AT_API_KEY` | yes | Africa's Talking API key |
| `AT_SENDER_ID` | | A registered sender id or short code (optional) |

## Going live

- **A USSD code and SMS sender in Malawi.** These are leased from the networks
  (Airtel and TNM) through an aggregator. Check that Africa's Talking (or
  another aggregator) covers both Malawian networks before relying on it, and
  what a dedicated code costs against a shared one (`*384*123*45#`).
- **Who pays.** Farmers shouldn't pay to answer. Ask for zero-rated
  (reverse-billed) USSD, so the session is free to the farmer.
- **Chichewa.** Every farmer-facing line has a draft Chichewa version. Test
  it with farmers before use.
- **Consent.** Register farmers with their agreement, and say in the first
  SMS how to stop.
