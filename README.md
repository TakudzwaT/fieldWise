# FieldWise: catch maize blight before it costs a harvest

**One field officer. 3,000 farms. FieldWise tells him which ones to visit first, before he can see the disease.**

## The problem

Felix is an extension officer in Kasungu, Malawi. Across Malawi there is about [one extension worker per 2,000 farmers](https://cessa.agra.org/wp-content/uploads/2023/09/MALAWI-FAP-COUNTRY-PROFILE-2022.pdf). Kasungu is worse, with [83 officers for 300,000 farmers](https://mwnation.com/56-lead-farmers-in-kasungu-get-bicycles/), so each one covers about 3,000. Grey leaf spot and northern leaf blight start growing days before a leaf shows a mark. Field trials show they cut maize yield by [at least 13%, and by up to 60%](https://researchspace.ukzn.ac.za/handle/10413/11758). Maize is the staple food here. A farm that never reports a problem may simply be a farm nobody has checked.

## What FieldWise does

1. **The prioritisation engine decides who needs Felix first.** It runs on his phone, offline. It starts from the weather: each farm's 7-day forecast is checked for the conditions grey leaf spot needs to spread, which are long wet-leaf hours, rain and warm days. These are the same signals [published grey leaf spot models](https://dr.lib.iastate.edu/handle/20.500.12876/68099) use. Every farm gets a risk level of Low, Medium or High before any symptom shows. The engine then sends a check-in to each High-risk farm (step 2) and reranks the farm from the answers (step 3).
2. **Ask the farmer.** Every High-risk farm gets a USSD check-in. That is numbered yes/no screens on any basic phone (1 = yes, 2 = no), with no smartphone and no data needed. No screen names a disease.
3. **Re-sort the plan.** The answers rank Felix's day: urgent > confirmed > call > early signs > clear. A "wrong flag" (streak virus) jumps straight to urgent.
4. **Felix decides.** He sees why each farm is ranked where it is and can change the order. FieldWise supports his judgement and never replaces it.

## Impact per farm caught early (modelled; every input is sourced)

| Input | Value |
|---|---|
| Typical Malawian smallholding | [0.7 ha ≈ 1.7 acres](https://ccardesa.org/malawi) (60% of farmers have under 1 ha) |
| Smallholder maize yield | [~2 t/ha (range 1.5–2.6)](https://simlesa.cimmyt.org/?p=306) → **1,400 kg per farm** |
| Loss prevented if blight is caught early (assumed: the conservative trial figure) | 13% → **≈ 180 kg of maize per farm** |
| Maize price ([ADMARC](https://mwnation.com/consumers-panic-as-maize-price-hits-k65-000-per-bag/)) | K790/kg → **≈ K144,000 ≈ $83 per farm** ([rate](https://wage.is/malawi/)) |
| Food value | 180 kg feeds a family of five for **≈ 3 months** (at [140 kg/person/year](https://www.fao.org/4/x4083e/ctry/AF991226.htm)) |
| Officer pay | [$113–258 per month](https://www.paylab.com/mw/salaryinfo/agriculture-food-industry/livestock-specialist?lang=en) → $1,360–3,100 per year |

**Break-even:** catching blight early on **17–38 farms** pays a year of Felix's salary. That is **about 1% of his 3,000 farms.** The app tracks the result in its lead Insights number, **"Problems caught early"**.

## Next: a Kasungu field pilot, measured for one season

| We measure | Why |
|---|---|
| Farmers each officer reaches | Coverage |
| Time from farmer report to officer response | Speed |
| Share of alerts that lead to a confirmed problem | Accuracy of the flags |
| Officer hours spent on visits | Cost |
| Maize yield per farm compared with a comparison group | Food security |

Each confirmed or ruled-out check-in becomes a labelled example. The pilot uses them to tune the weather thresholds to [published grey leaf spot models](https://www.apsnet.org/publications/plantdisease/2002/October/Pages/86_10_1127.aspx) and fit them to Kasungu, so the risk model improves with every answer.

## How it scores against the judging criteria

| Criterion | Evidence | Principles |
|---|---|---|
| Topic | Targets one hunger driver, maize leaf blight in a maize-staple district; impact is measured in kg and months of food | P9 |
| Innovation | Weather-driven disease risk sets off automatic farmer check-ins, and the check-ins re-rank a human officer's plan | P6 |
| Feasibility | Risk engine runs on the phone, forecast and map are bundled offline, farmers need only a basic phone | P2, P4, P5 |
| Deployability | Consent switch turns check-ins on or off, farmer data stays on the device, and the pilot metrics above are already chosen | P3, P7, P8, P9 |
| Tech | Flutter app, pure-Dart engine, `flutter test test/felix`: **15/15 passing** | |
| Pitch | Live loop: start → check-in sent → farmer answers → farm jumps to the top of the plan | |

## Repo

```
apps/mobile/                              Flutter app (Felix's experience)
apps/mobile/lib/features/felix/maize_check.dart   prioritisation engine: risk score + questionnaire
src/fetch_kasungu_json.py                 Open-Meteo 7-day Kasungu forecast → src/data/
specs/SPEC-maize-check-loop.md            agreed behaviour
```

```sh
cd apps/mobile && flutter pub get --enforce-lockfile && flutter run
```

Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) (ODbL). Weather: Open-Meteo. The outcome rules are decision support, not a diagnosis.
