# Crop Disease Early Warning for Kasungu Farmers

## Goal

Warn subsistence farmers in Kasungu when weather favors crop diseases, so they can scout, spray, or act early.

## Crops and Diseases

| Crop | Disease | Favored by |
|---|---|---|
| Maize | Gray leaf spot, leaf blight | Long wet spells, humid nights, warm days |
| Groundnut | Leaf spot | Frequent rain, humid weather |
| Cassava | Mosaic disease | Hot, dry spells (whitefly spreads it) |

## Weather Predictors

Use these three to start:

1. **Rain:** Total rain over the last 7 days. Heavy or frequent rain spreads disease.
2. **Wet leaves:** Number of hours per day with humidity above 90%. Long wet periods let infection take hold.
3. **Temperature:** Daily average. Maize and groundnut diseases spread most between about 18 and 27 °C.

## Simple Risk Rule

Each day, score the weather:

- +1 if humidity is above 90% for at least 6 hours
- +1 if it rained that day
- +1 if the average temperature is between 18 and 27 °C

Add the scores for the last 7 days:

- **0 to 7 points: Low risk.** Keep normal monitoring.
- **8 to 12 points: Medium risk.** Check fields weekly and remove infected leaves.
- **13 to 21 points: High risk.** Check fields every few days and consider treatment, following local extension advice.

For cassava, use the reverse signal: a hot, dry spell with whitefly sightings raises mosaic risk.

## Data Needed

- **Weather:** Open-Meteo, already used in the Kasungu API (rain, humidity, temperature).
- **Disease checks:** Local extension officers can confirm whether the rules match what farmers see in the field.

## Next Steps

1. Add daily rain totals and humidity-hours to the API.
2. Run the risk rule for Kasungu each day.
3. Test the alerts with a few extension officers and adjust the thresholds based on their feedback.
