import { describe, it, expect } from "vitest";
import {
  VERSION,
  REPO,
  downloadUrl,
  allDownloads,
  pickPrimary,
} from "./releases";

describe("downloadUrl", () => {
  it("builds a tag-pinned release asset URL", () => {
    expect(downloadUrl("OpenWispr_1.0.0_x64.dmg")).toBe(
      `https://github.com/${REPO}/releases/download/v${VERSION}/OpenWispr_1.0.0_x64.dmg`,
    );
  });
});

describe("pickPrimary", () => {
  it("picks Apple Silicon dmg for mac + apple", () => {
    const d = pickPrimary("mac", "apple");
    expect(d.url).toContain("aarch64.dmg");
    expect(d.label).toMatch(/apple silicon/i);
  });
  it("picks Intel dmg for mac + intel", () => {
    const d = pickPrimary("mac", "intel");
    expect(d.url).toContain("x64.dmg");
    expect(d.label).toMatch(/intel/i);
  });
  it("defaults mac + unknown arch to Apple Silicon", () => {
    expect(pickPrimary("mac", "unknown").url).toContain("aarch64.dmg");
  });
  it("picks the exe for windows", () => {
    expect(pickPrimary("windows", "unknown").url).toContain("x64-setup.exe");
  });
  it("picks the AppImage for linux", () => {
    expect(pickPrimary("linux", "unknown").url).toContain(".AppImage");
  });
  it("falls back to the releases page for unknown OS", () => {
    expect(pickPrimary("unknown", "unknown").url).toContain("/releases/latest");
  });
});

describe("allDownloads", () => {
  it("lists every platform asset", () => {
    const labels = allDownloads().map((d) => d.label);
    expect(labels).toHaveLength(5);
    expect(allDownloads().every((d) => d.url.startsWith("https://"))).toBe(
      true,
    );
  });
});
