# FieldWise logic layer

Sits between the weather API (`apps/api`) and the farmers. When the forecast
newly favours a crop disease, the farmer is alerted and answers a short yes/no
questionnaire. Their answers are scored into an outcome for Felix, the
extension officer.

> **Status:** step 1 of 5. The questionnaires, scoring and alert trigger are
> built and tested. Storage, channels (WhatsApp, web simulator), Felix's
> dashboard and deployment come next.

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
