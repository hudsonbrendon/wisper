import { describe, it, expect } from "vitest";
import { LANGUAGES, langLabel } from "./languages";

describe("languages", () => {
  it("includes auto-detect and common languages", () => {
    const codes = LANGUAGES.map((l) => l.code);
    expect(codes).toContain("auto");
    expect(codes).toContain("pt");
    expect(codes).toContain("en");
  });

  it("has no duplicate codes", () => {
    const codes = LANGUAGES.map((l) => l.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("langLabel uppercases the code", () => {
    expect(langLabel("pt")).toBe("PT");
    expect(langLabel("auto")).toBe("AUTO");
  });
});
