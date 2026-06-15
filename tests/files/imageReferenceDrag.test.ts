import { describe, expect, it } from "vitest";
import {
  createImageReferenceDragPayload,
  imageReferenceDragPayloadType,
  normalizeImageReferenceRelativePath,
  readImageReferenceDragPayload
} from "../../src/files/imageReferenceDrag";

describe("image reference drag payloads", () => {
  it("normalizes supported visible image paths", () => {
    expect(normalizeImageReferenceRelativePath(" visuals//assets\\water flow.png ")).toBe(
      "visuals/assets/water flow.png"
    );
    expect(normalizeImageReferenceRelativePath("assets/photo.JPG")).toBe("assets/photo.JPG");
  });

  it("rejects unsafe or unsupported paths", () => {
    expect(normalizeImageReferenceRelativePath("")).toBe("");
    expect(normalizeImageReferenceRelativePath("/assets/photo.png")).toBe("");
    expect(normalizeImageReferenceRelativePath("../photo.png")).toBe("");
    expect(normalizeImageReferenceRelativePath(".hidden/photo.png")).toBe("");
    expect(normalizeImageReferenceRelativePath("node_modules/pkg/photo.png")).toBe("");
    expect(normalizeImageReferenceRelativePath("assets/photo.heic")).toBe("");
  });

  it("round-trips payloads for the expected workspace session", () => {
    const payload = createImageReferenceDragPayload("session-1", "assets/photo.png");

    expect(payload).toEqual({
      type: imageReferenceDragPayloadType,
      workspaceSessionId: "session-1",
      relativePath: "assets/photo.png"
    });
    expect(readImageReferenceDragPayload(JSON.stringify(payload), "session-1")).toEqual(payload);
    expect(readImageReferenceDragPayload(JSON.stringify(payload), "session-2")).toBeNull();
    expect(readImageReferenceDragPayload("{", "session-1")).toBeNull();
  });
});
