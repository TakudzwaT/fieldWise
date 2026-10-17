// Crop disease checks from the FieldWise decision tree. Each disease has a
// weather or soil branch with two or three conditions:
//   all met            -> "flag"  (SMS the farmer, then USSD questions)
//   one condition short -> "watch" (no SMS; re-tested on the next forecast)
//   otherwise          -> "clear"
// A condition whose data is missing (for example soil not available) counts as
// not met, and the result is marked incomplete.
//
// Temperatures are compared using the mean over the window; durations use the
// longest unbroken run of hours (see window.ts).

import type { Soil } from "./soil";
import type { WindowMetrics } from "./window";

export const CROPS = ["tomato", "maize", "beans", "cabbage"] as const;
export type Crop = (typeof CROPS)[number];

interface Inputs {
  weather: WindowMetrics;
  soil: Soil | null;
}

interface Condition {
  label: string;
  value: (inputs: Inputs) => number | string | null;
  test: (value: number | string) => boolean;
}

interface Disease {
  id: string;
  name: string;
  crop: Crop;
  branch: "weather" | "soil";
  ask: string;
  conditions: Condition[];
  note?: (inputs: Inputs) => string | null;
}

const between = (min: number, max: number) => (v: number | string) => typeof v === "number" && v >= min && v <= max;
const atLeast = (min: number) => (v: number | string) => typeof v === "number" && v >= min;
const atMost = (max: number) => (v: number | string) => typeof v === "number" && v <= max;
const above = (min: number) => (v: number | string) => typeof v === "number" && v > min;
const equals = (expected: string) => (v: number | string) => v === expected;

const airTemp = ({ weather }: Inputs) => weather.air_temp_mean;
const soilTemp = ({ weather }: Inputs) => weather.soil_temp_mean;
const leafWetRun = ({ weather }: Inputs) => weather.leaf_wet_run_max;
const drainage = ({ soil }: Inputs) => soil?.drainage ?? null;

export const DISEASES: Disease[] = [
  {
    id: "late_blight",
    name: "Late blight",
    crop: "tomato",
    branch: "weather",
    ask: "Is there white fuzz under the leaves?",
    conditions: [
      { label: "Air temp 16-21 °C (window mean)", value: airTemp, test: between(16, 21) },
      { label: "Leaves wet ≥ 10 h in a row", value: leafWetRun, test: atLeast(10) },
    ],
  },
  {
    id: "bacterial_wilt",
    name: "Bacterial wilt",
    crop: "tomato",
    branch: "soil",
    ask: "Do plants wilt at midday while the leaves stay green?",
    conditions: [
      { label: "Soil temp 29-35 °C (window mean)", value: soilTemp, test: between(29, 35) },
      { label: "Drainage poor", value: drainage, test: equals("poor") },
    ],
  },
  {
    id: "maize_leaf_blights",
    name: "Maize leaf blights",
    crop: "maize",
    branch: "weather",
    ask: "Are there rectangle or cigar-shaped spots on the leaves?",
    conditions: [
      { label: "Air temp 18-32 °C (window mean)", value: airTemp, test: between(18, 32) },
      { label: "Leaves wet or RH ≥ 90% for ≥ 12 h in a row", value: ({ weather }) => weather.wet_or_humid_run_max, test: atLeast(12) },
    ],
  },
  {
    id: "bean_leaf_diseases",
    name: "Bean leaf diseases",
    crop: "beans",
    branch: "weather",
    ask: "Are there angular spots or rust-coloured dust on the leaves?",
    conditions: [
      { label: "Air temp 16-29 °C (window mean)", value: airTemp, test: between(16, 29) },
      { label: "Leaves wet ≥ 10 h in a row", value: leafWetRun, test: atLeast(10) },
    ],
    note: ({ weather }) => (weather.leaf_wet_run_max >= 24 ? "Leaves wet 24 h or more: angular leaf spot is likely." : null),
  },
  {
    id: "black_rot",
    name: "Black rot",
    crop: "cabbage",
    branch: "weather",
    ask: "Is there a yellow V shape on the leaf edges?",
    conditions: [
      { label: "Air temp 25-35 °C (window mean)", value: airTemp, test: between(25, 35) },
      { label: "RH ≥ 90% (highest in window)", value: ({ weather }) => weather.rh_max, test: atLeast(90) },
      { label: "Rain in forecast (mm in window)", value: ({ weather }) => weather.rain_total, test: above(0) },
    ],
  },
  {
    id: "clubroot",
    name: "Clubroot",
    crop: "cabbage",
    branch: "soil",
    ask: "Are the roots swollen?",
    conditions: [
      { label: "Soil temp 18-25 °C (window mean)", value: soilTemp, test: between(18, 25) },
      { label: "Soil pH ≤ 7.0", value: ({ soil }) => soil?.ph ?? null, test: atMost(7.0) },
      { label: "Drainage poor", value: drainage, test: equals("poor") },
    ],
  },
];

export function assess(crops: Crop[], inputs: Inputs) {
  return DISEASES.filter((disease) => crops.includes(disease.crop)).map((disease) => {
    const conditions = disease.conditions.map((condition) => {
      const value = condition.value(inputs);
      return { condition: condition.label, value, met: value === null ? null : condition.test(value) };
    });
    const short = conditions.filter((c) => c.met !== true).length;
    const status = short === 0 ? "flag" : short === 1 ? "watch" : "clear";
    const note = disease.note?.(inputs) ?? null;
    return {
      crop: disease.crop,
      disease: disease.id,
      name: disease.name,
      branch: disease.branch,
      status,
      complete: conditions.every((c) => c.met !== null),
      ask: disease.ask,
      ...(note && status === "flag" ? { note } : {}),
      conditions,
    };
  });
}

export function parseCrops(raw: string | null): Crop[] | string {
  if (!raw) return [...CROPS];
  const crops = raw.split(",").map((c) => c.trim().toLowerCase()).filter(Boolean);
  const unknown = crops.filter((c) => !(CROPS as readonly string[]).includes(c));
  if (unknown.length) return `Unknown crop: ${unknown.join(", ")}. Known: ${CROPS.join(", ")}.`;
  return crops as Crop[];
}
