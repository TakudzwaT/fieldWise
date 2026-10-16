import csv
import os
from datetime import datetime
from zoneinfo import ZoneInfo

import httpx
from fastapi import FastAPI, HTTPException

OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"
TZ = "Africa/Blantyre"
LAT, LON = -13.0167, 33.4833
SALINITY_CSV = os.getenv("SALINITY_CSV", "data/salinity.csv")

app = FastAPI(title="Kasungu Soil Metrics")


def latest_salinity():
    if not os.path.exists(SALINITY_CSV):
        return None
    with open(SALINITY_CSV, newline="") as f:
        rows = list(csv.DictReader(f))
    if not rows:
        return None
    last = rows[-1]
    return {"date": last["date"], "ec_ds_m": float(last["ec_ds_m"])}


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/soil")
async def soil():
    params = {
        "latitude": LAT,
        "longitude": LON,
        "hourly": ",".join([
            "temperature_2m",
            "relative_humidity_2m",
            "soil_temperature_0cm",
            "soil_temperature_6cm",
            "soil_moisture_0_to_1cm",
        ]),
        "forecast_days": 1,
        "timezone": TZ,
    }
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(OPEN_METEO_URL, params=params)
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail="Upstream weather service failed")

    hourly = resp.json()["hourly"]
    now = datetime.now(ZoneInfo(TZ)).replace(tzinfo=None)
    times = [datetime.fromisoformat(t) for t in hourly["time"]]
    idx = max((i for i, t in enumerate(times) if t <= now), default=0)

    return {
        "location": {"name": "Kasungu, Malawi", "latitude": LAT, "longitude": LON},
        "time": hourly["time"][idx],
        "air_temp_c": hourly["temperature_2m"][idx],
        "relative_humidity_pct": hourly["relative_humidity_2m"][idx],
        "soil_temp_0cm_c": hourly["soil_temperature_0cm"][idx],
        "soil_temp_6cm_c": hourly["soil_temperature_6cm"][idx],
        "soil_moisture_0_1cm_m3m3": hourly["soil_moisture_0_to_1cm"][idx],
        "salinity": latest_salinity(),
    }
