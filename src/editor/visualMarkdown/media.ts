const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
  "youtu.be"
]);

export interface YouTubeVideoEmbed {
  videoId: string;
  embedSrc: string;
}

function embedFor(videoId: string): YouTubeVideoEmbed | null {
  if (!YOUTUBE_VIDEO_ID_PATTERN.test(videoId)) {
    return null;
  }

  return {
    videoId,
    embedSrc: `https://www.youtube-nocookie.com/embed/${videoId}`
  };
}

function singlePathSegment(pathname: string, prefix: string) {
  if (!pathname.startsWith(prefix)) {
    return null;
  }

  const videoId = pathname.slice(prefix.length);
  return videoId && !videoId.includes("/") ? videoId : null;
}

export function parseYouTubeVideoUrl(sourceUrl: string): YouTubeVideoEmbed | null {
  let url: URL;

  try {
    url = new URL(sourceUrl);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return null;
  }

  const hostname = url.hostname;

  if (!YOUTUBE_HOSTS.has(hostname)) {
    return null;
  }

  if (hostname === "youtu.be") {
    const videoId = singlePathSegment(url.pathname, "/");
    return videoId ? embedFor(videoId) : null;
  }

  if (hostname === "youtube-nocookie.com" || hostname === "www.youtube-nocookie.com") {
    const videoId = singlePathSegment(url.pathname, "/embed/");
    return videoId ? embedFor(videoId) : null;
  }

  if (url.pathname === "/watch") {
    const videoId = url.searchParams.get("v");
    return videoId ? embedFor(videoId) : null;
  }

  for (const prefix of ["/embed/", "/shorts/", "/live/"]) {
    const videoId = singlePathSegment(url.pathname, prefix);

    if (videoId) {
      return embedFor(videoId);
    }
  }

  return null;
}
