import { describe, it, expect } from "vitest";
import {
  canUseFeature,
  DEFAULT_PLAN,
  type Feature,
  type Plan,
} from "./entitlements";

const PLANS: Plan[] = ["free", "pro"];
const FEATURES: Feature[] = ["meetings", "summaries", "unlimited_history"];

describe("entitlements", () => {
  it("defaults new/anonymous users to the free plan", () => {
    expect(DEFAULT_PLAN).toBe("free");
  });

  // Monetization seam: TODAY every feature is allowed on every plan. When a
  // feature gets gated, flip its `free` entry to false and update this test.
  it("allows every feature on every plan (no limits yet)", () => {
    for (const plan of PLANS) {
      for (const feature of FEATURES) {
        expect(canUseFeature(plan, feature)).toBe(true);
      }
    }
  });

  it("denies unknown features safely", () => {
    expect(canUseFeature("free", "nope" as Feature)).toBe(false);
  });
});
