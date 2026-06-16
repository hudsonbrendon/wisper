import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import DownloadButton from "./DownloadButton";

describe("DownloadButton", () => {
  it("renders the primary CTA for the given platform", () => {
    render(<DownloadButton os="windows" macArch="unknown" />);
    const cta = screen.getByRole("link", { name: /download for windows/i });
    expect(cta).toHaveAttribute(
      "href",
      expect.stringContaining("x64-setup.exe"),
    );
  });

  it("shows the macOS Apple Silicon CTA and lists all platforms", () => {
    render(<DownloadButton os="mac" macArch="apple" />);
    expect(
      screen.getByRole("link", {
        name: /download for macOS \(Apple Silicon\)/i,
      }),
    ).toBeInTheDocument();
    // The "all platforms" disclosure lists every asset (5 of them).
    expect(
      screen.getByRole("link", { name: /Windows \(.exe\)/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Linux \(.deb\)/i }),
    ).toBeInTheDocument();
  });
});
