const ILIAD_YOUTUBE_EMBED_ORIGIN = "https://iliad.md";
const ILIAD_YOUTUBE_EMBED_REFERRER = `${ILIAD_YOUTUBE_EMBED_ORIGIN}/`;

export const youtubeEmbedHeaderFilter = {
  urls: ["https://www.youtube.com/embed/*", "https://www.youtube-nocookie.com/embed/*"]
};

export interface YouTubeEmbedWebRequest {
  onBeforeSendHeaders(
    filter: { urls: string[] },
    listener: (
      details: { requestHeaders: Record<string, string> },
      callback: (response: { requestHeaders: Record<string, string> }) => void
    ) => void
  ): void;
}

export function withYouTubeEmbedHeaders(requestHeaders: Record<string, string>) {
  return {
    ...requestHeaders,
    Origin: ILIAD_YOUTUBE_EMBED_ORIGIN,
    Referer: ILIAD_YOUTUBE_EMBED_REFERRER
  };
}

export function installYouTubeEmbedHeaders(webRequest: YouTubeEmbedWebRequest) {
  webRequest.onBeforeSendHeaders(youtubeEmbedHeaderFilter, (details, callback) => {
    callback({
      requestHeaders: withYouTubeEmbedHeaders(details.requestHeaders)
    });
  });
}
