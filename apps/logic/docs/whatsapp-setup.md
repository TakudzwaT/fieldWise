# WhatsApp setup

How to connect the logic layer to WhatsApp through Meta's free WhatsApp Cloud
API test number. Part A can be done now. Part B needs the Worker deployed,
because Meta has to reach it on a public HTTPS address.

About 30 minutes, most of it waiting for verification codes.

## What the test number can and can't do

- It is free and needs no card or business verification.
- It can only message **up to 5 phone numbers** that you add and verify. Use
  your own, your teammates', and keep slots for judges if you can.
- WhatsApp only allows free-form messages (questions with Yes/No buttons)
  **within 24 hours of the farmer's last message**. Outside that window only
  an approved *template* can be sent. So for the demo, each phone texts the
  number first (`join maize`, see below), which opens the window.
- The chat shows the business as "Test Number", not FieldWise.

---

## Part A: set up Meta (do this now)

### 1. Developer account

Go to [developers.facebook.com](https://developers.facebook.com), log in with
a Facebook account, and click **Get started** to register as a developer.
Meta asks you to verify a phone number or card.

### 2. Create the app

1. **My Apps → Create app**.
2. Use case: **Connect with customers through WhatsApp**.
3. Name it `FieldWise`. When asked for a business portfolio, create one (any
   name, for example "FieldWise Hackathon").
4. Finish, then open **WhatsApp → API Setup** in the app's left menu.

### 3. Note the two IDs

On **WhatsApp → API Setup**, Meta has already given you a test number. Copy:

- **Phone number ID**: a long number, *not* the phone number itself. This is
  `WHATSAPP_PHONE_NUMBER_ID`.
- **WhatsApp Business Account ID**: only needed for templates.

### 4. Add the phones that will take part

Still on API Setup, in the **To** field, choose **Manage phone number list**
and add each phone (up to 5) in international form, for example
`+265 99 123 4567`. Each phone gets a code on WhatsApp to confirm.

Then press **Send message** to send yourself Meta's `hello_world` template. If
it arrives, the number works.

### 5. Make a token that doesn't expire

The token on the API Setup page lasts 24 hours, so it would expire in the
middle of the hackathon. Make a permanent one instead:

1. Open [business.facebook.com/settings](https://business.facebook.com/settings)
   and pick your business portfolio.
2. **Users → System users → Add**. Name it `fieldwise`, role **Admin**.
3. Select it, then **Assign assets**: give it the **FieldWise app** (full
   control) and your **WhatsApp account** (full control).
4. **Generate new token**: choose the FieldWise app, expiry **Never**, and the
   permissions `whatsapp_business_messaging` and
   `whatsapp_business_management`.
5. Copy the token straight away. Meta shows it once. This is
   `WHATSAPP_TOKEN`. Treat it like a password: don't paste it into chat, a
   commit or a document.

### 6. App secret

In the app: **App settings → Basic → App secret → Show**. This is
`WHATSAPP_APP_SECRET`. The Worker uses it to check that webhook calls really
come from Meta.

### 7. Make up a verify token

Any random string you choose, used once when connecting the webhook. This is
`WHATSAPP_VERIFY_TOKEN`:

```bash
openssl rand -hex 16
```

Keep the four values (phone number ID, token, app secret, verify token)
somewhere safe, such as a password manager, until Part B.

### 8. Optional: a template for after 24 hours

Without a template, an alert to a phone that hasn't messaged in 24 hours
fails, and shows as failed in the simulator view. With one, FieldWise sends
the template instead, and the farmer taps **Start** to begin the questions.

In [WhatsApp Manager](https://business.facebook.com/wa/manage/message-templates/),
**Create template**:

| Field | Value |
|---|---|
| Category | Utility |
| Name | `fieldwise_check` |
| Language | English |
| Body | `FieldWise: the weather this week can bring problems to your {{1}}. Please check your plants today and answer a few quick questions.` |
| Sample for {{1}} | `tomatoes` |
| Button | Quick reply: `Start` |

Approval usually takes minutes to a few hours. Only the English template is
needed; the questions after **Start** follow the farmer's language.

---

## Part B: connect the Worker (after it is deployed)

### 9. Give the Worker the values

From `apps/logic`, logged in to the deploy Cloudflare account. Each command
asks you to paste the value, so it never appears in your shell history:

```bash
npx wrangler secret put WHATSAPP_PHONE_NUMBER_ID
```

```bash
npx wrangler secret put WHATSAPP_TOKEN
```

```bash
npx wrangler secret put WHATSAPP_APP_SECRET
```

```bash
npx wrangler secret put WHATSAPP_VERIFY_TOKEN
```

To let phones register themselves by texting `join <crop>` (recommended for
the demo):

```bash
npx wrangler secret put WHATSAPP_OPEN_JOIN
```

and enter `true`. If you made the template in step 8:

```bash
npx wrangler secret put WHATSAPP_TEMPLATE
```

and enter `fieldwise_check`.

### 10. Connect the webhook

In the app: **WhatsApp → Configuration → Webhook → Edit**.

| Field | Value |
|---|---|
| Callback URL | `https://fieldwise-logic.<your-subdomain>.workers.dev/whatsapp` |
| Verify token | your `WHATSAPP_VERIFY_TOKEN` |

Click **Verify and save**. Then under **Webhook fields**, subscribe to
**messages**. That one field brings in both farmers' replies and delivery
receipts.

### 11. Try it

From one of the phones you added, send the test number:

```
join tomato
```

FieldWise replies that you're registered (crops: `tomato`, `maize`, `beans`,
`cabbage`, or `matimati`, `chimanga`, `nyemba`, `kabichi`). Then on the
dashboard, pick that farmer under **Demo controls** and press **Wet spell**.
The alert and the first question arrive on the phone with buttons.

---

## On demo day

1. Before going on stage, each phone texts `join <crop>`. That registers it
   and opens its 24-hour window.
2. On the dashboard, choose a judge's farm and press **Wet spell**. Their phone
   buzzes with the alert and the language question.
3. They tap through the eight questions. The dashboard updates as they go.
   Tapping an old question's button by mistake just shows the current one.
4. `/sim?farmer=<id>` mirrors any farmer's WhatsApp chat, with sent,
   delivered and read ticks, if you want it on the projector.

5. Afterwards, anyone can text `STOP` to be deleted and get no more messages.

If WhatsApp misbehaves, the seeded farmers on the simulator do the same flow
with nothing outside FieldWise.

## When something goes wrong

| What you see | Why | Fix |
|---|---|---|
| "Verify and save" fails | The verify token doesn't match, or the Worker isn't deployed | Check `WHATSAPP_VERIFY_TOKEN`; open `/health` on the Worker |
| Messages show "failed" with code 131047 | More than 24 hours since that phone last messaged | Have the phone text the number, or add the template (step 8) |
| Messages show "failed" with code 131030 | The phone isn't on the test number's list | Add and verify it (step 4) |
| Nothing arrives, nothing fails | Webhook not subscribed to **messages** | Step 10 |
| 401 errors in the Worker logs | Token expired or wrong | Use the permanent token from step 5 |

Logs: Cloudflare dashboard → **Workers & Pages → fieldwise-logic → Logs**, or
`npx wrangler tail fieldwise-logic`.
