import { describe, it, expect } from "vitest";
import { eventToAccelerator, loneModifierFromKeyup } from "./hotkey";

function ev(init: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    key: "",
    code: "",
    ...init,
  } as KeyboardEvent;
}

describe("eventToAccelerator", () => {
  it("builds a modifier+key combo", () => {
    expect(
      eventToAccelerator(ev({ ctrlKey: true, shiftKey: true, code: "KeyZ", key: "z" })),
    ).toBe("Control+Shift+Z");
  });

  it("maps Super for the command key and named keys", () => {
    expect(eventToAccelerator(ev({ metaKey: true, code: "Space", key: " " }))).toBe(
      "Super+Space",
    );
    expect(eventToAccelerator(ev({ code: "F5", key: "F5" }))).toBe("F5");
  });

  it("returns null while only modifiers are held", () => {
    expect(eventToAccelerator(ev({ altKey: true, key: "Alt", code: "AltLeft" }))).toBeNull();
    expect(eventToAccelerator(ev({ ctrlKey: true, shiftKey: true }))).toBeNull();
  });
});

describe("loneModifierFromKeyup", () => {
  it("returns the modifier when released alone", () => {
    // On keyup of Alt with no modifier still held, the *Key flags are all false.
    expect(loneModifierFromKeyup(ev({ key: "Alt" }))).toBe("Alt");
    expect(loneModifierFromKeyup(ev({ key: "Control" }))).toBe("Control");
    expect(loneModifierFromKeyup(ev({ key: "Shift" }))).toBe("Shift");
    expect(loneModifierFromKeyup(ev({ key: "Meta" }))).toBe("Super");
  });

  it("returns null when another modifier is still held", () => {
    expect(loneModifierFromKeyup(ev({ key: "Shift", ctrlKey: true }))).toBeNull();
  });

  it("returns null for non-modifier keys", () => {
    expect(loneModifierFromKeyup(ev({ key: "z" }))).toBeNull();
    expect(loneModifierFromKeyup(ev({ key: "Enter" }))).toBeNull();
  });
});
