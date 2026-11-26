import { afterEach, describe, expect, it, vi } from "vitest";

import {
  connectionFromEnvironment,
  defaultEdgeTypeProviderConfig,
  EdgeFeatureHubConfig,
  EdgeType,
  type EventSourceProvider,
  FeatureHubEventSourceClient,
  FeatureHubPollingClient,
  InvalidConfigurationError,
  parseDuration,
  PollingBase,
  type RestOptions,
  setTestPolling,
  testPollingEnabled,
  testPollingFromEnvironment,
  validatePollInterval,
  webCryptoHexHash,
} from "../index";

// featurehub-protocol.yaml polling_transport.interval.test_mode
describe("test polling", () => {
  afterEach(() => setTestPolling(false));

  it.each([
    ["true", true],
    [" TRUE ", true],
    ["True", true],
    ["false", false],
    ["yes", false],
    ["1", false],
    ["", false],
  ])("FEATUREHUB_TEST_POLLING=%j is %s", (value, on) => {
    expect(testPollingFromEnvironment({ FEATUREHUB_TEST_POLLING: value })).toBe(on);
  });

  it("is off when FEATUREHUB_TEST_POLLING is not set", () => {
    expect(testPollingFromEnvironment({})).toBe(false);
    expect(testPollingEnabled()).toBe(false);
  });

  it("allows any interval above 0, in code and in FEATUREHUB_CONNECT_INTERVAL", () => {
    setTestPolling(true);

    expect(validatePollInterval(500)).toBe(500);
    expect(validatePollInterval(1)).toBe(1);
    expect(validatePollInterval(0)).toBe(0);
    expect(() =>
      new EdgeFeatureHubConfig("http://localhost:8085", "ling*orm").restActive(500),
    ).not.toThrow();
    expect(
      connectionFromEnvironment({
        FEATUREHUB_CONNECT_TYPE: "active",
        FEATUREHUB_CONNECT_INTERVAL: "500ms",
      })?.intervalMs,
    ).toBe(500);
  });

  it("still refuses a negative interval", () => {
    setTestPolling(true);

    expect(() => validatePollInterval(-1)).toThrow(InvalidConfigurationError);
  });

  it("keeps the 5 second minimum once turned off", () => {
    setTestPolling(true);
    setTestPolling(false);

    expect(() => validatePollInterval(500)).toThrow(InvalidConfigurationError);
  });
});

describe("poll intervals", () => {
  it.each([0, 5000, 30000])("accepts %d", (ms) => {
    expect(validatePollInterval(ms)).toBe(ms);
  });

  it.each([-1, 1, 4999, Number.NaN, Number.POSITIVE_INFINITY])("rejects %d", (ms) => {
    expect(() => validatePollInterval(ms)).toThrow(InvalidConfigurationError);
  });

  it("rejects an interval under 5 seconds given in code", () => {
    const config = new EdgeFeatureHubConfig("http://localhost:8085", "ling*orm");

    expect(() => config.restActive(1000)).toThrow(InvalidConfigurationError);
    expect(() => config.restPassive(-5)).toThrow(InvalidConfigurationError);
  });

  it("takes 0 to mean poll once, rather than ignoring it", () => {
    const config = new EdgeFeatureHubConfig("http://localhost:8085", "ling*orm");

    config.restActive(0);

    expect(config.edgeSupplierTimeout).toBe(0);
  });

  describe("with no default interval", () => {
    const original = { ...defaultEdgeTypeProviderConfig };

    afterEach(() => {
      Object.assign(defaultEdgeTypeProviderConfig, original);
    });

    it("rejects polling that is given no interval in code either", () => {
      defaultEdgeTypeProviderConfig.defaultTimeoutInMilliseconds = undefined;
      defaultEdgeTypeProviderConfig.defaultEdgeProvider = EdgeType.REST_ACTIVE;
      const config = new EdgeFeatureHubConfig("http://localhost:8085", "ling*orm");

      expect(() => config.newContext()).toThrow(/FEATUREHUB_CONNECT_INTERVAL/);
    });

    it("polls at the interval given in code", () => {
      defaultEdgeTypeProviderConfig.defaultTimeoutInMilliseconds = undefined;
      const config = new EdgeFeatureHubConfig("http://localhost:8085", "ling*orm").restActive(
        30000,
      );
      config.edgeServiceProvider(() => ({
        poll: () => Promise.resolve(),
        contextChange: () => Promise.resolve(),
        clientEvaluated: () => true,
        requiresReplacementOnHeaderChange: () => false,
        close: () => {},
      }));

      expect(() => config.newContext()).not.toThrow();
      config.close();
    });
  });
});

// featurehub-protocol.yaml providers.environment_variables
describe("durations", () => {
  it.each([
    ["0", 0],
    ["0s", 0],
    ["30s", 30000],
    ["500ms", 500],
    ["1.5m", 90000],
    ["1h", 3600000],
    [" 30s ", 30000],
  ])("accepts %s", (value, ms) => {
    expect(parseDuration(value)).toBe(ms);
  });

  it.each(["30", "1.5", "1m30s", "-30s", "+30s", "30 s", "30S", "1us", ".5s", "ten"])(
    "rejects %s",
    (value) => {
      expect(parseDuration(value)).toBeUndefined();
    },
  );
});

describe("FEATUREHUB_CONNECT_TYPE and FEATUREHUB_CONNECT_INTERVAL", () => {
  it("is not consulted when neither is set, or both are empty", () => {
    expect(connectionFromEnvironment({})).toBeUndefined();
    expect(
      connectionFromEnvironment({ FEATUREHUB_CONNECT_TYPE: " ", FEATUREHUB_CONNECT_INTERVAL: "" }),
    ).toBeUndefined();
  });

  it.each([
    ["active", EdgeType.REST_ACTIVE],
    ["ACTIVE", EdgeType.REST_ACTIVE],
    [" passive ", EdgeType.REST_PASSIVE],
    ["streaming", EdgeType.STREAMING],
  ])("chooses the mode from %s", (type, edgeType) => {
    expect(
      connectionFromEnvironment({
        FEATUREHUB_CONNECT_TYPE: type,
        FEATUREHUB_CONNECT_INTERVAL: "30s",
      }),
    ).toMatchObject({ edgeType, intervalMs: 30000 });
  });

  it("gives active polling for an interval alone", () => {
    expect(connectionFromEnvironment({ FEATUREHUB_CONNECT_INTERVAL: "1.5m" })).toMatchObject({
      edgeType: EdgeType.REST_ACTIVE,
      intervalMs: 90000,
    });
  });

  it("leaves the interval to the code for active or passive polling without one", () => {
    expect(connectionFromEnvironment({ FEATUREHUB_CONNECT_TYPE: "passive" })).toMatchObject({
      edgeType: EdgeType.REST_PASSIVE,
      intervalMs: undefined,
    });
  });

  it("warns that streaming does not use the interval", () => {
    const result = connectionFromEnvironment({
      FEATUREHUB_CONNECT_TYPE: "streaming",
      FEATUREHUB_CONNECT_INTERVAL: "30s",
    });

    expect(result!.warnings).toHaveLength(1);
  });

  it("rejects any other mode", () => {
    expect(() => connectionFromEnvironment({ FEATUREHUB_CONNECT_TYPE: "kwong" })).toThrow(
      InvalidConfigurationError,
    );
  });

  it.each(["0", "0s", "5s", "30s", "5000ms", "1.5m", "1h"])(
    "accepts an interval of %s",
    (interval) => {
      expect(() =>
        connectionFromEnvironment({ FEATUREHUB_CONNECT_INTERVAL: interval }),
      ).not.toThrow();
    },
  );

  it.each(["30", "3s", "500ms", "1m30s", "-30s", "30 s", "ten"])(
    "rejects an interval of %s",
    (interval) => {
      expect(() => connectionFromEnvironment({ FEATUREHUB_CONNECT_INTERVAL: interval })).toThrow(
        InvalidConfigurationError,
      );
    },
  );
});

describe("a host with a query string", () => {
  const host = "http://localhost:8085/?region=th&apiKey=dropped&contextSha=dropped";

  it("keeps the host's own parameters and drops the SDK's", () => {
    const config = new EdgeFeatureHubConfig(host, "ling*orm");

    expect(config.getHost()).toBe("http://localhost:8085/");
    expect(config.hostQuery()).toBe("region=th");
    expect(config.url()).toBe("http://localhost:8085/features/ling*orm");
  });

  it("puts them first when polling", () => {
    const config = new EdgeFeatureHubConfig(host, "ling*orm");
    let url: string | undefined;
    const original = FeatureHubPollingClient.pollingClientProvider;
    FeatureHubPollingClient.pollingClientProvider = (_opt, u) => {
      url = u;
      return { poll: () => Promise.resolve() } as any;
    };

    new FeatureHubPollingClient(config.repository(), config, 0).poll().catch(() => {});

    FeatureHubPollingClient.pollingClientProvider = original;
    expect(url).toBe("http://localhost:8085/features?region=th&apiKey=ling*orm");
  });

  it("puts them first when streaming", async () => {
    const config = new EdgeFeatureHubConfig(host, "ling*orm");
    const urls: string[] = [];
    const original = FeatureHubEventSourceClient.eventSourceProvider;
    FeatureHubEventSourceClient.eventSourceProvider = (url) => {
      urls.push(url);
      return {
        addEventListener: () => {},
        close: () => {},
      } as unknown as ReturnType<EventSourceProvider>;
    };

    const client = new FeatureHubEventSourceClient(config, config.repository());
    await client.poll();
    client.close();

    FeatureHubEventSourceClient.eventSourceProvider = original;
    expect(urls).toEqual([
      "http://localhost:8085/features/ling*orm?region=th&contextSha=0&sdk_version=2",
    ]);
  });

  it("gives a working featureUrl", () => {
    const config = new EdgeFeatureHubConfig(host, "ling*orm");

    expect(config.restActive(30000).featureUrl()).toBe(
      "http://localhost:8085/features?region=th&apiKey=ling*orm",
    );
    expect(config.streaming().featureUrl()).toBe(
      "http://localhost:8085/features/ling*orm?region=th",
    );
  });
});

describe("an application's request changes", () => {
  class Poller extends PollingBase {
    constructor(options: RestOptions) {
      super("http://localhost/features?apiKey=ling", 0, webCryptoHexHash, options, () => {});
    }
  }

  const ok = {
    status: 200,
    ok: true,
    headers: new Map(),
    text: () => Promise.resolve("[]"),
  } as unknown as Response;

  it("cannot replace the SDK's x-featurehub header, but can add others", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(ok);
    const poller = new Poller({
      modifyRequestFunction: (req) => {
        // replacing the headers object, not just adding to it
        req.headers = {
          ...req.headers,
          "x-featurehub": "userkey=someone-else",
          "x-gateway": "chago",
        } as typeof req.headers;
      },
    });

    await poller.attributeHeader("userkey=orm");
    await poller.poll();

    expect(fetchSpy.mock.calls[0]![1]!.headers).toMatchObject({
      "x-featurehub": "userkey=orm",
      "x-gateway": "chago",
    });
    fetchSpy.mockRestore();
  });
});
