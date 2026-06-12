import { describe, expect, it } from "vitest";
import { applyTextDelta, emptyStreamingText, isScrolledToBottom, visibleStreamingText } from "../../src/assistant/streaming";

describe("applyTextDelta", () => {
  it("appends within a generation and replaces across generations", () => {
    const first = applyTextDelta(emptyStreamingText, { generation: 1, delta: "Hola" });
    const second = applyTextDelta(first, { generation: 1, delta: " mundo" });
    const replaced = applyTextDelta(second, { generation: 2, delta: "Nueva ronda" });

    expect(second).toEqual({ generation: 1, text: "Hola mundo" });
    expect(replaced).toEqual({ generation: 2, text: "Nueva ronda" });
  });
});

describe("visibleStreamingText", () => {
  it("passes marker-free prose through and cuts at each marker, case-insensitively", () => {
    expect(visibleStreamingText("Prosa normal.")).toBe("Prosa normal.");
    expect(visibleStreamingText("Listo.\n```diff\n-a\n+b")).toBe("Listo.\n");
    expect(visibleStreamingText("Listo.\nFULL_REPLACEMENT: x")).toBe("Listo.\n");
    expect(visibleStreamingText("Listo.\nFull_Replacement: x")).toBe("Listo.\n");
    expect(visibleStreamingText("Listo.\nNEW_DOCUMENT: a.md")).toBe("Listo.\n");
    expect(visibleStreamingText("Listo.\n<<<<<<< SEARCH\nold")).toBe("Listo.\n");
    expect(visibleStreamingText("Listo.\n<<<<<<< search")).toBe("Listo.\n");
    expect(visibleStreamingText("```diff\n-a")).toBe("");
  });

  it("holds back trailing partial marker prefixes so split deltas never flash", () => {
    expect(visibleStreamingText("Listo.\nFULL_REPLA")).toBe("Listo.\n");
    expect(visibleStreamingText("Listo.\n``")).toBe("Listo.\n");
    expect(visibleStreamingText("Listo.\n```di")).toBe("Listo.\n");
    expect(visibleStreamingText("Listo.\nNEW_")).toBe("Listo.\n");
    expect(visibleStreamingText("Listo.\n<<<<")).toBe("Listo.\n");
    // A complete word that is not a marker prefix stays visible.
    expect(visibleStreamingText("Listo. FULL STOP")).toBe("Listo. FULL STOP");
    // A trailing "<" holdback is transient: prose continuing past it reappears.
    expect(visibleStreamingText("a <")).toBe("a ");
    expect(visibleStreamingText("a < b")).toBe("a < b");
  });
});

describe("isScrolledToBottom", () => {
  it("pins within the threshold and releases beyond it", () => {
    expect(isScrolledToBottom({ scrollHeight: 1000, scrollTop: 900, clientHeight: 80 })).toBe(true);
    expect(isScrolledToBottom({ scrollHeight: 1000, scrollTop: 800, clientHeight: 80 })).toBe(false);
    expect(isScrolledToBottom({ scrollHeight: 500, scrollTop: 0, clientHeight: 500 })).toBe(true);
  });
});
