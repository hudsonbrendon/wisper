import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const handlers: Record<string, (p: unknown) => void> = {};
vi.mock("../lib/api", () => ({
  onEvent: (name: string, handler: (p: unknown) => void) => {
    handlers[name] = handler;
    return Promise.resolve(() => {});
  },
}));

const signIn = vi.fn().mockResolvedValue(undefined);
vi.mock("../lib/authContext", () => ({ useAuth: () => ({ signIn }) }));
vi.mock("../lib/i18n", () => ({ useI18n: () => ({ t: (k: string) => k }) }));

import SignInModal from "./SignInModal";

beforeEach(() => {
  signIn.mockClear();
});

describe("SignInModal", () => {
  it("stays hidden until the backend asks for sign-in", () => {
    render(<SignInModal />);
    expect(screen.queryByText("upgrade.signInTitle")).toBeNull();
  });

  it("opens on signin_required and starts the Google sign-in", async () => {
    render(<SignInModal />);
    await waitFor(() => expect(handlers["signin_required"]).toBeDefined());
    handlers["signin_required"]({ metric: "dictation" });
    await screen.findByText("upgrade.signInTitle");

    await userEvent.click(screen.getByText("account.continueGoogle"));
    expect(signIn).toHaveBeenCalled();
  });
});
