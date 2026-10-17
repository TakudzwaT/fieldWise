import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

URL = "https://api.open-meteo.com/v1/forecast"
TIMEZONE = "Africa/Blantyre"
HOURLY = [
    "temperature_2m",
    "relative_humidity_2m",
    "precipitation",
    "rain",
    "soil_temperature_6cm",
    "leaf_wetness_probability",
]
# Seven days back is what the 7-day disease score needs for today; seven ahead
# gives the outlook.
PAST_DAYS = 7
FORECAST_DAYS = 7
# Open-Meteo takes many coordinates in one call, so one request covers a batch.
BATCH_SIZE = 50

_session = requests.Session()
_session.mount(
    "https://",
    HTTPAdapter(max_retries=Retry(total=3, backoff_factor=0.5, status_forcelist=[429, 500, 502, 503, 504])),
)


def fetch(points: list[tuple[float, float]]) -> list[dict]:
    """Fetch hourly forecasts for up to BATCH_SIZE points, in the same order."""
    if not 0 < len(points) <= BATCH_SIZE:
        raise ValueError(f"fetch takes 1 to {BATCH_SIZE} points, got {len(points)}")
    response = _session.get(
        URL,
        params={
            "latitude": ",".join(str(lat) for lat, _ in points),
            "longitude": ",".join(str(lon) for _, lon in points),
            "hourly": ",".join(HOURLY),
            "timezone": TIMEZONE,
            "past_days": PAST_DAYS,
            "forecast_days": FORECAST_DAYS,
        },
        timeout=30,
    )
    response.raise_for_status()
    data = response.json()
    return data if isinstance(data, list) else [data]
