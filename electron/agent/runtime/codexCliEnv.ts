import path from "node:path";

const macAndUnixCliDirs = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"];

export function codexCliSearchPath(basePath = process.env.PATH ?? "") {
  const parts = basePath.split(path.delimiter).filter(Boolean);

  for (const dir of userCliDirs()) {
    appendPathPart(parts, dir);
  }

  if (process.platform !== "win32") {
    for (const dir of macAndUnixCliDirs) {
      appendPathPart(parts, dir);
    }
  }

  return parts.join(path.delimiter);
}

function userCliDirs() {
  const home = process.env.HOME;

  if (!home || process.platform === "win32") {
    return [];
  }

  return [path.join(home, ".local", "bin"), path.join(home, "bin")];
}

function appendPathPart(parts: string[], dir: string) {
  if (!parts.includes(dir)) {
    parts.push(dir);
  }
}
