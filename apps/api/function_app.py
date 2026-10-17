"""FieldWise weather API.

An hourly timer refreshes every tracked cell from Open-Meteo and prunes old
rows. The HTTP routes only read from storage, so traffic never reaches
Open-Meteo, except the first request for a new cell, which fetches it once.
"""

import json
import logging
import os
from datetime import datetime, timedelta, timezone

import azure.functions as func

from fieldwise import cells, openmeteo, summarize
from fieldwise.store import Store

app = func.FunctionApp(http_auth_level=func.AuthLevel.ANONYMOUS)

# Malawi is UTC+2 all year, so a fixed offset avoids depending on tzdata.
MALAWI = timezone(timedelta(hours=2))
HOURLY_KEEP_DAYS = 90
DAILY_KEEP_DAYS = 730
# Data changes hourly, so callers and caches may reuse a response this long.
CACHE_SECONDS = 300

_store = None


def store() -> Store:
    global _store
    if _store is None:
        _store = Store(os.environ.get("FIELDWISE_STORAGE") or os.environ["AzureWebJobsStorage"])
    return _store


def now_local() -> datetime:
    return datetime.now(MALAWI)


def refresh(targets: list[dict]):
    """Fetch and save each target ({cell, latitude, longitude, name?})."""
    for i in range(0, len(targets), openmeteo.BATCH_SIZE):
        batch = targets[i : i + openmeteo.BATCH_SIZE]
        try:
            forecasts = openmeteo.fetch([(t["latitude"], t["longitude"]) for t in batch])
        except Exception:
            # One failed batch shouldn't stop the rest; the next hour retries it.
            logging.exception("Open-Meteo fetch failed for %d cells", len(batch))
            continue
        fetched_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
        for target, forecast in zip(batch, forecasts):
            hours = summarize.hourly_rows(forecast)
            store().save_rows(target["cell"], hours, summarize.daily_rows(hours))
            store().save_cell(target["cell"], target["latitude"], target["longitude"], fetched_at, target.get("name"))


def named_cells() -> list[dict]:
    targets = []
    for name, (lat, lon) in cells.NAMED.items():
        cell_id, cell_lat, cell_lon = cells.snap(lat, lon)
        targets.append({"cell": cell_id, "latitude": cell_lat, "longitude": cell_lon, "name": name})
    return targets


@app.timer_trigger(schedule="0 5 * * * *", arg_name="timer", run_on_startup=False, use_monitor=True)
def refresh_weather(timer: func.TimerRequest):
    tracked = {c["cell"]: c for c in store().list_cells()}
    for target in named_cells():
        tracked.setdefault(target["cell"], target)
    refresh(list(tracked.values()))

    now = now_local()
    hourly_before = (now - timedelta(days=HOURLY_KEEP_DAYS)).strftime("%Y-%m-%dT%H:%M")
    daily_before = (now - timedelta(days=DAILY_KEEP_DAYS)).strftime("%Y-%m-%d")
    pruned = sum(store().prune(cell_id, hourly_before, daily_before) for cell_id in tracked)
    logging.info("Refreshed %d cells, pruned %d old rows", len(tracked), pruned)


@app.route(route="health/live", methods=["GET"])
def health_live(req: func.HttpRequest) -> func.HttpResponse:
    return _json({"status": "ok"}, cache=False)


@app.route(route="locations", methods=["GET"])
def locations(req: func.HttpRequest) -> func.HttpResponse:
    return _json({"named": sorted(cells.NAMED), "cells": store().list_cells()})


@app.route(route="weather/daily", methods=["GET"])
def weather_daily(req: func.HttpRequest) -> func.HttpResponse:
    cell, error = _resolve(req)
    if error:
        return error
    days, error = _int_param(req, "days", 7, 1, 7)
    past_days, error2 = _int_param(req, "past_days", 0, 0, DAILY_KEEP_DAYS)
    if error or error2:
        return error or error2
    today = now_local().date()
    start = (today - timedelta(days=past_days)).isoformat()
    end = (today + timedelta(days=days)).isoformat()
    return _json({**_header(cell), "daily": store().read_daily(cell["cell"], start, end)})


@app.route(route="weather/hourly", methods=["GET"])
def weather_hourly(req: func.HttpRequest) -> func.HttpResponse:
    cell, error = _resolve(req)
    if error:
        return error
    hours, error = _int_param(req, "hours", 48, 1, 24 * openmeteo.FORECAST_DAYS)
    past_hours, error2 = _int_param(req, "past_hours", 0, 0, 24 * HOURLY_KEEP_DAYS)
    if error or error2:
        return error or error2
    this_hour = now_local().replace(minute=0, second=0, microsecond=0)
    start = (this_hour - timedelta(hours=past_hours)).strftime("%Y-%m-%dT%H:%M")
    end = (this_hour + timedelta(hours=hours)).strftime("%Y-%m-%dT%H:%M")
    return _json({**_header(cell), "hourly": store().read_hourly(cell["cell"], start, end)})


@app.route(route="risk", methods=["GET"])
def risk(req: func.HttpRequest) -> func.HttpResponse:
    cell, error = _resolve(req)
    if error:
        return error
    today = now_local().date()
    days = store().read_daily(cell["cell"], today.isoformat(), (today + timedelta(days=7)).isoformat())
    outlook = [
        {"date": d["date"], "risk_7d": d["risk_7d"], "risk_level": d["risk_level"], "disease_score": d["disease_score"]}
        for d in days
        if "risk_7d" in d
    ]
    return _json({
        **_header(cell),
        "crops": ["maize", "groundnut"],
        "rule": (
            "Each day scores 1 point each for 6+ hours above 90% humidity, any rain, "
            "and a mean temperature of 18-27 °C. The 7-day total gives the level: "
            "0-7 low, 8-12 medium, 13-21 high."
        ),
        "note": "Decision support from weather alone, not a diagnosis. Confirm with field checks.",
        "today": outlook[0] if outlook and outlook[0]["date"] == today.isoformat() else None,
        "outlook": outlook,
    })


def _resolve(req: func.HttpRequest):
    """Find the cell for ?location=name or ?lat=..&lon=.., fetching it if new."""
    name = req.params.get("location")
    lat, lon = req.params.get("lat"), req.params.get("lon")
    if name:
        if name not in cells.NAMED:
            return None, _error(404, f"Unknown location '{name}'. Known: {', '.join(sorted(cells.NAMED))}.")
        lat, lon = cells.NAMED[name]
    elif lat is not None and lon is not None:
        try:
            lat, lon = float(lat), float(lon)
        except ValueError:
            return None, _error(400, "lat and lon must be numbers.")
    else:
        return None, _error(400, "Pass lat and lon, or location.")

    cell_id, cell_lat, cell_lon = cells.snap(lat, lon)
    cell = store().get_cell(cell_id)
    if cell:
        return cell, None
    if not cells.in_bounds(lat, lon):
        return None, _error(400, "That point is outside the area FieldWise covers (Malawi).")
    if len(store().list_cells()) >= cells.MAX_CELLS:
        return None, _error(503, "FieldWise is tracking its maximum number of locations.")
    refresh([{"cell": cell_id, "latitude": cell_lat, "longitude": cell_lon, "name": name}])
    cell = store().get_cell(cell_id)
    if not cell:
        return None, _error(502, "Couldn't fetch weather for this location. Try again shortly.")
    return cell, None


def _header(cell: dict) -> dict:
    return {
        "location": {k: cell[k] for k in ("cell", "name", "latitude", "longitude") if k in cell},
        "timezone": openmeteo.TIMEZONE,
        "fetched_at": cell["fetched_at"],
        "source": "Open-Meteo (open-meteo.com), model data",
    }


def _int_param(req: func.HttpRequest, name: str, default: int, low: int, high: int):
    raw = req.params.get(name)
    if raw is None:
        return default, None
    try:
        value = int(raw)
    except ValueError:
        return None, _error(400, f"{name} must be a whole number.")
    if not low <= value <= high:
        return None, _error(400, f"{name} must be between {low} and {high}.")
    return value, None


def _json(body: dict, status: int = 200, cache: bool = True) -> func.HttpResponse:
    headers = {"Cache-Control": f"public, max-age={CACHE_SECONDS}" if cache else "no-store"}
    return func.HttpResponse(json.dumps(body), status_code=status, mimetype="application/json", headers=headers)


def _error(status: int, message: str) -> func.HttpResponse:
    return _json({"error": message}, status=status, cache=False)
