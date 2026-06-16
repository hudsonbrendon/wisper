import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn() }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));

import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { checkForUpdate, installUpdate } from "./updater";

const mockCheck = vi.mocked(check);
const mockRelaunch = vi.mocked(relaunch);

beforeEach(() => {
  vi.clearAllMocks();
  mockRelaunch.mockResolvedValue(undefined);
});

describe("checkForUpdate", () => {
  it("returns the update object when one is available", async () => {
    const fakeUpdate = { version: "1.2.3" };
    mockCheck.mockResolvedValueOnce(fakeUpdate as never);
    const result = await checkForUpdate();
    expect(result).toBe(fakeUpdate);
    expect(mockCheck).toHaveBeenCalledTimes(1);
  });

  it("returns null when no update is available", async () => {
    mockCheck.mockResolvedValueOnce(null as never);
    const result = await checkForUpdate();
    expect(result).toBeNull();
  });
});

describe("installUpdate", () => {
  it("drives onProgress for Started, Progress, and Finished events then relaunches", async () => {
    type DownloadEvent =
      | { event: "Started"; data: { contentLength?: number } }
      | { event: "Progress"; data: { chunkLength: number } }
      | { event: "Finished" };

    const fakeUpdate = {
      downloadAndInstall: vi.fn(async (cb: (e: DownloadEvent) => void) => {
        cb({ event: "Started", data: { contentLength: 100 } });
        cb({ event: "Progress", data: { chunkLength: 30 } });
        cb({ event: "Progress", data: { chunkLength: 20 } });
        cb({ event: "Finished" });
      }),
    };

    const onProgress = vi.fn();
    await installUpdate(fakeUpdate as never, onProgress);

    expect(fakeUpdate.downloadAndInstall).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenCalledTimes(4);
    // Started: downloaded=0, total=100
    expect(onProgress).toHaveBeenNthCalledWith(1, 0, 100);
    // First Progress: downloaded=30, total=100
    expect(onProgress).toHaveBeenNthCalledWith(2, 30, 100);
    // Second Progress: downloaded=50, total=100
    expect(onProgress).toHaveBeenNthCalledWith(3, 50, 100);
    // Finished: downloaded=total=100
    expect(onProgress).toHaveBeenNthCalledWith(4, 100, 100);

    expect(mockRelaunch).toHaveBeenCalledTimes(1);
  });

  it("handles a Started event with no contentLength (treats as 0)", async () => {
    type DownloadEvent =
      | { event: "Started"; data: { contentLength?: number } }
      | { event: "Progress"; data: { chunkLength: number } }
      | { event: "Finished" };

    const fakeUpdate = {
      downloadAndInstall: vi.fn(async (cb: (e: DownloadEvent) => void) => {
        cb({ event: "Started", data: {} });
        cb({ event: "Finished" });
      }),
    };

    const onProgress = vi.fn();
    await installUpdate(fakeUpdate as never, onProgress);

    // total = 0 (no contentLength)
    expect(onProgress).toHaveBeenNthCalledWith(1, 0, 0);
    // Finished: both 0
    expect(onProgress).toHaveBeenNthCalledWith(2, 0, 0);
    expect(mockRelaunch).toHaveBeenCalledTimes(1);
  });

  it("calls relaunch after downloadAndInstall completes", async () => {
    type DownloadEvent =
      | { event: "Started"; data: { contentLength?: number } }
      | { event: "Progress"; data: { chunkLength: number } }
      | { event: "Finished" };

    const fakeUpdate = {
      downloadAndInstall: vi.fn(async (_cb: (e: DownloadEvent) => void) => {
        // no events — just resolves
      }),
    };

    await installUpdate(fakeUpdate as never, vi.fn());
    expect(mockRelaunch).toHaveBeenCalledTimes(1);
  });
});
