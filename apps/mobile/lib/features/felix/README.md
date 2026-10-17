# Felix field officer flow

The frontend keeps Farmable's Home/Farm/Insights/Profile shell, wide photo hero,
portrait carousel, cards, and action tiles. Home opens with the highest-priority
farm in the original wide hero, followed by "Your farms" and four next-priority
portrait cards with neighboring cards visible. Tap a farm for its action, reason,
success check, source details, and Felix's correction controls.

## In-app flow

1. Review the lead farm, then swipe Home's Farmable portrait carousel. Its order
   responds to mapped soil, three-day weather, farmer answers, and Felix's
   changes. Today's plan and a map preview sit below. Tap the bell for in-app
   priority and check-in alerts.
2. Open Farms for a full-page bundled offline map of Kasungu roads and waterways.
   Priority areas and farm pins sit on top. Tap a pin to preview the farm action,
   or open the searchable farm list. Map data is © OpenStreetMap contributors
   (ODbL).
3. Open Activity > Farmer check-in, choose a farm, and answer the short USSD-style
   numbered questions. The questions branch from the farm's current drainage,
   heat, or general crop flag. The final screen confirms that the response
   reached Felix's in-app queue and says whether to contact him.
4. Return to Home or the Plan tab to see the changed order. Open the farm and
   choose Change for a quick correction, or record a visit from Plan.

## Live mode: signed in to FieldWise

Profile > **Sign in** takes Felix's officer access code (`fw_...`, made by the
FieldWise admin with `POST /officers/OFF01/token` on the logic layer). The
app then reads his farmers, priority list and call-back requests from the
logic layer (`apps/logic`) every 30 seconds, instead of using the local rules:

- The order is FieldWise's: forecast flags scored by the farmers' own answers
  (Visit today, Visit this week, No reply: call, Re-check, Waiting for
  farmer). Felix's **Change** corrections still apply on top.
- A farm shows what the farmer answered and what the answers point to.
- **Message farmer** sends a ready-made reply or Felix's own words, by SMS to
  keypad phones or WhatsApp to smartphones. **Call** opens the dialler.
- **Call back** on Home lists farmers who asked Felix to call from the USSD
  menu; **Done** clears one.
- The in-app check-in is hidden: farmers answer on their own phones.

The server address defaults to the deployed logic Worker. For a local one:

```sh
flutter run --dart-define=FIELDWISE_URL=http://10.0.2.2:8789
```

(`10.0.2.2` is the host machine from an Android emulator; use
`http://localhost:8789` on the iOS simulator.) **Sign out** goes back to the
offline demo data. The code is kept in the device's secure storage.

## Offline demo data

The bundled Kasungu forecast is a dated snapshot from
`TakudzwaT/fieldWise:src/data/kasungu_weather.json` (16 October 2026). The app
requests fresh farm-level weather directly from Open-Meteo and mapped clay from
SoilGrids. A soil-dependent flag is disabled until the soil request succeeds.
The named farms and their exact coordinates are scenario data, not records from
FieldWise. Reports, officer edits, and alerts are held in memory and reset on
restart. The USSD flow and notification center run only inside this app; they
do not send real USSD, messages, or device push notifications. Priority rules
are illustrative decision support, not a diagnosis.
