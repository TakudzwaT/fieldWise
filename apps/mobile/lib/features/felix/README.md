# Felix field officer flow

The frontend keeps Farmable's Home/Farm/Insights/Profile shell, photo carousel,
cards, and action tiles. Home shows a short farm priority card; tap it for the
action, reason, success check, source details, and Felix's correction controls.

## In-app flow

1. Swipe Home's Farmable portrait carousel. Its order responds to mapped soil,
   three-day weather, farmer answers, and Felix's changes. Tap the bell to see
   in-app priority and check-in alerts.
2. Open Farms for farm markers and attention areas on a bundled offline map of
   Kasungu roads and waterways. Map data is © OpenStreetMap contributors (ODbL).
   Tap a marker or list item for farm detail.
3. Open Activity > Farmer check-in, choose a farm, and answer the short USSD-style
   numbered questions. The questions branch from the farm's current drainage,
   heat, or general crop flag. The final screen confirms that the response
   reached Felix's in-app queue and says whether to contact him.
4. Return to Home or the Plan tab to see the changed order. Open the farm and
   choose Change for a quick correction, or record a visit from Plan.

The bundled Kasungu forecast is a dated snapshot from
`TakudzwaT/fieldWise:src/data/kasungu_weather.json` (16 October 2026). The app
requests fresh farm-level weather directly from Open-Meteo and mapped clay from
SoilGrids. A soil-dependent flag is disabled until the soil request succeeds.
The named farms and their exact coordinates are scenario data, not records from
FieldWise. Reports, officer edits, and alerts are held in memory and reset on
restart. The USSD flow and notification center run only inside this app; they
do not send real USSD, messages, or device push notifications. Priority rules
are illustrative decision support, not a diagnosis.
