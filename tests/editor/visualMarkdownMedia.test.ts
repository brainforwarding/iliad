import { describe, expect, it } from "vitest";
import { parseYouTubeVideoUrl } from "../../src/editor/visualMarkdown/media";

describe("visual Markdown YouTube media", () => {
  it("renders YouTube URLs as nocookie embeds with a stable app origin", () => {
    const embed = parseYouTubeVideoUrl("https://youtu.be/k45Ao7Tcgn8?si=share");

    expect(embed).toEqual({
      videoId: "k45Ao7Tcgn8",
      embedSrc:
        "https://www.youtube-nocookie.com/embed/k45Ao7Tcgn8?origin=https%3A%2F%2Filiad.md&widget_referrer=https%3A%2F%2Filiad.md"
    });
  });

  it("rejects spoofed YouTube hosts", () => {
    expect(parseYouTubeVideoUrl("https://youtube.com.evil/watch?v=k45Ao7Tcgn8")).toBeNull();
    expect(parseYouTubeVideoUrl("https://youtube.com@evil.test/watch?v=k45Ao7Tcgn8")).toBeNull();
  });
});
