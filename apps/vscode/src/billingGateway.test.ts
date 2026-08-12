import { describe, expect, it } from "vitest";
import { parseOverage, parsePlansCatalog } from "./billingGateway.js";

const PLAN = {
  tier: "pro",
  label: "Pro",
  priceEur: 50,
  commitmentPriceEur: 45.83,
  monthlyCredits: 52_500,
  bonusPct: 0.05,
  highlight: true,
};

const PACK = { id: "small", label: "Pack S", credits: 10_000, priceEur: 10 };

describe("parsePlansCatalog", () => {
  it("accepts a production-shaped catalog", () => {
    const catalog = parsePlansCatalog({
      creditValueEur: 0.001,
      packExpiryMonths: 12,
      plans: [PLAN],
      packs: [PACK],
    });
    expect(catalog).toEqual({
      creditValueEur: 0.001,
      packExpiryMonths: 12,
      plans: [PLAN],
      packs: [PACK],
    });
  });

  it("defaults highlight to false", () => {
    const catalog = parsePlansCatalog({
      creditValueEur: 0.001,
      packExpiryMonths: 12,
      plans: [{ ...PLAN, highlight: undefined }],
      packs: [],
    });
    expect(catalog?.plans[0]?.highlight).toBe(false);
  });

  it("rejects an empty or malformed payload", () => {
    expect(parsePlansCatalog(null)).toBeNull();
    expect(parsePlansCatalog({ creditValueEur: 0.001 })).toBeNull();
    expect(
      parsePlansCatalog({ creditValueEur: 0.001, packExpiryMonths: 12, plans: [], packs: [] }),
    ).toBeNull();
  });
});

describe("parseOverage", () => {
  it("accepts the account overage block", () => {
    expect(
      parseOverage({
        limitEur: 20,
        limitCredits: 20_000,
        consumedCredits: 500,
        consumedEur: 0.5,
        availableCredits: 19_500,
        maxLimitEur: 500,
      }),
    ).toEqual({
      limitEur: 20,
      limitCredits: 20_000,
      consumedCredits: 500,
      consumedEur: 0.5,
      availableCredits: 19_500,
      maxLimitEur: 500,
    });
  });

  it("rejects missing numeric fields", () => {
    expect(parseOverage({ limitEur: 20 })).toBeNull();
    expect(parseOverage(null)).toBeNull();
  });
});
