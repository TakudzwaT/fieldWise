// Weather is stored per grid cell, not per farm.
//
// Forecast models work on grids several kilometres wide, so farms close
// together get identical numbers. Snapping coordinates to a 0.1° cell (about
// 11 km) means one fetch covers every farm in that cell.

export const CELL_SIZE = 0.1;

// Malawi, with a small margin. Anyone can call the API, and every new cell adds
// to the hourly fetch, so cells outside this box are refused.
const LAT_BOUNDS = [-17.2, -9.3];
const LON_BOUNDS = [32.6, 36.0];

// The hourly refresh has to fit in the free plan's CPU time per run and its
// daily database writes. See the README before raising this.
export const MAX_CELLS = 50;

export const NAMED: Record<string, [number, number]> = {
  kasungu: [-13.0333, 33.4833],
};

export interface Cell {
  id: string;
  latitude: number;
  longitude: number;
  name?: string;
}

export function snap(lat: number, lon: number): Cell {
  const cellLat = Math.round(lat / CELL_SIZE) / 10;
  const cellLon = Math.round(lon / CELL_SIZE) / 10;
  return { id: `${cellLat.toFixed(1)}_${cellLon.toFixed(1)}`, latitude: cellLat, longitude: cellLon };
}

export function inBounds(lat: number, lon: number): boolean {
  return lat >= LAT_BOUNDS[0] && lat <= LAT_BOUNDS[1] && lon >= LON_BOUNDS[0] && lon <= LON_BOUNDS[1];
}

export function namedCells(): Cell[] {
  return Object.entries(NAMED).map(([name, [lat, lon]]) => ({ ...snap(lat, lon), name }));
}
