import { describe, it, expect } from "vitest";
import { WEEKLY_LIMITS, isUnlimited, remainingFor } from "./entitlements";

describe("weekly limits", () => {
  it("free is capped at 2000 words and 2 meetings", () => {
    expect(WEEKLY_LIMITS.free.dictation_words).toBe(2000);
    expect(WEEKLY_LIMITS.free.meeting).toBe(2);
  });

  it("pro is unlimited on both metrics", () => {
    expect(WEEKLY_LIMITS.pro.dictation_words).toBe(Infinity);
    expect(WEEKLY_LIMITS.pro.meeting).toBe(Infinity);
    expect(isUnlimited("pro")).toBe(true);
    expect(isUnlimited("free")).toBe(false);
  });

  it("remainingFor subtracts used from the free limit, clamped at 0", () => {
    expect(remainingFor("free", "dictation_words", 0)).toBe(2000);
    expect(remainingFor("free", "dictation_words", 1500)).toBe(500);
    expect(remainingFor("free", "dictation_words", 2500)).toBe(0);
    expect(remainingFor("free", "meeting", 2)).toBe(0);
  });

  it("remainingFor is Infinity for pro regardless of usage", () => {
    expect(remainingFor("pro", "dictation_words", 99999)).toBe(Infinity);
  });
});
