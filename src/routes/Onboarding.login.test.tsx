import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../lib/api", () => ({
  getConfig: vi.fn(() => Promise.resolve({ hotkey: "F5", onboarded: false })),
  saveConfig: vi.fn(() => Promise.resolve()),
  listModels: vi.fn(() => Promise.resolve([])),
  downloadModel: vi.fn(),
  onEvent: vi.fn(() => Promise.resolve(() => {})),
}));
vi.mock("../lib/i18n", () => ({ useI18n: () => ({ t: (k: string) => k }) }));
vi.mock("../lib/authContext", () => ({ useAuth: vi.fn() }));
const signIn = vi.fn();

import { useAuth } from "../lib/authContext";
import Onboarding from "./Onboarding";

beforeEach(() => vi.clearAllMocks());

describe("Onboarding login gate", () => {
  it("blocks Next on the login step until signed in, and signs in on click", async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      loading: false,
      signIn,
    } as never);
    render(<Onboarding onDone={vi.fn()} />);

    // Advance from welcome to the login step.
    await userEvent.click(
      screen.getByRole("button", { name: "onboarding.next" }),
    );

    expect(
      screen.getByRole("button", { name: "account.continueGoogle" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "onboarding.next" }),
    ).toBeDisabled();

    await userEvent.click(
      screen.getByRole("button", { name: "account.continueGoogle" }),
    );
    expect(signIn).toHaveBeenCalledTimes(1);
  });

  it("allows Next on the login step once signed in", async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: "u1" },
      loading: false,
      signIn,
    } as never);
    render(<Onboarding onDone={vi.fn()} />);
    await userEvent.click(
      screen.getByRole("button", { name: "onboarding.next" }),
    );
    expect(
      screen.getByRole("button", { name: "onboarding.next" }),
    ).toBeEnabled();
  });
});
