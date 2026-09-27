import { describe, expect, it } from "vitest";
import type { WhatsNewEntry } from "../../src/whatsNew/entries";
import { whatsNewEntries } from "../../src/whatsNew/entries";
import { takeWhatsNew, whatsNewLastSeenStorageKey, whatsNewToShow } from "../../src/whatsNew/whatsNew";

const entry060 = whatsNewEntries.find((entry) => entry.version === "0.6.0") as WhatsNewEntry;

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    }
  };
}

describe("What's new", () => {
  it("has a 0.6.0 entry in English and Spanish", () => {
    expect(entry060.title).toEqual({ en: "Iliad updates itself now", es: "Iliad ahora se actualiza solo" });
    expect(entry060.body.en).toContain("click Update at the bottom of the sidebar");
    expect(entry060.body.es).toContain("Actualizar");
    for (const entry of whatsNewEntries) {
      expect(entry.title.en && entry.title.es && entry.body.en && entry.body.es).toBeTruthy();
    }
  });

  it("shows on the first launch of 0.6.0 after 0.5.0 (no last-seen version, but a last-workspace preference)", () => {
    expect(whatsNewToShow({ currentVersion: "0.6.0", lastSeenVersion: null, usedBefore: true })).toBe(entry060);
  });

  it("never shows on a fresh install", () => {
    expect(whatsNewToShow({ currentVersion: "0.6.0", lastSeenVersion: null, usedBefore: false })).toBeNull();
  });

  it("shows after an update from an older stored version, not for the same or a newer one", () => {
    expect(whatsNewToShow({ currentVersion: "0.6.0", lastSeenVersion: "0.5.9", usedBefore: true })).toBe(entry060);
    expect(whatsNewToShow({ currentVersion: "0.6.0", lastSeenVersion: "0.6.0", usedBefore: true })).toBeNull();
    expect(whatsNewToShow({ currentVersion: "0.6.0", lastSeenVersion: "0.7.0", usedBefore: true })).toBeNull();
  });

  it("shows nothing for a version without an entry", () => {
    expect(whatsNewToShow({ currentVersion: "0.6.1", lastSeenVersion: "0.6.0", usedBefore: true })).toBeNull();
  });

  it("shows once: the first window records the version, later windows and launches see nothing", () => {
    const storage = memoryStorage({ "iliad:last-workspace": "{}" });
    const usedBefore = () => storage.getItem("iliad:last-workspace") !== null;
    expect(takeWhatsNew({ currentVersion: "0.6.0", storage, usedBefore })).toBe(entry060);
    expect(storage.values.get(whatsNewLastSeenStorageKey)).toBe("0.6.0");
    expect(takeWhatsNew({ currentVersion: "0.6.0", storage, usedBefore })).toBeNull();
  });

  it("records the version on a fresh install too, so the next update's card shows", () => {
    const storage = memoryStorage();
    const entries: WhatsNewEntry[] = [{ ...entry060, version: "0.7.0" }];
    expect(takeWhatsNew({ currentVersion: "0.6.0", storage, usedBefore: () => false, entries })).toBeNull();
    expect(storage.values.get(whatsNewLastSeenStorageKey)).toBe("0.6.0");
    expect(takeWhatsNew({ currentVersion: "0.7.0", storage, usedBefore: () => false, entries })?.version).toBe("0.7.0");
  });

  it("never moves the last-seen version backwards", () => {
    const storage = memoryStorage({ [whatsNewLastSeenStorageKey]: "0.7.0" });
    expect(takeWhatsNew({ currentVersion: "0.6.0", storage, usedBefore: () => true })).toBeNull();
    expect(storage.values.get(whatsNewLastSeenStorageKey)).toBe("0.7.0");
  });

  it("survives unavailable storage", () => {
    const storage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => undefined
    };
    expect(takeWhatsNew({ currentVersion: "0.6.0", storage, usedBefore: () => true })).toBeNull();
  });
});
