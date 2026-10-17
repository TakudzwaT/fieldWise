"""Turn Open-Meteo's hourly forecast into daily summaries and a disease risk score.

The risk rule is the one in Lindokuhle's plant disease report (commit b9e6acf).
Each day scores one point for each of:
  - at least 6 hours with relative humidity above 90%
  - any rain
  - a mean temperature between 18 and 27 °C
The 7-day total gives the risk level. It covers maize and groundnut leaf
diseases; cassava mosaic needs whitefly sightings, which weather can't supply.
"""

from collections import defaultdict

from .openmeteo import HOURLY

HUMID_RH = 90
HUMID_HOURS = 6
TEMP_RANGE = (18, 27)
WINDOW = 7
LEVELS = [(13, "high"), (8, "medium"), (0, "low")]


def hourly_rows(forecast: dict) -> list[dict]:
    hourly = forecast["hourly"]
    return [
        {"time": time, **{name: hourly[name][i] for name in HOURLY}}
        for i, time in enumerate(hourly["time"])
    ]


def risk_level(score: int) -> str:
    return next(level for threshold, level in LEVELS if score >= threshold)


def daily_rows(hours: list[dict]) -> list[dict]:
    """One row per local day. risk_7d is only set once a full 7 days are available."""
    by_day = defaultdict(list)
    for hour in hours:
        by_day[hour["time"][:10]].append(hour)

    days = []
    for date in sorted(by_day):
        rows = by_day[date]
        # A partial day would understate rain and humid hours.
        if len(rows) < 24:
            continue
        temp_mean, temp_min, temp_max = _stats(rows, "temperature_2m")
        soil_mean, soil_min, soil_max = _stats(rows, "soil_temperature_6cm")
        humidity = [r["relative_humidity_2m"] for r in rows if r["relative_humidity_2m"] is not None]
        precipitation = _sum(rows, "precipitation")
        humid_hours = sum(1 for rh in humidity if rh > HUMID_RH)

        score = (
            int(humid_hours >= HUMID_HOURS)
            + int(precipitation is not None and precipitation > 0)
            + int(temp_mean is not None and TEMP_RANGE[0] <= temp_mean <= TEMP_RANGE[1])
        )
        days.append({
            "date": date,
            "precipitation_sum": precipitation,
            "rain_sum": _sum(rows, "rain"),
            "relative_humidity_2m_mean": _round(sum(humidity) / len(humidity)) if humidity else None,
            "humid_hours": humid_hours,
            "leaf_wetness_probability_mean": _stats(rows, "leaf_wetness_probability")[0],
            "temperature_2m_mean": temp_mean,
            "temperature_2m_min": temp_min,
            "temperature_2m_max": temp_max,
            "soil_temperature_6cm_mean": soil_mean,
            "soil_temperature_6cm_min": soil_min,
            "soil_temperature_6cm_max": soil_max,
            "disease_score": score,
        })

    for i in range(WINDOW - 1, len(days)):
        total = sum(day["disease_score"] for day in days[i - WINDOW + 1 : i + 1])
        days[i]["risk_7d"] = total
        days[i]["risk_level"] = risk_level(total)
    return days


def _values(rows, name):
    return [r[name] for r in rows if r[name] is not None]


def _stats(rows, name):
    values = _values(rows, name)
    if not values:
        return None, None, None
    return _round(sum(values) / len(values)), _round(min(values)), _round(max(values))


def _sum(rows, name):
    values = _values(rows, name)
    return _round(sum(values)) if values else None


def _round(value):
    return round(value, 2)
