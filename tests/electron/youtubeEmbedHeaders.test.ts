import { describe, expect, it, vi } from "vitest";
import {
  installYouTubeEmbedHeaders,
  withYouTubeEmbedHeaders,
  youtubeEmbedHeaderFilter
} from "../../electron/window/youtubeEmbedHeaders";

describe("YouTube embed headers", () => {
  it("adds a stable app origin and referrer for packaged iframe requests", () => {
    expect(withYouTubeEmbedHeaders({ Accept: "text/html" })).toEqual({
      Accept: "text/html",
      Origin: "https://iliad.md",
      Referer: "https://iliad.md/"
    });
  });

  it("registers only YouTube embed URL patterns", () => {
    const onBeforeSendHeaders = vi.fn();

    installYouTubeEmbedHeaders({ onBeforeSendHeaders });

    expect(onBeforeSendHeaders).toHaveBeenCalledWith(youtubeEmbedHeaderFilter, expect.any(Function));
  });
});
