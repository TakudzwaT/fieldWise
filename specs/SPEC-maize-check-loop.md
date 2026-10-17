# Feature Spec: Maize check-in loop

## Problem Statement
Felix cannot visit every farm around Kasungu. Weather sets up maize leaf blights
(grey leaf spot, northern leaf blight) days before he could see them, and a farm
that never reports is not a healthy farm. FieldWise should turn the forecast into
a disease-risk flag, ask the farmer automatically by USSD when the flag is high,
and re-sort Felix's plan from the answers, so his visits go where a problem is
confirmed early.

## Success Criteria
- [ ] Given 7 forecast days, when each day scores +1 for >=6 h above 90 % humidity,
      +1 for rain, +1 for a 18–27 °C mean, then the farm's risk score is the sum (0–21).
- [ ] Given a score, then 0–7 is Low, 8–12 Medium, 13–21 High.
- [ ] Given consent is on, when the app starts, then every High-risk farm without an
      answer is marked "Check-in sent" and an alert names it.
- [ ] Given consent is off, then no check-in is sent and High-risk farms show
      "Call farmer".
- [ ] Given a farmer opens the check-in, then the first screen asks the crop
      (1 Maize, 2 Beans, 3 Tomato, 4 Cabbage).
- [ ] Given the crop is not maize, then the session thanks the farmer and the farm
      is marked "Call today".
- [ ] Given the crop is maize, then the farmer answers 4 questions, each followed by
      one follow-up (8 yes/no screens, 1 = yes, 2 = no); no screen names a disease.
- [ ] Given Q4 (stripes on stunted plants) is yes, then the outcome is "Wrong flag:
      streak virus", urgent, regardless of other answers.
- [ ] Given long marks (Q1 yes) and a shape match (Q2 rectangles + grey/tan centre,
      or Q2 no + cigar shapes), then the outcome is Confirmed (grey leaf spot or
      northern leaf blight); if also worse (Q3 yes) and above the cob, Confirmed urgent.
- [ ] Given no disease is identified but a warning sign is (unmatched marks,
      tip yellowing, or abnormal height), then the outcome is Early signs; otherwise Clear.
- [ ] Given an outcome, then the farm detail shows the flag, what the answers say and
      the answers, and the plan re-sorts: urgent > confirmed > call > early signs > clear.
- [ ] Given outcomes exist, then Insights leads with "Problems caught early"
      (Confirmed + Early signs) and shows check-ins sent / answered / awaiting.
- [ ] Given Profile, then a consent switch turns automatic USSD check-ins on and off.

## Scope
### In Scope
- Pure risk engine and maize questionnaire (`maize_check.dart`), with unit tests.
- Seeded 7-day rainy-season forecast per farm, labelled "Open-Meteo forecast".
- Auto check-in dispatch, crop question, maize flow, outcome on farm detail and plan.
- Insights KPI and check-in counts; consent switch on Profile.
### Out of Scope
- Bean, tomato and cabbage questionnaires (crop answered, farm marked for a call).
- Disease-cluster map layer and a new map for Insights.
- Live Open-Meteo/SoilGrids calls in the engine (removed so the demo is stable).
- Real USSD delivery, persistence, Chichewa.

## Data / API Contract
```dart
class DayWeather { double rainMm; int humidHours; double meanTempC; }
int leafDiseaseScore(List<DayWeather> week);          // 0..21
enum RiskLevel { low, medium, high }
RiskLevel riskLevelFor(int score);
enum CheckOutcome { confirmedUrgent, wrongFlag, confirmed, earlySigns, clear, otherCrop }
class MaizeCheck { String get question; void answer(bool yes); bool get isDone;
                   CheckOutcome get outcome; String get finding; List<String> get transcript; }
```

## Tech Stack
- Language: Dart
- Framework: Flutter (single-file Felix feature, Farmable UI kit)
- Test runner: flutter_test

## Open Questions
- Outcome rules are an interpretation of the USSD Questionnaire doc; an agronomist
  should confirm them (especially what makes "Early signs").
- Questions are English drafts and may exceed the operator's USSD screen limit.
- The forecast is seeded; production pulls the same 7-day series from Open-Meteo
  (hourly humidity is needed for the humid-hours count).
- The jury may ask what is live; answer plainly that farm records are seeded.

## Implementation Plan
1. `test/felix/maize_check_test.dart` — failing tests for engine and questionnaire.
2. `lib/features/felix/maize_check.dart` — engine, risk level, questionnaire, outcomes.
3. `lib/features/felix/felix_app.dart` — farm model uses the week + outcome; seeded
   forecast; auto dispatch with consent; crop-first USSD page; farm detail; plan
   order; Insights KPI; consent switch; remove live weather/soil overwrite.
4. `test/felix/felix_app_smoke_test.dart` — replace the stale test with the loop:
   start → check-in sent → answer maize → farm moves to the top of the plan.
5. Release APK build and emulator run.
