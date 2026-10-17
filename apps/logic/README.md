# FieldWise logic layer

Sits between the weather API (`apps/api`) and the farmers. When the forecast
newly favours a crop disease, the farmer is alerted, picks which at-risk plant
to report on, and answers a short yes/no questionnaire about it, then may pick
another. Their answers are scored into an outcome for Felix, the extension
officer.

> **Status:** step 4 of 5. Everything runs locally: alerts, questionnaires,
> scoring, the D1 database, the web phone simulator, Felix's live dashboard,
> and WhatsApp (tested against simulated Meta calls). Deployment comes next;
> WhatsApp needs it, because Meta must reach the Worker over HTTPS.

## The demo

Open `/demo` (or `/`): the farmer's phone, Felix's phone, and Felix's
dashboard, side by side (a screen at least 1300 pixels wide fits all three).
The pages ask for the admin token once and keep it in that browser. The top
bar has **Wet spell**, **Dry spell** and **Reset** for one farm or all.

1. **Wet spell** (dashboard, demo controls) runs a made-up wet spell through
   the real rules. It puts all four crops at risk (late blight, maize leaf
   blights, bean leaf diseases, clubroot), and every farm gets one alert.
2. On the phone, pick a language, then the plant to report on, then answer
   its questions by tapping Yes/No or typing `1`, `2`, `yes`, `inde`. After
   each plant the farmer is asked whether to report on another; **No** ends
   it, and the plants not picked are left off Felix's list.
   The phone is drawn as a WhatsApp chat: the alert drops in as a
   notification, questions come with reply buttons in the bubble, FieldWise
   shows "typing…", and the farmer's replies get ticks. It is a simulation;
   nothing leaves FieldWise. (Real WhatsApp is built too, below, but needs a
   Meta account and a deploy.)
3. Felix's phone and the dashboard update every 2 seconds. When a farmer
   finishes, Felix's phone gets a push notification with what the answers
   mean ("Go now: answers point to bacterial wilt, not late blight"); it also
   notifies when flags go out and when an answer turns urgent mid-way. A
   questionnaire still being answered
   is scored on the answers so far and marked *provisional*, so an urgent
   answer (streak virus, say) jumps to the top before the farmer finishes.
4. **Dry spell** clears the flags and re-arms the alerts, so the next wet spell
   fires again. **Reset demo** deletes every flag, answer and message; farmers
   stay but forget their language, so the next run starts with the language
   question.

`/sim`, `/officer` (Felix's phone) and `/dashboard` also work on their own;
`/sim?farmer=F056` opens one farmer.

## How it decides

1. **Alert on a change** (`src/trigger.ts`). Each forecast run gives each farm
   and disease a status from the API's `/assess`: flag, watch or clear. A farm
   is alerted when it moves into flag, and again only if the spell gets much
   worse (for example leaves wet 10 h, then 24 h), at most once a day. It
   re-arms once conditions clear. Watch never alerts.
2. **Let the farmer pick a plant, then ask its questionnaires**
   (`src/conversation.ts`, `src/questionnaires.ts`, `src/engine.ts`). Farmers
   don't register a crop: every crop is checked at the farm's location, and
   the alert lists the plants at risk. Picking one asks every questionnaire
   flagged for it, one after another, then "Do you want to report on another
   plant?". Six questionnaires, from "USSD Questionnaire" (Zekhethelo, 16 Oct
   2026): four main questions, each with one follow-up, so eight screens.
   Answers are `1` yes or `2` no, or typed words in English or Chichewa; a
   plant can also be picked by name. The screen names the crop ("Your maize")
   and never the disease. A farmer who stops partway picks up where they left
   off.
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
   farm's location to the weather API's `/assess` for all crops, looking 72
   hours ahead, and puts each disease's status through the trigger.
2. Each alert raises a **flag**. A farm's new flags go out together: one alert
   opens a **round**, which asks the language (first time only), then "Which
   plant do you want to report on?" with the plants at risk.
3. The farmer picks a plant and answers its questionnaires. Each finished one
   is scored, and the report is stored on its session. Then "Do you want to
   report on another plant?": **Yes** shows the list again without the plants
   already done; **No**, or no plants left, closes the round. Plants not
   picked are marked `skipped` and left off Felix's list.
4. Flags raised while a round is open join it: a plant already on the list
   gets another questionnaire, the plant being answered gets it next, and a new
   plant is added to the end of the list. There is no second alert.
5. A farmer silent for 24 hours (about 20 on WhatsApp, see below) gets one
   reminder, showing the screen they were on. 24 hours after that the round's
   unanswered flags show as `no_response`, so a silent farm doesn't look
   healthy. A late reply still counts. A black rot questionnaire that comes
   back clear is sent again 7 days later, straight to the cabbage questions.

A spell that gets worse while its questionnaire is still open doesn't restart
it. The farmer gets a nudge to finish, and the new flag is stored as `merged`.

## WhatsApp

Setup, step by step: [docs/whatsapp-setup.md](docs/whatsapp-setup.md).

- Questions arrive with **Yes/No buttons**; the crop and progress ("Your maize
  · 3 of 8") are the header. Typed `1`, `2`, `yes`, `inde` still work.
- "Which plant?" arrives as buttons for up to three plants, and as a list
  (**Choose / Sankhani**) for four.
- A phone that isn't registered can text `join` when `WHATSAPP_OPEN_JOIN` is
  `true`. It is registered near Kasungu under its WhatsApp profile name.
- A greeting (`hi`, `moni`), a voice note or photo, or a template's **Start**
  button shows the current question again rather than counting as a wrong
  answer.
- Each button carries its screen (`s3:1`, `pick:2`, `more:1`), so a tap on an
  earlier screen's button isn't taken as the answer to the current one; the
  farmer is shown the current screen instead.
- Two replies arriving together (two quick taps are two webhook calls) can't
  overwrite each other: a round only saves if nobody saved it since it was
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
| `WHATSAPP_OPEN_JOIN` | | `true` to let phones join by texting `join` |
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
| `POST /farmers` | Register one: `name`, `phone`, `latitude`, `longitude`, and optionally `farm_name`, `lang` (`en`/`ny`) and `channel` (`whatsapp`, the default, or `sim`). A Malawi number starting 0 becomes +265. |
| `GET /farmers/:id` | A farmer, with their flags, sessions and reports |
| `GET /farmers/:id/messages` | Everything sent to and from them |
| `GET /flags` | Every flag, newest first, with its session and report |
| `POST /flags` | Raise one by hand: `farmer_id`, `disease`. It joins the farmer's open round, or opens one. |
| `POST /checks/run` | Run the forecast checks now, instead of waiting for the cron |
| `POST /demo/scenario` | Put a made-up `"wet"` or `"dry"` spell through the same rules, for every farmer or one `farmer_id`. Wet puts all four crops at risk; dry clears them, so the next wet spell alerts again. Flags raised this way are marked `source: "scenario"`. |
| `POST /inbound` | A farmer's message: `phone`, `text`, and for a button tap its `screen`. Returns the replies sent back. Used by the simulator; WhatsApp feeds the same handler. |
| `POST /sweep` | Run reminders, no-response marks and re-asks now |
| `GET /felix/priority` | Felix's list: one line per flagged farm, most urgent first, in the document's format (`text`) and as fields. `?days=` sets the window (1-90, default 14). |
| `GET /felix/summary` | Totals for the same window: farms flagged, response rate, outcomes, wrong-flag rate, flags by disease, and what the answers point to |
| `POST /demo/reset` | Delete every flag, session, track and message. Needs `{"confirm": "reset"}`. |
| `GET /demo`, `/dashboard`, `/sim`, `/officer` | The demo pages. They hold no data, so they need no token to load. |
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
under `also`. Plants the farmer chose not to report on are left off.

## Demo farmers

`migrations/0002_seed.sql` adds the eight Felix app farms, at the same points.
The names are invented. Each is checked for all four crops (`0006_rounds.sql`
dropped the single crop per farmer). Their phone numbers start `+265 0`,
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
| `src/pages.ts` | The demo pages: farmer's phone, Felix's phone, dashboard and `/demo` |
| `src/checks.ts` | Forecast checks through the weather API, and the demo scenario |
| `src/trigger.ts` | When a status change alerts |
| `src/conversation.ts` | Alerts, rounds (pick a plant, answer, another?), replies, reminders and re-asks |
| `src/engine.ts` | One questionnaire, one answer at a time |
| `src/questionnaires.ts` | The six questionnaires and their rules |
| `src/scoring.ts` | Answers to an outcome for Felix |
| `src/messages.ts` | Alert, reminder, "which plant?", "another plant?" and other farmer-facing text |
| `src/outbox.ts` | Logs and delivers outgoing messages |
| `src/whatsapp.ts` | WhatsApp webhook, delivery, joining and the template fallback |
| `src/phone.ts` | Phone number normalising |
| `src/store.ts` | D1 reads and writes |
| `migrations/` | Schema, demo farmers, WhatsApp delivery status, session versions, question screens, rounds |
| `docs/whatsapp-setup.md` | Setting up Meta's WhatsApp test number |

`src/checks.ts` imports the decision tree from `../api/src/assess.ts`, so the
scenario uses exactly the weather API's rules.
