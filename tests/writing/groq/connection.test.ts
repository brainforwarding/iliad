import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConnectionWarmer, WRITING_AI_WARM_INTERVAL_MS, createKeepAliveFetch } from "../../../electron/writing/groq/connection";

const ok = () => Promise.resolve(new Response("", { status: 200 }));

describe("ConnectionWarmer", () => {
  it("warms an origin at most once per interval", () => {
    let now = 10_000;
    const fetchImpl = vi.fn<typeof fetch>(ok);
    const warmer = new ConnectionWarmer({ fetchImpl, now: () => now });
    expect(warmer.warm("https://api.groq.com/openai/v1/models")).toBe(true);
    expect(warmer.warm("https://api.groq.com/openai/v1/models")).toBe(false);
    now += WRITING_AI_WARM_INTERVAL_MS - 1;
    expect(warmer.warm("https://api.groq.com/other")).toBe(false);
    now += 1;
    expect(warmer.warm("https://api.groq.com/openai/v1/models")).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(WRITING_AI_WARM_INTERVAL_MS).toBe(60_000);
  });

  it("sends a bodiless request with the given method and no credentials", () => {
    const fetchImpl = vi.fn<typeof fetch>(ok);
    new ConnectionWarmer({ fetchImpl }).warm("https://proxy.example/healthz", "GET");
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://proxy.example/healthz");
    expect(init).toMatchObject({ method: "GET" });
    expect(init?.body).toBeUndefined();
    expect(init?.headers).toBeUndefined();
  });

  it("limits each origin separately", () => {
    const fetchImpl = vi.fn<typeof fetch>(ok);
    const warmer = new ConnectionWarmer({ fetchImpl, now: () => 0 });
    expect(warmer.warm("https://api.groq.com/openai/v1/models")).toBe(true);
    expect(warmer.warm("https://proxy.example/healthz")).toBe(true);
    expect(warmer.warm("https://proxy.example/healthz")).toBe(false);
  });

  it("counts real requests as use: no warm-up while requests keep the connection busy", async () => {
    let now = 0;
    const fetchImpl = vi.fn<typeof fetch>(ok);
    const warmer = new ConnectionWarmer({ fetchImpl, now: () => now });
    await warmer.fetch("https://api.groq.com/openai/v1/chat/completions", { method: "POST", body: "{}" });
    now += 30_000;
    expect(warmer.warm("https://api.groq.com/openai/v1/models")).toBe(false);
    now += WRITING_AI_WARM_INTERVAL_MS;
    expect(warmer.warm("https://api.groq.com/openai/v1/models")).toBe(true);
  });

  it("never throws: network failures are swallowed", async () => {
    const fetchImpl = vi.fn<typeof fetch>(() => Promise.reject(new TypeError("fetch failed")));
    const warmer = new ConnectionWarmer({ fetchImpl });
    expect(warmer.warm("https://api.groq.com/")).toBe(true);
    expect(warmer.warm("not a url")).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});

describe("createKeepAliveFetch", () => {
  const servers: http.Server[] = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); })));
  });

  it("fetches over its own keep-alive Agent and reuses the connection", async () => {
    let connections = 0;
    const server = http.createServer((_request, response) => response.end("ok"));
    // The server keeps idle sockets longer than the test waits.
    server.keepAliveTimeout = 60_000;
    server.on("connection", () => (connections += 1));
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
    const keepAliveFetch = createKeepAliveFetch(30_000);
    expect(await (await keepAliveFetch(url)).text()).toBe("ok");
    await new Promise((resolve) => setTimeout(resolve, 50));
    await (await keepAliveFetch(url)).text();
    expect(connections).toBe(1);
  });
});
