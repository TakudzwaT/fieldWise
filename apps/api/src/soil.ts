// Soil from ISRIC SoilGrids (https://soilgrids.org, CC BY 4.0): pH and texture
// for the top 30 cm at 250 m resolution. No free service gives drainage
// directly, so it is estimated from texture: clay holds water, sand drains it.

const URL = "https://rest.isric.org/soilgrids/v2.0/properties/query";
// Depth layers averaged into one topsoil value, weighted by thickness (cm).
const DEPTHS: Record<string, number> = { "0-5cm": 5, "5-15cm": 10, "15-30cm": 15 };
// SoilGrids is slow (often over 10 s) and sometimes down.
const TIMEOUT_MS = 25_000;
// Farm points are rounded to 0.01° (about 1 km), so nearby lookups share one fetch.
const POINT_SIZE = 0.01;

export type Drainage = "poor" | "moderate" | "good";

export interface Soil {
  ph: number;
  clay_pct: number;
  sand_pct: number;
  silt_pct: number;
  drainage: Drainage;
  drainage_basis: string;
}

export interface SoilPoint {
  id: string;
  latitude: number;
  longitude: number;
}

export function soilPoint(lat: number, lon: number): SoilPoint {
  const pLat = Math.round(lat / POINT_SIZE) / 100;
  const pLon = Math.round(lon / POINT_SIZE) / 100;
  return { id: `${pLat.toFixed(2)}_${pLon.toFixed(2)}`, latitude: pLat, longitude: pLon };
}

/**
 * Drainage class from topsoil clay and sand. A simplification of the USDA
 * hydrologic soil groups: heavy clay soils drain poorly, sandy soils well.
 */
export function drainageFromTexture(clayPct: number, sandPct: number): Drainage {
  if (clayPct >= 35) return "poor";
  if (clayPct >= 20 && sandPct < 50) return "moderate";
  return "good";
}

interface SoilGridsResponse {
  properties: {
    layers: {
      name: string;
      unit_measure: { d_factor: number };
      depths: { label: string; values: { mean: number | null } }[];
    }[];
  };
}

export async function fetchSoil(point: SoilPoint): Promise<Soil | null> {
  const params = new URLSearchParams({ lon: String(point.longitude), lat: String(point.latitude), value: "mean" });
  for (const property of ["phh2o", "clay", "sand", "silt"]) params.append("property", property);
  for (const depth of Object.keys(DEPTHS)) params.append("depth", depth);

  const response = await fetch(`${URL}?${params}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(`SoilGrids returned ${response.status}: ${await response.text()}`);
  const data = (await response.json()) as SoilGridsResponse;

  const values: Record<string, number> = {};
  for (const layer of data.properties.layers) {
    let total = 0;
    let weight = 0;
    for (const depth of layer.depths) {
      const thickness = DEPTHS[depth.label];
      if (thickness && depth.values.mean !== null) {
        total += (depth.values.mean / layer.unit_measure.d_factor) * thickness;
        weight += thickness;
      }
    }
    if (weight) values[layer.name] = total / weight;
  }
  // SoilGrids has no data for water, towns and some rock; treat as unknown.
  if (["phh2o", "clay", "sand", "silt"].some((name) => values[name] === undefined)) return null;

  // Clay, sand and silt come in g/kg; divided by d_factor they are %.
  const clay = round1(values.clay);
  const sand = round1(values.sand);
  return {
    ph: round1(values.phh2o),
    clay_pct: clay,
    sand_pct: sand,
    silt_pct: round1(values.silt),
    drainage: drainageFromTexture(clay, sand),
    drainage_basis: "Estimated from topsoil texture (clay and sand), not measured.",
  };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
