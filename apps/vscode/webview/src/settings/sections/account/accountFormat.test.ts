import { describe, expect, it } from "vitest";
import {
  commitmentTotal,
  creditPercent,
  displayPrice,
  formatCredits,
  formatEur,
  hasActivePass,
  overageConsumedPct,
  overageCreditsFor,
} from "./accountFormat.js";

const plan = {
  tier: "pro",
  label: "Pro",
  priceEur: 50,
  commitmentPriceEur: 45.83,
  monthlyCredits: 52_500,
  bonusPct: 0.05,
  highlight: true,
};

describe("accountFormat", () => {
  it("clamps the credit gauge", () => {
    expect(creditPercent(0, 0)).toBe(0);
    expect(creditPercent(500, 1000)).toBe(50);
    expect(creditPercent(2000, 1000)).toBe(100);
  });

  it("converts an overage cap in euros to credits", () => {
    expect(overageCreditsFor(20, 0.001)).toBe(20_000);
    expect(overageCreditsFor(5, 0)).toBe(0);
  });

  it("clamps overage consumption", () => {
    expect(overageConsumedPct(0, 0)).toBe(0);
    expect(overageConsumedPct(250, 1000)).toBe(25);
    expect(overageConsumedPct(2000, 1000)).toBe(100);
  });

  it("picks monthly vs commitment price", () => {
    expect(displayPrice(plan, "monthly")).toBe(50);
    expect(displayPrice(plan, "commitment")).toBe(45.83);
    expect(commitmentTotal(plan)).toBe(549.96);
  });

  it("formats euros and credits", () => {
    expect(formatEur(20)).toBe("20 €");
    expect(formatEur(45.83)).toBe("45.83 €");
    expect(formatCredits(52500)).toBe((52500).toLocaleString());
  });

  it("treats none as no active pass", () => {
    expect(hasActivePass(null)).toBe(false);
    expect(hasActivePass("none")).toBe(false);
    expect(hasActivePass("pro")).toBe(true);
  });
});
