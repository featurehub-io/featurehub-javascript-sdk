import { createServer, type Server } from "http";
import type { AddressInfo } from "net";
import { afterEach, describe, expect, it, vi } from "vitest";

// featurehub-protocol.yaml polling_transport.interval.test_mode
const names = ["FEATUREHUB_TEST_POLLING", "FEATUREHUB_CONNECT_TYPE", "FEATUREHUB_CONNECT_INTERVAL"];
const saved = Object.fromEntries(names.map((n) => [n, process.env[n]]));

async function sdkWith(env: Record<string, string>) {
  names.forEach((n) => delete process.env[n]);
  Object.assign(process.env, env);
  vi.resetModules();
  return await import("../index");
}

describe("FEATUREHUB_TEST_POLLING", () => {
  let server: Server | undefined;

  afterEach(async () => {
    names.forEach((n) =>
      saved[n] === undefined ? delete process.env[n] : (process.env[n] = saved[n]),
    );
    vi.resetModules();
    (await import("../index")).setTestPolling(false);
    if (server) {
      server.closeAllConnections();
      await new Promise((r) => server!.close(r));
      server = undefined;
    }
  });

  it("allows FEATUREHUB_CONNECT_INTERVAL=500ms", async () => {
    const sdk = await sdkWith({
      FEATUREHUB_TEST_POLLING: "true",
      FEATUREHUB_CONNECT_TYPE: "active",
      FEATUREHUB_CONNECT_INTERVAL: "500ms",
    });

    expect(sdk.testPollingEnabled()).toBe(true);
    expect(sdk.defaultEdgeTypeProviderConfig.defaultTimeoutInMilliseconds).toBe(500);
  });

  it.each<Record<string, string>>([
    {},
    { FEATUREHUB_TEST_POLLING: "false" },
    { FEATUREHUB_TEST_POLLING: "yes" },
  ])("keeps the 5 second minimum with %j", async (env) => {
    await expect(
      sdkWith({
        ...env,
        FEATUREHUB_CONNECT_TYPE: "active",
        FEATUREHUB_CONNECT_INTERVAL: "500ms",
      }),
    ).rejects.toThrow(/5 seconds|5000ms/);
  });

  it("polls every 500ms", async () => {
    const sdk = await sdkWith({ FEATUREHUB_TEST_POLLING: "true" });
    let requests = 0;
    server = createServer((_req, res) => {
      requests++;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          features: [{ id: "c1", key: "colour", version: 1, type: "STRING", value: "green" }],
        }),
      );
    });
    await new Promise<void>((r) => server!.listen(0, "127.0.0.1", () => r()));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/features`;

    const config = sdk.featureSnapshotConfig({ url, intervalMs: 500 });
    await config.newContext().userKey("lingling").build();
    await new Promise((r) => setTimeout(r, 1300));
    config.close();

    // the first request, then one every 500ms
    expect(requests).toBeGreaterThanOrEqual(3);
  });
});
