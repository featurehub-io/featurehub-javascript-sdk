import { createServer, type IncomingMessage, type Server, type ServerResponse } from "http";
import type { AddressInfo } from "net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { nodeEnvironment } from "../environment";

const names = [
  "FEATUREHUB_EDGE_URL",
  "FEATUREHUB_CLIENT_API_KEY",
  "FEATUREHUB_SERVER_API_KEY",
  "FEATUREHUB_POLLING_REQ_TIMEOUT",
  "FEATUREHUB_SSE_CONNECT_TIMEOUT",
  "FEATUREHUB_SSE_READ_TIMEOUT",
  "FEATUREHUB_SSE_INITIAL_RETRY_DELAY",
  "FEATUREHUB_SSE_MAX_RETRY_DELAY",
  "FEATUREHUB_SSE_BACKOFF_MULTIPLIER",
];

describe("reading the Node settings from the environment", () => {
  it("reads the Edge URL and prefers the client-evaluated key", () => {
    const settings = nodeEnvironment({
      FEATUREHUB_EDGE_URL: " http://edge.example:8085 ",
      FEATUREHUB_CLIENT_API_KEY: "ling*orm",
      FEATUREHUB_SERVER_API_KEY: "kornaphat",
    });

    expect(settings.edgeUrl).toBe("http://edge.example:8085");
    expect(settings.apiKey).toBe("ling*orm");
  });

  it("uses the server-evaluated key when there is no client-evaluated one", () => {
    expect(
      nodeEnvironment({ FEATUREHUB_SERVER_API_KEY: "kornaphat", FEATUREHUB_CLIENT_API_KEY: "" })
        .apiKey,
    ).toBe("kornaphat");
  });

  it("reads the timeouts and delays as durations", () => {
    const settings = nodeEnvironment({
      FEATUREHUB_POLLING_REQ_TIMEOUT: "12s",
      FEATUREHUB_SSE_CONNECT_TIMEOUT: "5s",
      FEATUREHUB_SSE_READ_TIMEOUT: "6m",
      FEATUREHUB_SSE_INITIAL_RETRY_DELAY: "500ms",
      FEATUREHUB_SSE_MAX_RETRY_DELAY: "2m",
      FEATUREHUB_SSE_BACKOFF_MULTIPLIER: "1.5",
    });

    expect(settings).toEqual({
      pollingRequestTimeoutMs: 12000,
      sseConnectTimeoutMs: 5000,
      sseReadTimeoutMs: 360000,
      sseInitialRetryDelayMs: 500,
      sseMaxRetryDelayMs: 120000,
      sseBackoffMultiplier: 1.5,
      warnings: [],
    });
  });

  it.each([
    ["FEATUREHUB_POLLING_REQ_TIMEOUT", "12"],
    ["FEATUREHUB_SSE_CONNECT_TIMEOUT", "1m30s"],
    ["FEATUREHUB_SSE_MAX_RETRY_DELAY", "ten"],
    ["FEATUREHUB_SSE_BACKOFF_MULTIPLIER", "0.5"],
    ["FEATUREHUB_SSE_BACKOFF_MULTIPLIER", "2x"],
    ["FEATUREHUB_SSE_BACKOFF_MULTIPLIER", "-1"],
  ])("ignores %s=%s with a warning, so the default applies", (name, raw) => {
    const settings = nodeEnvironment({ [name]: raw });

    expect(settings.warnings).toHaveLength(1);
    expect(settings.warnings[0]).toContain(name);
    expect(Object.keys(settings)).toEqual(["warnings"]);
  });

  it("warns about a read timeout that quiet streams would trip", () => {
    const settings = nodeEnvironment({ FEATUREHUB_SSE_READ_TIMEOUT: "60s" });

    expect(settings.sseReadTimeoutMs).toBe(60000);
    expect(settings.warnings[0]).toContain("5 minutes");
  });
});

describe("the Node SDK applies the settings", () => {
  let server: Server;
  let requests: IncomingMessage[];
  let respond: (req: IncomingMessage, res: ServerResponse) => void;
  let base: string;
  const saved = Object.fromEntries(names.map((n) => [n, process.env[n]]));

  beforeEach(async () => {
    requests = [];
    server = createServer((req, res) => {
      requests.push(req);
      respond(req, res);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    names.forEach((n) =>
      saved[n] === undefined ? delete process.env[n] : (process.env[n] = saved[n]),
    );
    vi.resetModules();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  });

  async function sdkWith(env: Record<string, string>) {
    names.forEach((n) => delete process.env[n]);
    Object.assign(process.env, env);
    vi.resetModules();
    return await import("../index");
  }

  const until = async (check: () => boolean, ms = 3000) => {
    const end = Date.now() + ms;
    while (!check()) {
      if (Date.now() > end) throw new Error("timed out waiting");
      await new Promise((r) => setTimeout(r, 10));
    }
  };

  it("takes the Edge URL and API key from the environment when code gives none", async () => {
    const sdk = await sdkWith({
      FEATUREHUB_EDGE_URL: base,
      FEATUREHUB_SERVER_API_KEY: "sethratanapong",
    });

    const config = new sdk.EdgeFeatureHubConfig();
    expect(config.getHost()).toBe(`${base}/`);
    expect(config.getApiKeys()).toEqual(["sethratanapong"]);

    const fromCode = sdk.EdgeFeatureHubConfig.config("http://elsewhere:9000", "ling*orm");
    expect(fromCode.getHost()).toBe("http://elsewhere:9000/");
    fromCode.close();
  });

  it("abandons a poll that takes longer than FEATUREHUB_POLLING_REQ_TIMEOUT", async () => {
    const sdk = await sdkWith({ FEATUREHUB_POLLING_REQ_TIMEOUT: "100ms" });
    respond = (_req, res) => setTimeout(() => res.end("[]"), 1000);

    const service = sdk.FeatureHubPollingClient.pollingClientProvider(
      {},
      `${base}/features?apiKey=ling*orm`,
      0,
      () => {},
    );

    const started = Date.now();
    await expect(service.poll()).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(800);
  });

  it("treats a stream that goes quiet for longer than FEATUREHUB_SSE_READ_TIMEOUT as lost, and reconnects", async () => {
    const sdk = await sdkWith({
      FEATUREHUB_SSE_READ_TIMEOUT: "150ms",
      FEATUREHUB_SSE_INITIAL_RETRY_DELAY: "100ms",
    });
    respond = (_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(`event: ack\ndata: {}\n\n`);
      // then nothing, for ever
    };
    const notified: unknown[] = [];
    const config = {
      url: () => `${base}/features/default/keep-silent`,
      clientEvaluated: () => true,
    } as any;
    const client = new sdk.FeatureHubEventSourceClient(config, {
      notify: (s: unknown) => notified.push(s),
    } as any);

    await client.poll();
    await until(() => requests.length >= 2);

    expect(notified).toContain(sdk.SSEResultState.Bye);
    expect(client.failed).toBe(false);
    client.close();
  });

  it("gives up opening a stream after FEATUREHUB_SSE_CONNECT_TIMEOUT, and reconnects", async () => {
    const sdk = await sdkWith({
      FEATUREHUB_SSE_CONNECT_TIMEOUT: "100ms",
      FEATUREHUB_SSE_INITIAL_RETRY_DELAY: "100ms",
    });
    respond = () => {
      // never sends the response headers
    };
    const config = {
      url: () => `${base}/features/default/chago`,
      clientEvaluated: () => true,
    } as any;
    const client = new sdk.FeatureHubEventSourceClient(config, { notify: () => {} } as any);

    await client.poll();
    await until(() => requests.length >= 2);

    expect(client.failed).toBe(false);
    client.close();
  });

  it("takes the backoff from the FEATUREHUB_SSE_ variables", async () => {
    const sdk = await sdkWith({
      FEATUREHUB_SSE_INITIAL_RETRY_DELAY: "2s",
      FEATUREHUB_SSE_MAX_RETRY_DELAY: "1m",
      FEATUREHUB_SSE_BACKOFF_MULTIPLIER: "3",
    });

    expect(sdk.FeatureHubEventSourceClient.reconnectPolicy).toMatchObject({
      networkErrorDelayMs: 2000,
      maxDelayMs: 60000,
      backoffMultiplier: 3,
    });
  });
});
