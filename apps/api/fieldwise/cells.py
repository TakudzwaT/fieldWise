"""Weather is stored per grid cell, not per farm.

Forecast models work on grids several kilometres wide, so farms close together
get identical numbers. Snapping coordinates to a 0.1° cell (about 11 km) means
one fetch covers every farm in that cell.
"""

CELL_SIZE = 0.1

# Malawi, with a small margin. Anyone can call the API, and every new cell adds
# to the hourly fetch, so cells outside this box are refused.
LAT_BOUNDS = (-17.2, -9.3)
LON_BOUNDS = (32.6, 36.0)
MAX_CELLS = 500

NAMED = {
    "kasungu": (-13.0333, 33.4833),
}


def snap(lat: float, lon: float) -> tuple[str, float, float]:
    """Return (cell_id, cell_lat, cell_lon) for the cell containing a point."""
    cell_lat = round(round(lat / CELL_SIZE) * CELL_SIZE, 1)
    cell_lon = round(round(lon / CELL_SIZE) * CELL_SIZE, 1)
    return f"{cell_lat:.1f}_{cell_lon:.1f}", cell_lat, cell_lon


def in_bounds(lat: float, lon: float) -> bool:
    return LAT_BOUNDS[0] <= lat <= LAT_BOUNDS[1] and LON_BOUNDS[0] <= lon <= LON_BOUNDS[1]
