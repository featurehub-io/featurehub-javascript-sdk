import { afterEach, describe, expect, it, vi } from "vitest";

const names = [
  "FEATUREHUB_CONNECT_TYPE",
  "FEATUREHUB_CONNECT_INTERVAL",
  "FEATUREHUB_POLLING_INTERVAL",
  "FEATUREHUB_POLLING_PASSIVE",
];

async function defaultsWith(env: Record<string, string>) {
  names.forEach((n) => delete process.env[n]);
  Object.assign(process.env, env);
  vi.resetModules();

  const sdk = await import("../index");
  return { ...sdk.defaultEdgeTypeProviderConfig, EdgeType: sdk.EdgeType };
}

describe("node reads its connection defaults from the environment", () => {
  const saved = Object.fromEntries(names.map((n) => [n, process.env[n]]));

  afterEach(() => {
    names.forEach((n) =>
      saved[n] === undefined ? delete process.env[n] : (process.env[n] = saved[n]),
    );
    vi.resetModules();
  });

  it("streams by default", async () => {
    const d = await defaultsWith({});
    expect(d.defaultEdgeProvider).toBe(d.EdgeType.STREAMING);
  });

  it("polls passively at FEATUREHUB_CONNECT_INTERVAL with FEATUREHUB_CONNECT_TYPE=passive", async () => {
    const d = await defaultsWith({
      FEATUREHUB_CONNECT_TYPE: "passive",
      FEATUREHUB_CONNECT_INTERVAL: "45s",
    });
    expect(d.defaultEdgeProvider).toBe(d.EdgeType.REST_PASSIVE);
    expect(d.defaultTimeoutInMilliseconds).toBe(45000);
  });

  it("ignores the legacy variables when a new one is set", async () => {
    const d = await defaultsWith({
      FEATUREHUB_CONNECT_INTERVAL: "1m",
      FEATUREHUB_POLLING_INTERVAL: "7000",
      FEATUREHUB_POLLING_PASSIVE: "true",
    });
    expect(d.defaultEdgeProvider).toBe(d.EdgeType.REST_ACTIVE);
    expect(d.defaultTimeoutInMilliseconds).toBe(60000);
  });

  it("reads the legacy variables as before when neither new one is set", async () => {
    const d = await defaultsWith({
      FEATUREHUB_POLLING_INTERVAL: "7000",
      FEATUREHUB_POLLING_PASSIVE: "true",
    });
    expect(d.defaultEdgeProvider).toBe(d.EdgeType.REST_PASSIVE);
    expect(d.defaultTimeoutInMilliseconds).toBe(7000);
  });

  it("refuses an invalid FEATUREHUB_CONNECT_INTERVAL", async () => {
    await expect(defaultsWith({ FEATUREHUB_CONNECT_INTERVAL: "3s" })).rejects.toThrow(
      /FEATUREHUB_CONNECT_INTERVAL/,
    );
  });
});

describe("the legacy FEATUREHUB_POLLING_INTERVAL", () => {
  const saved = Object.fromEntries(names.map((n) => [n, process.env[n]]));

  afterEach(() => {
    names.forEach((n) =>
      saved[n] === undefined ? delete process.env[n] : (process.env[n] = saved[n]),
    );
    vi.resetModules();
  });

  it.each([
    ["7000", 7000],
    ["3s", 3000],
    ["5s", 5000],
    ["1.5m", 90000],
    [" 30s ", 30000],
  ])("reads %s as %d milliseconds", async (value, ms) => {
    const { legacyPollingIntervalMs } = await import("../environment");
    expect(legacyPollingIntervalMs(value)).toBe(ms);
  });

  it("uses a value with a unit as that duration, not as milliseconds", async () => {
    const d = await defaultsWith({ FEATUREHUB_POLLING_INTERVAL: "5s" });
    expect(d.defaultEdgeProvider).toBe(d.EdgeType.REST_ACTIVE);
    expect(d.defaultTimeoutInMilliseconds).toBe(5000);
  });

  it("refuses a value that is neither milliseconds nor a duration", async () => {
    await expect(defaultsWith({ FEATUREHUB_POLLING_INTERVAL: "5 seconds" })).rejects.toThrow(
      /FEATUREHUB_POLLING_INTERVAL/,
    );
  });

  it("gives tests the interval from either variable", async () => {
    const { pollingIntervalFromEnvironment } = await import("../environment");

    expect(pollingIntervalFromEnvironment({ FEATUREHUB_POLLING_INTERVAL: "5s" })).toBe(5000);
    expect(
      pollingIntervalFromEnvironment({
        FEATUREHUB_CONNECT_INTERVAL: "1m",
        FEATUREHUB_POLLING_INTERVAL: "5s",
      }),
    ).toBe(60000);
    expect(pollingIntervalFromEnvironment({})).toBeUndefined();
  });
});
