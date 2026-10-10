import { describe, expect, it } from "vitest";
import { cors, preflight } from "./dev-bridge-http";

const EXT = "chrome-extension://nmdallmhcliifgnlclnamonkmgepecok";

describe("dev bridge CORS", () => {
  it("allows only extension origins, without credentials", () => {
    expect(cors(new Request("https://upay3food.com/api", { headers: { origin: EXT } }))).toMatchObject({ "access-control-allow-origin": EXT });
    expect(cors(new Request("https://upay3food.com/api", { headers: { origin: EXT } }))["access-control-allow-credentials"]).toBeUndefined();
    expect(cors(new Request("https://upay3food.com/api", { headers: { origin: "https://evil.example" } }))).toEqual({});
    expect(cors(new Request("https://upay3food.com/api"))).toEqual({});
  });

  it("answers the preflight with the allowed headers", () => {
    const r = preflight(new Request("https://upay3food.com/api", { method: "OPTIONS", headers: { origin: EXT } }));
    expect(r.status).toBe(204);
    expect(r.headers.get("access-control-allow-headers")).toContain("authorization");
  });
});
