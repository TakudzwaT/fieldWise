# FieldWise

Field officer decision support for Kasungu, Malawi. Felix, an extension
officer, can't visit every farm every week. FieldWise tells him which farms
to visit first, based on the weather forecast and on what the farmers
themselves report, and lets him answer them without a visit.

## How the parts fit

```
Open-Meteo + SoilGrids
        │  hourly
        ▼
apps/api      Weather API (Cloudflare Worker + D1)
              /assess: which crop diseases the forecast favours, per farm
        │  hourly cron (15 past)
        ▼
apps/logic    Logic layer (Cloudflare Worker + D1)
              flags → alerts → farmers' answers → scored priority list
        │                         │
        │ SMS + USSD (9 in 10)    │ officer token
        │ WhatsApp (1 in 10)      ▼
        ▼                   apps/mobile   Felix's tablet app (Flutter)
     Farmers                              priority list, map, replies, call-backs
```

1. **Weather** (`apps/api`): the hourly forecast for each farm, run through a
   decision tree for each crop disease (flag, watch or clear). Live at
   https://fieldwise-api.takudzwamhizha132.workers.dev, docs at `/docs`.
2. **Farmers** (`apps/logic`): when a farm moves into "flag", the farmer is
   alerted and answers a short yes/no questionnaire about the plant at risk.
   Keypad phones get an SMS and answer by USSD (`*384*123#`); smartphones use
   WhatsApp. Farmers can also report a problem or ask Felix to call, from the
   USSD menu.
3. **Felix** (`apps/logic` + `apps/mobile`): the answers are scored into a
   priority list (Go now, Go this week, No response, Re-check, ...). Felix
   sees it on his tablet, sends advice back by SMS or WhatsApp, and works
   through call-back requests.

The live demo (`/demo` on the logic Worker) shows a farmer's keypad phone,
Felix's phone and his dashboard side by side.

| Folder | What | Docs |
|---|---|---|
| [`apps/api`](apps/api/) | Weather and crop-disease risk API | [README](apps/api/README.md) |
| [`apps/logic`](apps/logic/) | Alerts, questionnaires, USSD, SMS, WhatsApp, Felix's list | [README](apps/logic/README.md), [USSD setup](apps/logic/docs/ussd-setup.md), [WhatsApp setup](apps/logic/docs/whatsapp-setup.md) |
| [`apps/mobile`](apps/mobile/) | Felix's Flutter app | [README](apps/mobile/README.md), [Felix flow](apps/mobile/lib/features/felix/README.md) |
| [`src`](src/) | The original Kasungu weather fetch script and its dated JSON | |

## Run the mobile app

Install Flutter 3.47.1 or a compatible SDK, then:

```sh
cd apps/mobile
flutter pub get --enforce-lockfile
flutter run
```

It opens on offline demo data. Sign in from Profile with an officer access
code to use the live logic layer; see the
[Felix flow](apps/mobile/lib/features/felix/README.md).

## Run the logic layer and demo

```sh
cd apps/logic
npm install
npm run db:migrate:local
npm run dev
```

Then open http://localhost:8787/demo. See the
[logic README](apps/logic/README.md) for the admin token and tests.
