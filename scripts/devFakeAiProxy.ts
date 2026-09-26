// Local fake of the Iliad AI proxy for dev QA of the free route (Groq spec
// §1 dev overrides). Run it, then start a dev build with
// ILIAD_AI_PROXY_URL=http://127.0.0.1:<port> (read only when the app is not
// packaged). Answers are canned; nothing is sent to Groq and nothing is logged
// but request paths.
//
//   npm run dev:fake-ai-proxy -- [--port 8788] [--install-limit 2] [--global-cap] [--paused] [--min-version 9.0.0]

import { startFakeAiProxy } from "../tests/fixtures/fakeAiProxy";

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : "true";
}

const port = Number(flag("port") ?? 8788);
const proxy = await startFakeAiProxy({ installDailyRequests: Number(flag("install-limit") ?? 50) }, port);
proxy.state.globalCapReached = flag("global-cap") === "true";
proxy.state.freeTierEnabled = flag("paused") !== "true";
proxy.state.minClientVersion = flag("min-version") ?? null;

let seen = 0;
setInterval(() => {
  for (; seen < proxy.requests.length; seen += 1) {
    const request = proxy.requests[seen];
    console.log(`${new Date().toISOString()} ${request.method} ${request.path}`);
  }
}, 250).unref();

console.log(`fake Iliad AI proxy on ${proxy.url} (install limit ${proxy.state.installDailyRequests}/day, resetAt ${proxy.resetAt()})`);

const stop = () => {
  void proxy.close().then(() => process.exit(0));
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
await new Promise(() => undefined);
