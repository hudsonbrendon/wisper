import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import { secureStorage } from "./secureStorage";

const mockInvoke = vi.mocked(invoke);

beforeEach(() => vi.clearAllMocks());

describe("secureStorage", () => {
  it("getItem reads via secure_get", async () => {
    mockInvoke.mockResolvedValueOnce("token-value");
    const v = await secureStorage.getItem("sb-key");
    expect(mockInvoke).toHaveBeenCalledWith("secure_get", { key: "sb-key" });
    expect(v).toBe("token-value");
  });

  it("getItem returns null when the backend has no entry", async () => {
    mockInvoke.mockResolvedValueOnce(null);
    expect(await secureStorage.getItem("sb-key")).toBeNull();
  });

  it("setItem writes via secure_set", async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    await secureStorage.setItem("sb-key", "val");
    expect(mockInvoke).toHaveBeenCalledWith("secure_set", {
      key: "sb-key",
      value: "val",
    });
  });

  it("removeItem deletes via secure_delete", async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    await secureStorage.removeItem("sb-key");
    expect(mockInvoke).toHaveBeenCalledWith("secure_delete", { key: "sb-key" });
  });
});
