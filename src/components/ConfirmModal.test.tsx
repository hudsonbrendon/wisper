import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ConfirmModal, { type ConfirmOpts } from "./ConfirmModal";
import { I18nProvider } from "../lib/i18n";

function renderModal(opts: ConfirmOpts | null, onClose = vi.fn()) {
  return {
    onClose,
    ...render(
      <I18nProvider>
        <ConfirmModal opts={opts} onClose={onClose} />
      </I18nProvider>,
    ),
  };
}

const base: Omit<ConfirmOpts, "onConfirm"> = {
  title: "Delete it?",
  message: "This cannot be undone.",
  confirmLabel: "Delete",
  danger: true,
};

describe("ConfirmModal", () => {
  it("renders nothing when opts is null", () => {
    renderModal(null);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows the title, message, and confirm label", () => {
    renderModal({ ...base, onConfirm: vi.fn() });
    expect(screen.getByText("Delete it?")).toBeInTheDocument();
    expect(screen.getByText("This cannot be undone.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("confirming calls onConfirm then onClose", async () => {
    const onConfirm = vi.fn();
    const { onClose } = renderModal({ ...base, onConfirm });
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("cancelling closes without confirming", async () => {
    const onConfirm = vi.fn();
    const { onClose } = renderModal({ ...base, onConfirm });
    await userEvent.click(
      screen.getByRole("button", { name: /cancel|cancelar/i }),
    );
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });
});
