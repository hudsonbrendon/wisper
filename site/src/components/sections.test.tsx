import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import Features from "./Features";
import HowItWorks from "./HowItWorks";
import Footer from "./Footer";

describe("content sections", () => {
  it("Features lists multiple feature cards", () => {
    render(<Features />);
    expect(screen.getByText(/on-device/i)).toBeInTheDocument();
    expect(
      screen.getAllByRole("heading", { level: 3 }).length,
    ).toBeGreaterThanOrEqual(4);
  });

  it("HowItWorks shows numbered steps", () => {
    render(<HowItWorks />);
    expect(screen.getByText(/press your hotkey/i)).toBeInTheDocument();
  });

  it("Footer links to the GitHub repo", () => {
    render(<Footer />);
    expect(screen.getByRole("link", { name: /github/i })).toHaveAttribute(
      "href",
      expect.stringContaining("github.com/hudsonbrendon/openwispr"),
    );
  });
});
