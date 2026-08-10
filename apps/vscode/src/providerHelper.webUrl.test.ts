import { describe, expect, it } from "vitest";
import { deriveWebUrlFromGateway } from "./providerHelper.js";

describe("deriveWebUrlFromGateway", () => {
  it("maps local gateway to web :4200", () => {
    expect(deriveWebUrlFromGateway("http://127.0.0.1:8788")).toBe("http://127.0.0.1:4200");
    expect(deriveWebUrlFromGateway("http://localhost:8788")).toBe("http://localhost:4200");
  });

  it("strips api. subdomain (staging)", () => {
    expect(deriveWebUrlFromGateway("https://api.ninjacode.dev")).toBe("https://ninjacode.dev");
  });

  it("maps gateway. subdomain to www.", () => {
    expect(deriveWebUrlFromGateway("https://gateway.ninja-code.ai")).toBe("https://www.ninja-code.ai");
  });

  it("falls back for invalid URLs", () => {
    expect(deriveWebUrlFromGateway("not-a-url")).toBe("https://www.ninja-code.ai");
  });
});
