# FieldWise logic layer

Sits between the weather API (`apps/api`) and the farmers. When the forecast
newly favours a crop disease, the farmer is alerted and answers a short yes/no
questionnaire. Their answers are scored into an outcome for Felix, the
extension officer.

> **Status:** step 4 of 5. Everything runs locally: alerts, questionnaires,
> scoring, the D1 database, the web phone simulator, Felix's live dashboard,
> and WhatsApp (tested against simulated Meta calls). Deployment comes next;
> WhatsApp needs it, because Meta must reach the Worker over HTTPS.

## The demo

Open `/demo` (or `/`): the farmer's phone on the left, Felix's dashboard on the
right. Both pages ask for the admin token once and keep it in that browser.

1. **Wet spell** (dashboard, demo controls) runs a made-up wet spell through
   the real rules. Every farm is flagged and gets an alert.
2. Answer on the phone, by tapping Yes/No or typing `1`, `2`, `yes`, `inde`.
3. The dashboard updates every 3 seconds. A questionnaire still being answered
   is scored on the answers so far and marked *provisional*, so an urgent
   answer (streak virus, say) jumps to the top before the farmer finishes.
4. **Dry spell** clears the flags and re-arms the alerts, so the next wet spell
   fires again. **Reset demo** deletes every flag, answer and message (farmers
   stay).

`/sim` and `/dashboard` also work on their own; `/sim?farmer=F056` opens one
farmer.

## How it decides

1. **Alert on a change** (`src/trigger.ts`). Each forecast run gives each farm
   and disease a status from the API's `/assess`: flag, watch or clear. A farm
   is alerted when it moves into flag, and again only if the spell gets much
   worse (for example leaves wet 10 h, then 24 h), at most once a day. It
   re-arms once conditions clear. Watch never alerts.
2. **Ask the questionnaire for that flag** (`src/questionnaires.ts`,
   `src/engine.ts`). Six questionnaires, from "USSD Questionnaire" (Zekhethelo,
   16 Oct 2026): four main questions, each with one follow-up, so eight
   screens. Answers are `1` yes or `2` no, or typed words in English or
   Chichewa. The screen names the crop ("Your maize") and never the disease.
   A farmer who stops partway picks up where they left off.
3. **Score the answers** (`src/scoring.ts`) into one of five outcomes:

| Outcome | When | Felix |
|---|---|---|
| `confirmed_urgent` | Flagged disease confirmed, worse and spreading | Go now |
| `confirmed` | Flagged disease confirmed, spread limited | Go this week |
| `wrong_flag` | Answers point to a different problem | Go, for that problem |
| `early_signs` | Nothing confirmed, but a worrying answer | Re-check next forecast |
| `clear` | Nothing confirmed | No action (black rot: ask again in 7 days) |

Special rules from the document: maize streak virus is urgent whatever else
is said; tomato Q4 yes + yes outranks a late blight result as bacterial wilt;
dark rotten cabbage roots go to Felix as root rot; and a clubroot "same spot
in past seasons" means an infested field (rotation and liming, not a spray).

**Chichewa text is an unverified draft.** Test it with farmers before use.

## The flow

1. Each hour (15 past, after the weather API refreshes) the cron sends every
   farm's crop and location to the weather API's `/assess`, looking 72 hours
   ahead, and puts each disease's status through the trigger.
2. An alert raises a **flag** and queues its questionnaire. If the farmer has
   nothing else open, they get the alert and the first screen. A farmer answers
   one questionnaire at a time; the next starts when they finish.
3. Each reply moves the questionnaire on. The last answer is scored, and the
   report is stored on the session.
4. A farmer silent for 24 hours (about 20 on WhatsApp, see below) gets one
   reminder. 24 hours after that the flag
   shows as `no_response`, so a silent farm doesn't look healthy. A late reply
   still counts. A black rot questionnaire that comes back clear is sent again
   7 days later.

A spell that gets worse while its questionnaire is still open doesn't restart
it. The farmer gets a nudge to finish, and the new flag is stored as `merged`.

## WhatsApp

Setup, step by step: [docs/whatsapp-setup.md](docs/whatsapp-setup.md).

- Questions arrive with **Yes/No buttons**; the crop and progress ("Your maize
  · 3 of 8") are the header. Typed `1`, `2`, `yes`, `inde` still work.
- A phone that isn't registered can text `join <crop>` (`tomato`, `maize`,
  `beans`, `cabbage`, or the Chichewa names) when `WHATSAPP_OPEN_JOIN` is
  `true`. It is registered near Kasungu under its WhatsApp profile name.
- A greeting (`hi`, `moni`), a voice note or photo, or a template's **Start**
  button shows the current question again rather than counting as a wrong
  answer.
- Each button carries its question's screen (`s3:1`), so a tap on an earlier
  question's button isn't taken as the answer to the current one; the farmer
  is shown the current question instead.
- Two replies arriving together (two quick taps are two webhook calls) can't
  overwrite each other: a session only saves if nobody saved it since it was
  read, and otherwise the reply is handled again.
- Reminders on WhatsApp go out 20 hours after the last activity, or 3 hours
  before the farmer's 24-hour window closes if sooner, so they still arrive
  without a template.
- **STOP** (or `unsubscribe`, `lekani`, `siyani`) confirms, then deletes the
  farmer and everything about them. Only on WhatsApp; the simulator's seeded
  farmers can't be deleted this way. The welcome message says how to stop.
- WhatsApp only allows these messages within 24 hours of the farmer's last
  message. Outside that, delivery fails with code 131047. If `WHATSAPP_TEMPLATE`
  is set, FieldWise sends that template instead, at most once a day per
  farmer.
- Delivery receipts (sent, delivered, read, failed) are stored on each message
  and shown as ticks in `/sim`, which mirrors a WhatsApp farmer's chat.
- Webhook calls are refused unless signed with the app secret
  (`X-Hub-Signature-256`). Meta retries webhooks, so each message is handled
  once.

| Setting | Secret? | What it is |
|---|---|---|
| `WHATSAPP_PHONE_NUMBER_ID` | | Meta's id for the sending number |
| `WHATSAPP_TOKEN` | yes | System-user access token |
| `WHATSAPP_APP_SECRET` | yes | Checks webhook signatures |
| `WHATSAPP_VERIFY_TOKEN` | yes | Any random string, for Meta's webhook check |
| `WHATSAPP_OPEN_JOIN` | | `true` to let phones join by texting `join <crop>` |
| `WHATSAPP_TEMPLATE` | | Template name for messages after 24 hours, e.g. `fieldwise_check` |
| `WHATSAPP_TEMPLATE_LANG` | | Its language code (default `en`) |
| `WHATSAPP_API_VERSION` | | Graph API version (default `v25.0`) |

Set each with `npx wrangler secret put <NAME>`. Without a token and phone
number id, WhatsApp farmers' messages are logged as failed and nothing is sent.

## Routes

Every route except `/health` needs `Authorization: Bearer <ADMIN_TOKEN>`,
because the data includes farmers' names and phone numbers. With no token
configured, every request is refused.

| Route | What it does |
|---|---|
| `GET /health` | `{ "status": "ok" }` |
| `GET /farmers` | All farmers |
| `POST /farmers` | Register one: `name`, `phone`, `crop`, `latitude`, `longitude`, and optionally `farm_name`, `lang` (`en`/`ny`) and `channel` (`whatsapp`, the default, or `sim`). A Malawi number starting 0 becomes +265. |
| `GET /farmers/:id` | A farmer, with their flags, sessions and reports |
| `GET /farmers/:id/messages` | Everything sent to and from them |
| `GET /flags` | Every flag, newest first, with its session and report |
| `POST /flags` | Raise one by hand: `farmer_id`, `disease` |
| `POST /checks/run` | Run the forecast checks now, instead of waiting for the cron |
| `POST /demo/scenario` | Put a made-up `"wet"` or `"dry"` spell through the same rules, for every farmer or one `farmer_id`. Wet raises every flag for the crop; dry clears them, so the next wet spell alerts again. Flags raised this way are marked `source: "scenario"`. |
| `POST /inbound` | A farmer's message: `phone`, `text`. Returns the replies sent back. Used by the simulator; WhatsApp will feed the same handler. |
| `POST /sweep` | Run reminders, no-response marks and re-asks now |
| `GET /felix/priority` | Felix's list: one line per flagged farm, most urgent first, in the document's format (`text`) and as fields. `?days=` sets the window (1-90, default 14). |
| `GET /felix/summary` | Totals for the same window: farms flagged, response rate, outcomes, wrong-flag rate, flags by disease, and what the answers point to |
| `POST /demo/reset` | Delete every flag, session, track and message. Needs `{"confirm": "reset"}`. |
| `GET /demo`, `/dashboard`, `/sim` | The demo pages. They hold no data, so they need no token to load. |
| `GET /whatsapp`, `POST /whatsapp` | Meta's webhook. Checked by verify token and signature, not the admin token. |

### Felix's priority order

| Rank | When |
|---|---|
| Go now | Confirmed and spreading, an urgent wrong flag (bacterial wilt, streak virus), or a provisional answer that is already urgent |
| Go this week | Confirmed, or a wrong flag, with limited spread |
| No response: chase | Silent 24 hours after a reminder. A silent farm is not a healthy farm. |
| Re-check at next forecast | Early signs only |
| Waiting for answers | Alert sent; nothing worrying answered yet |
| No action | Answered and clear |

Each farm appears once, under its most urgent flag; its other flags are listed
under `also`.

## Demo farmers

`migrations/0002_seed.sql` adds the eight Felix app farms, at the same points.
The names are invented, and the crops are changed to ones the questionnaires
cover (tomato, maize, beans, cabbage). Their phone numbers start `+265 0`,
which no real number does, and their channel is `sim`, so nothing sent to
them leaves FieldWise.

## Free plan limits

D1's free plan allows 50 queries per request. Lists are read in one joined
query and writes are batched, so a flag costs about three queries. The demo
page's wet and dry spells send one request per farm for the same reason. The
hourly check handles each farm in one run, so a large spell over many farms
could still reach the limit; Workers Paid ($5/month) raises it to 1,000.

## Development

You need Node.js 22 or newer. From `apps/logic`:

```bash
npm install
```

```bash
npm test
```

```bash
npm run typecheck
```

Tests run against Node's built-in SQLite with the real migrations applied
(`test/d1.ts`), so no Cloudflare account is needed.

To run the Worker locally, first put an admin token in `.dev.vars` (git
ignores it):

```bash
echo "ADMIN_TOKEN=$(openssl rand -hex 16)" > .dev.vars
```

```bash
npm run db:migrate:local
```

```bash
npm run dev
```

It then runs at `http://localhost:8787`, using the live weather API. To run
the hourly job by hand:

```bash
curl "http://localhost:8787/__scheduled?cron=15+*+*+*+*"
```

## Code layout

| File | What it does |
|---|---|
| `src/index.ts` | Routes, auth and the hourly job |
| `src/felix.ts` | Felix's priority list and summary |
| `src/pages.ts` | The demo pages: phone simulator, dashboard and `/demo` |
| `src/checks.ts` | Forecast checks through the weather API, and the demo scenario |
| `src/trigger.ts` | When a status change alerts |
| `src/conversation.ts` | Alerts, replies, queueing, reminders and re-asks |
| `src/engine.ts` | One questionnaire, one answer at a time |
| `src/questionnaires.ts` | The six questionnaires and their rules |
| `src/scoring.ts` | Answers to an outcome for Felix |
| `src/messages.ts` | Alert, reminder and other farmer-facing text |
| `src/outbox.ts` | Logs and delivers outgoing messages |
| `src/whatsapp.ts` | WhatsApp webhook, delivery, joining and the template fallback |
| `src/phone.ts` | Phone number normalising |
| `src/store.ts` | D1 reads and writes |
| `migrations/` | Schema, demo farmers, WhatsApp delivery status, session versions |
| `docs/whatsapp-setup.md` | Setting up Meta's WhatsApp test number |

`src/checks.ts` imports the decision tree from `../api/src/assess.ts`, so the
scenario uses exactly the weather API's rules.
