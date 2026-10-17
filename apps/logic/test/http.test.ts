import { describe, expect, it } from "vitest";
import worker, { normalizePhone, type Env } from "../src/index";
import { testDb } from "./d1";

const TOKEN = "test-token";

function client(env: Partial<Env> = {}) {
  const full: Env = { DB: testDb(), WEATHER_API: "https://weather.invalid", ADMIN_TOKEN: TOKEN, ...env };
  return async (method: string, path: string, body?: unknown, token: string | null = TOKEN) => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await worker.fetch(
      new Request(`https://logic.test${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
      full,
    );
    return { status: response.status, body: (await response.json()) as any };
  };
}

describe("http", () => {
  it("health needs no token; everything else does", async () => {
    const call = client();
    expect((await call("GET", "/health", undefined, null)).status).toBe(200);
    expect((await call("GET", "/farmers", undefined, null)).status).toBe(401);
    expect((await call("GET", "/farmers", undefined, "wrong")).status).toBe(401);
  });

  it("refuses every request when no admin token is configured", async () => {
    const call = client({ ADMIN_TOKEN: undefined });
    expect((await call("GET", "/farmers", undefined, "")).status).toBe(401);
  });

  it("lists the seeded farmers", async () => {
    const { body } = await client()("GET", "/farmers");
    expect(body.farmers.map((f: { id: string }) => f.id)).toEqual(["F014", "F027", "F043", "F056", "F062", "F075", "F084", "F091"]);
  });

  it("registers a farmer and rejects bad input", async () => {
    const call = client();
    const good = { name: "Alinafe Kumwenda", phone: "0991 234 567", crop: "beans", latitude: -13.05, longitude: 33.5 };
    const created = await call("POST", "/farmers", good);
    expect(created.status).toBe(201);
    expect(created.body.farmer).toMatchObject({ phone: "+265991234567", channel: "whatsapp", lang: null });
    expect((await call("POST", "/farmers", good)).status).toBe(409);
    expect((await call("POST", "/farmers", { ...good, phone: "+265991234568", crop: "rice" })).status).toBe(400);
    expect((await call("POST", "/farmers", { ...good, phone: "+265991234568", latitude: -30 })).status).toBe(400);
  });

  it("runs a demo scenario and the farmer answers through /inbound", async () => {
    const call = client();
    const scenario = await call("POST", "/demo/scenario", { weather: "wet", farmer_id: "F014" });
    expect(scenario.body.results).toMatchObject([{ disease: "maize_leaf_blights", status: "flag", alert: "new" }]);

    const first = await call("POST", "/inbound", { phone: "+2650000000014", text: "2" });
    expect(first.body.replies[0]).toBe("Chimanga chanu · 1 mwa 8\nKodi masamba apansi ali ndi mizere yaitali yotsatira utali wa tsamba?\n1 Inde\n2 Ayi");

    const { body } = await call("GET", "/farmers/F014");
    expect(body.flags[0]).toMatchObject({ disease: "maize_leaf_blights", source: "scenario", session: { status: "active", step: 0 } });
    const messages = await call("GET", "/farmers/F014/messages");
    expect(messages.body.messages.map((m: { direction: string }) => m.direction)).toEqual(["out", "out", "in", "out"]);
  });

  it("raises a manual flag only for a disease of the farmer's crop", async () => {
    const call = client();
    expect((await call("POST", "/flags", { farmer_id: "F014", disease: "clubroot" })).status).toBe(400);
    const flag = await call("POST", "/flags", { farmer_id: "F062", disease: "clubroot" });
    expect(flag.status).toBe(201);
    expect(flag.body.flag).toMatchObject({ reason: "manual", source: "manual", status: "awaiting" });
  });

  it("normalizes Malawi phone numbers", () => {
    expect(normalizePhone("0991234567")).toBe("+265991234567");
    expect(normalizePhone("+265 99 123 4567")).toBe("+265991234567");
    expect(normalizePhone("12345")).toBeNull();
  });
});
