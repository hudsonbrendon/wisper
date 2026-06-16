import { describe, it, expect } from "vitest";
import { osFromUA, macArchFromRenderer } from "./os";

describe("osFromUA", () => {
  it("detects macOS", () => {
    expect(
      osFromUA(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "MacIntel",
      ),
    ).toBe("mac");
  });
  it("detects iPadOS as mac", () => {
    expect(
      osFromUA("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)", "iPad"),
    ).toBe("mac");
  });
  it("detects Windows", () => {
    expect(osFromUA("Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Win32")).toBe(
      "windows",
    );
  });
  it("detects Linux", () => {
    expect(
      osFromUA("Mozilla/5.0 (X11; Ubuntu; Linux x86_64)", "Linux x86_64"),
    ).toBe("linux");
  });
  it("returns unknown for unrecognized agents", () => {
    expect(osFromUA("SomeBot/1.0", "")).toBe("unknown");
  });
});

describe("macArchFromRenderer", () => {
  it("maps Apple GPU strings to apple", () => {
    expect(macArchFromRenderer("Apple M2")).toBe("apple");
    expect(macArchFromRenderer("ANGLE (Apple, Apple M1 Pro, OpenGL)")).toBe(
      "apple",
    );
  });
  it("maps Intel/AMD strings to intel", () => {
    expect(macArchFromRenderer("Intel(R) Iris(TM) Plus Graphics")).toBe(
      "intel",
    );
    expect(macArchFromRenderer("AMD Radeon Pro 5500M")).toBe("intel");
  });
  it("returns unknown for empty or unrecognized renderers", () => {
    expect(macArchFromRenderer("")).toBe("unknown");
    expect(macArchFromRenderer("Mali-G78")).toBe("unknown");
  });
});
