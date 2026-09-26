const { createHash } = require("node:crypto");
const path = require("node:path");
const os = require("node:os");

// The hash identifies a user/profile; it is not an authentication mechanism.
function cliEndpoint(userData, platform = process.platform, username = os.userInfo().username) {
  if (platform !== "win32") return path.posix.join(userData, "iliad.sock");
  const profile = path.win32.resolve(userData).toLowerCase();
  const id = createHash("sha256").update(`${username.toLowerCase()}\0${profile}`).digest("hex").slice(0, 32);
  return `\\\\.\\pipe\\iliad-${id}`;
}
module.exports = { cliEndpoint };
