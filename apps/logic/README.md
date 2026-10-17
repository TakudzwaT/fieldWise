# FieldWise logic layer

Sits between the weather API (`apps/api`) and the farmers. When the forecast
newly favours a crop disease, the farmer is alerted and answers a short yes/no
questionnaire. Their answers are scored into an outcome for Felix, the
extension officer.

> **Status:** step 2 of 5. Questionnaires, scoring, the alert trigger, the D1
> database and the HTTP routes are built and tested, and run locally. The web
> simulator, Felix's dashboard, WhatsApp and deployment come next.

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
4. A farmer silent for 24 hours gets one reminder. 24 hours after that the flag
   shows as `no_response`, so a silent farm doesn't look healthy. A late reply
   still counts. A black rot questionnaire that comes back clear is sent again
   7 days later.

A spell that gets worse while its questionnaire is still open doesn't restart
it. The farmer gets a nudge to finish, and the new flag is stored as `merged`.

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

## Demo farmers

`migrations/0002_seed.sql` adds the eight Felix app farms, at the same points.
The names are invented, and the crops are changed to ones the questionnaires
cover (tomato, maize, beans, cabbage). Their phone numbers start `+265 0`,
which no real number does, and their channel is `sim`, so nothing sent to
them leaves FieldWise.

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
| `src/checks.ts` | Forecast checks through the weather API, and the demo scenario |
| `src/trigger.ts` | When a status change alerts |
| `src/conversation.ts` | Alerts, replies, queueing, reminders and re-asks |
| `src/engine.ts` | One questionnaire, one answer at a time |
| `src/questionnaires.ts` | The six questionnaires and their rules |
| `src/scoring.ts` | Answers to an outcome for Felix |
| `src/messages.ts` | Alert, reminder and other farmer-facing text |
| `src/outbox.ts` | Logs and delivers outgoing messages |
| `src/store.ts` | D1 reads and writes |
| `migrations/` | Schema and demo farmers |

`src/checks.ts` imports the decision tree from `../api/src/assess.ts`, so the
scenario uses exactly the weather API's rules.
