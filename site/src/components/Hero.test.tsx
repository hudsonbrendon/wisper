import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import Hero from "./Hero";

describe("Hero", () => {
  it("renders the logo, headline, and a download CTA", () => {
    render(<Hero os="mac" macArch="apple" />);
    expect(screen.getByAltText(/openwispr/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      /voice/i,
    );
    expect(
      screen.getByRole("link", { name: /download for macOS/i }),
    ).toBeInTheDocument();
  });
});
