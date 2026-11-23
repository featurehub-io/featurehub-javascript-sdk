import { Substitute, type SubstituteOf } from "@fluffy-spoon/substitute";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "http";
import type { AddressInfo } from "net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  type FeatureHubConfig,
  FeatureHubEventSourceClient,
  fhLog,
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
    expect(requests[0]!.url).toMatch(/\?contextSha=[0-9a-f]{64}&sdk_version=2$/);
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

describe("node streaming, protocol generation 2", () => {
  let server: Server;
  let requests: IncomingMessage[];
  let respond: (req: IncomingMessage, res: ServerResponse, n: number) => void;
  let config: SubstituteOf<FeatureHubConfig>;
  let repo: InternalFeatureRepository;
  let notified: SSEResultState[];
  let client: FeatureHubEventSourceClient | undefined;
  let warnings: unknown[][];
  const originalPolicy: SseReconnectPolicy = { ...FeatureHubEventSourceClient.reconnectPolicy };
  const originalThreshold = FeatureHubEventSourceClient.shortConnectionThresholdMs;
  const originalWarn = fhLog.warn;
  const threshold = 150;

  beforeEach(async () => {
    requests = [];
    notified = [];
    warnings = [];
    fhLog.warn = (...args: unknown[]) => warnings.push(args);
    server = createServer((req, res) => {
      requests.push(req);
      respond(req, res, requests.length);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const port = (server.address() as AddressInfo).port;

    config = Substitute.for<FeatureHubConfig>();
    config.url().returns(`http://127.0.0.1:${port}/features/default/sirilak`);
    config.clientEvaluated().returns(true);
    repo = {
      notify: (state: SSEResultState) => notified.push(state),
    } as unknown as InternalFeatureRepository;

    FeatureHubEventSourceClient.shortConnectionThresholdMs = threshold;
    FeatureHubEventSourceClient.reconnectPolicy = {
      networkErrorDelayMs: 20,
      serverErrorDelayMs: 20,
      backoffMultiplier: 2,
      maxDelayMs: 80,
    };
  });

  afterEach(async () => {
    client?.close();
    client = undefined;
    fhLog.warn = originalWarn;
    FeatureHubEventSourceClient.reconnectPolicy = originalPolicy;
    FeatureHubEventSourceClient.shortConnectionThresholdMs = originalThreshold;
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  });

  const open = (res: ServerResponse) => res.writeHead(200, { "content-type": "text/event-stream" });
  const later = (ms: number, f: () => void) => setTimeout(f, ms);

  it("sends sdk_version=2 after the contextSha", async () => {
    respond = (_req, res) => open(res);

    client = new FeatureHubEventSourceClient(config, repo);
    await client.poll();

    await until(() => requests.length > 0);
    expect(requests[0]!.url).toBe("/features/default/sirilak?contextSha=0&sdk_version=2");
  });

  it("reconnects after a clean bye with the last event id, which a bye with no id does not change", async () => {
    respond = (_req, res, n) => {
      open(res);
      if (n === 1) {
        res.write(`id: 41\nevent: features\ndata: []\n\n`);
        res.write(
          `id: 42\nevent: feature\ndata: {"id":"1","key":"orm","version":1,"type":"BOOLEAN"}\n\n`,
        );
      }
      // Edge holds a quiet connection, then says bye (with no id) and closes it
      later(threshold + 50, () => {
        res.write(`event: bye\ndata: {}\n\n`);
        res.end();
      });
    };

    client = new FeatureHubEventSourceClient(config, repo);
    await client.poll();

    await until(() => requests.length >= 4, 5000);
    expect(requests[0]!.headers["last-event-id"]).toBeUndefined();
    expect(requests.slice(1).map((r) => r.headers["last-event-id"])).toEqual(["42", "42", "42"]);
    expect(client.lastEventId).toBe("42");
    expect(client.failed).toBe(false);
    expect(notified).not.toContain(SSEResultState.Failure);
  });

  it("never counts quiet connections that end in a bye as failures, however many there are", async () => {
    FeatureHubEventSourceClient.reconnectPolicy = {
      ...FeatureHubEventSourceClient.reconnectPolicy,
      maxAttempts: 2,
    };
    respond = (_req, res) => {
      open(res);
      later(threshold + 30, () => {
        res.write(`event: bye\ndata: {}\n\n`);
        res.end();
      });
    };

    client = new FeatureHubEventSourceClient(config, repo);
    await client.poll();

    await until(() => requests.length >= 5, 5000);
    expect(client.failed).toBe(false);
  });

  it("counts short connections as failures even with a bye, and stops after the maximum attempts", async () => {
    FeatureHubEventSourceClient.reconnectPolicy = {
      ...FeatureHubEventSourceClient.reconnectPolicy,
      maxAttempts: 3,
    };
    respond = (_req, res) => {
      // a cache replaying a closed stream: features and bye at once
      open(res);
      res.write(`id: 7\nevent: features\ndata: []\n\n`);
      res.write(`event: bye\ndata: {}\n\n`);
      res.end();
    };

    client = new FeatureHubEventSourceClient(config, repo);
    await client.poll();

    // the first connection and 3 attempts to reconnect
    await until(() => client!.failed, 5000);
    expect(requests).toHaveLength(4);
    // the features were still applied
    expect(notified.filter((s) => s === SSEResultState.Features)).toHaveLength(4);
    expect(notified[notified.length - 1]).toBe(SSEResultState.Failure);
    expect(warnings.some((w) => String(w[0]).includes("ending its event streams early"))).toBe(
      true,
    );
  });

  it("stops after the maximum attempts when the server accepts and drops every connection with no events", async () => {
    FeatureHubEventSourceClient.reconnectPolicy = {
      ...FeatureHubEventSourceClient.reconnectPolicy,
      maxAttempts: 3,
    };
    respond = (_req, res) => {
      open(res);
      later(threshold + 30, () => res.end());
    };

    client = new FeatureHubEventSourceClient(config, repo);
    await client.poll();

    await until(() => client!.failed, 5000);
    expect(requests).toHaveLength(4);
  });

  it("keeps going when every third connection shows it works", async () => {
    FeatureHubEventSourceClient.reconnectPolicy = {
      ...FeatureHubEventSourceClient.reconnectPolicy,
      maxAttempts: 3,
    };
    respond = (_req, res, n) => {
      open(res);
      if (n % 3 === 0) res.write(`event: ack\ndata: {}\n\n`);
      later(threshold + 30, () => res.end());
    };

    client = new FeatureHubEventSourceClient(config, repo);
    await client.poll();

    await until(() => requests.length >= 7, 5000);
    expect(client.failed).toBe(false);
  });

  it("does not send the old context's last event id after a context change", async () => {
    const url = config.url();
    config = Substitute.for<FeatureHubConfig>();
    config.url().returns(url);
    config.clientEvaluated().returns(false);
    respond = (_req, res) => {
      open(res);
      res.write(`id: 99\nevent: features\ndata: []\n\n`);
    };

    client = new FeatureHubEventSourceClient(config, repo);
    await client.contextChange("userkey=orm");
    await until(() => client!.lastEventId === "99");

    await client.contextChange("userkey=ling");
    await until(() => requests.length >= 2);

    expect(requests[1]!.headers["last-event-id"]).toBeUndefined();
    expect(requests[1]!.headers["x-featurehub"]).toBe("userkey=ling");
  });
});
