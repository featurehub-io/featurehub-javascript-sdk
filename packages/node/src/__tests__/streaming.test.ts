import { Substitute, type SubstituteOf } from "@fluffy-spoon/substitute";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "http";
import type { AddressInfo } from "net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  type FeatureHubConfig,
  FeatureHubEventSourceClient,
  type InternalFeatureRepository,
  type SseReconnectPolicy,
  SSEResultState,
} from "../index";

const until = async (check: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 10));
  }
};

describe("node streaming", () => {
  let server: Server;
  let requests: IncomingMessage[];
  let respond: (req: IncomingMessage, res: ServerResponse) => void;
  let config: SubstituteOf<FeatureHubConfig>;
  let repo: InternalFeatureRepository;
  let notified: SSEResultState[];
  let client: FeatureHubEventSourceClient | undefined;
  const originalPolicy: SseReconnectPolicy = { ...FeatureHubEventSourceClient.reconnectPolicy };

  beforeEach(async () => {
    requests = [];
    notified = [];
    server = createServer((req, res) => {
      requests.push(req);
      respond(req, res);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const port = (server.address() as AddressInfo).port;

    config = Substitute.for<FeatureHubConfig>();
    config.url().returns(`http://127.0.0.1:${port}/features/default/kwong-pastry`);
    repo = {
      notify: (state: SSEResultState) => notified.push(state),
    } as unknown as InternalFeatureRepository;

    FeatureHubEventSourceClient.reconnectPolicy = {
      networkErrorDelayMs: 20,
      serverErrorDelayMs: 20,
      backoffMultiplier: 2,
      maxDelayMs: 100,
    };
  });

  afterEach(async () => {
    client?.close();
    client = undefined;
    FeatureHubEventSourceClient.reconnectPolicy = originalPolicy;
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  });

  const stream = (res: ServerResponse, events: string) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(events);
  };

  it("sends the context of a server-evaluated key as the x-featurehub header", async () => {
    config.clientEvaluated().returns(false);
    respond = (_req, res) => stream(res, `event: ack\ndata: {}\n\n`);

    client = new FeatureHubEventSourceClient(config, repo);
    await client.contextChange("userkey=ormkorn");

    await until(() => requests.length > 0);
    expect(requests[0]!.headers["x-featurehub"]).toBe("userkey=ormkorn");
    expect(requests[0]!.url).toMatch(/\?contextSha=[0-9a-f]{64}$/);
  });

  it.each([401, 403, 404, 429])("fails for good on a %d and never reconnects", async (status) => {
    config.clientEvaluated().returns(true);
    respond = (_req, res) => {
      res.writeHead(status);
      res.end();
    };

    client = new FeatureHubEventSourceClient(config, repo);
    await client.poll();

    await until(() => notified.includes(SSEResultState.Failure));
    await new Promise((r) => setTimeout(r, 100));

    expect(client.failed).toBe(true);
    expect(requests).toHaveLength(1);
    expect(notified).toEqual([SSEResultState.Failure]);
  });

  it("stays connected through a 503, reconnecting with a backoff", async () => {
    config.clientEvaluated().returns(true);
    let count = 0;
    respond = (_req, res) => {
      if (count++ < 2) {
        res.writeHead(503);
        res.end();
      } else {
        stream(res, `event: features\ndata: []\n\n`);
      }
    };

    client = new FeatureHubEventSourceClient(config, repo);
    await client.poll();

    await until(() => notified.includes(SSEResultState.Features));
    expect(requests).toHaveLength(3);
    expect(notified).toEqual([SSEResultState.Bye, SSEResultState.Bye, SSEResultState.Features]);
    expect(client.failed).toBe(false);
  });

  it("treats a 200 that is not an event stream as a temporary failure", async () => {
    config.clientEvaluated().returns(true);
    let count = 0;
    respond = (_req, res) => {
      if (count++ === 0) {
        res.writeHead(200, { "content-type": "text/html" });
        res.end("<html>captive portal</html>");
      } else {
        stream(res, `event: features\ndata: []\n\n`);
      }
    };

    client = new FeatureHubEventSourceClient(config, repo);
    await client.poll();

    await until(() => notified.includes(SSEResultState.Features));
    expect(notified[0]).toBe(SSEResultState.Bye);
    expect(client.failed).toBe(false);
  });
});

describe("reconnect delays", () => {
  const originalPolicy: SseReconnectPolicy = { ...FeatureHubEventSourceClient.reconnectPolicy };

  afterEach(() => {
    FeatureHubEventSourceClient.reconnectPolicy = originalPolicy;
  });

  it("grow with each failure, wait longer after a 5xx, and never pass the maximum", () => {
    FeatureHubEventSourceClient.reconnectPolicy = {
      networkErrorDelayMs: 3000,
      serverErrorDelayMs: 30000,
      backoffMultiplier: 2,
      maxDelayMs: 300000,
    };

    expect(FeatureHubEventSourceClient.reconnectDelay(undefined, 1)).toBe(3000);
    expect(FeatureHubEventSourceClient.reconnectDelay(undefined, 3)).toBe(12000);
    expect(FeatureHubEventSourceClient.reconnectDelay(503, 1)).toBe(30000);
    expect(FeatureHubEventSourceClient.reconnectDelay(503, 10)).toBe(300000);
  });

  it("are never shorter than 100ms", () => {
    FeatureHubEventSourceClient.reconnectPolicy = {
      networkErrorDelayMs: 0,
      serverErrorDelayMs: 0,
      backoffMultiplier: 1,
      maxDelayMs: 0,
    };

    expect(FeatureHubEventSourceClient.reconnectDelay(503, 1)).toBe(100);
  });
});
