import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  configExtraHeaders,
  EdgeFeatureHubConfig,
  type EventSourceProvider,
  FeatureHubEventSourceClient,
  FeatureHubPollingClient,
  fhLog,
  type InternalFeatureRepository,
  PollingBase,
  type RestOptions,
  webCryptoHexHash,
} from "../index";

class Poller extends PollingBase {
  constructor(url: string, frequency: number, options: RestOptions) {
    super(url, frequency, webCryptoHexHash, options, () => {});
  }
}

const ok = () =>
  ({
    status: 200,
    ok: true,
    headers: new Map(),
    text: () => Promise.resolve("[]"),
  }) as unknown as Response;

describe("extra headers", () => {
  let fetchSpy: any;
  const originalPolling = FeatureHubPollingClient.pollingClientProvider;

  beforeEach(() => {
    FeatureHubPollingClient.pollingClientProvider = (opt, url, freq) => new Poller(url, freq, opt);
  });

  afterEach(() => {
    FeatureHubPollingClient.pollingClientProvider = originalPolling;
    fetchSpy?.mockRestore();
  });

  const sentHeaders = (call: number) =>
    fetchSpy.mock.calls[call][1].headers as Record<string, string>;

  it("are sent with every poll", async () => {
    fetchSpy = vi.spyOn(global, "fetch").mockImplementation(() => Promise.resolve(ok()));
    const config = new EdgeFeatureHubConfig("http://localhost:8085", "ling*orm").headers({
      "x-gateway-key": "omu-and-co",
    });

    const client = new FeatureHubPollingClient(
      config.repository() as InternalFeatureRepository,
      config,
      0,
    );
    await client.poll();
    await client.poll();

    expect(sentHeaders(0)).toMatchObject({ "x-gateway-key": "omu-and-co" });
    expect(sentHeaders(1)).toMatchObject({ "x-gateway-key": "omu-and-co" });
  });

  it("can be a function, called for each request, so a rotating token stays current", async () => {
    fetchSpy = vi.spyOn(global, "fetch").mockImplementation(() => Promise.resolve(ok()));
    let token = 0;
    const config = new EdgeFeatureHubConfig("http://localhost:8085", "ling*orm").headers(() => ({
      authorization: `Bearer token-${++token}`,
    }));

    const client = new FeatureHubPollingClient(
      config.repository() as InternalFeatureRepository,
      config,
      0,
    );
    await client.poll();
    await client.poll();

    expect(sentHeaders(0)["authorization"]).toBe("Bearer token-1");
    expect(sentHeaders(1)["authorization"]).toBe("Bearer token-2");
  });

  it("never replace the SDK's own headers, whatever their case", async () => {
    const config = new EdgeFeatureHubConfig("http://localhost:8085", "kornaphat").headers({
      "X-FeatureHub": "userkey=someone-else",
      "IF-NONE-MATCH": "an-old-etag",
      "last-event-id": "1",
      "x-trace": "sirilak",
    });

    expect(configExtraHeaders(config)).toEqual({ "x-trace": "sirilak" });
  });

  it("send nothing, with an error logged, if the function fails", () => {
    const errors: unknown[] = [];
    const originalError = fhLog.error;
    fhLog.error = (...args: unknown[]) => errors.push(args);

    const config = new EdgeFeatureHubConfig("http://localhost:8085", "ling*orm").headers(() => {
      throw new Error("no token yet");
    });

    expect(configExtraHeaders(config)).toEqual({});
    expect(errors).toHaveLength(1);
    fhLog.error = originalError;
  });

  describe("when streaming", () => {
    let dicts: Array<Record<string, string> | undefined>;
    let warnings: unknown[][];
    const originalProvider = FeatureHubEventSourceClient.eventSourceProvider;
    const originalManages = FeatureHubEventSourceClient.sdkManagesReconnection;
    const originalWarn = fhLog.warn;

    beforeEach(() => {
      dicts = [];
      warnings = [];
      fhLog.warn = (...args: unknown[]) => warnings.push(args);
      FeatureHubEventSourceClient.eventSourceProvider = (_url, dict) => {
        dicts.push(dict?.headers as Record<string, string> | undefined);
        return {
          addEventListener: () => {},
          close: () => {},
        } as unknown as ReturnType<EventSourceProvider>;
      };
    });

    afterEach(() => {
      fhLog.warn = originalWarn;
      FeatureHubEventSourceClient.eventSourceProvider = originalProvider;
      FeatureHubEventSourceClient.sdkManagesReconnection = originalManages;
    });

    it("are given to the event source, with the SDK's context winning", async () => {
      FeatureHubEventSourceClient.sdkManagesReconnection = true; // as in Node
      const config = new EdgeFeatureHubConfig("http://localhost:8085", "kwong").headers({
        "x-gateway-key": "always-wonder",
        "x-featurehub": "userkey=someone-else",
      });

      const client = new FeatureHubEventSourceClient(
        config,
        config.repository() as InternalFeatureRepository,
      );
      await client.contextChange("userkey=orm");
      client.close();

      expect(dicts[0]).toEqual({ "x-gateway-key": "always-wonder", "x-featurehub": "userkey=orm" });
      expect(warnings).toEqual([]);
    });

    it("warn once in a browser, whose EventSource cannot send them", async () => {
      FeatureHubEventSourceClient.sdkManagesReconnection = false;
      const config = new EdgeFeatureHubConfig("http://localhost:8085", "ling*orm").headers({
        "x-gateway-key": "keep-silent",
      });

      const client = new FeatureHubEventSourceClient(
        config,
        config.repository() as InternalFeatureRepository,
      );
      await client.poll();
      client.close();
      await client.poll();
      client.close();

      expect(warnings).toHaveLength(1);
      expect(String(warnings[0]![0])).toContain("cannot send headers");
    });
  });
});
