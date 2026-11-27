import { Substitute, type SubstituteOf } from "@fluffy-spoon/substitute";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  contextSha,
  type CryptoProvider,
  type FeatureEnvironmentCollection,
  type FeatureHubConfig,
  FeatureHubPollingClient,
  type FeaturesFunction,
  type InternalFeatureRepository,
  PollingBase,
  PollingError,
  type RestOptions,
  setTestPolling,
  SSEResultState,
  webCryptoHexHash,
} from "../index";

class TestPoller extends PollingBase {
  public preloadAborts = false;

  constructor(frequency: number, callback: FeaturesFunction, options: RestOptions = {}) {
    super(
      "http://localhost/features?apiKey=ling",
      frequency,
      webCryptoHexHash as CryptoProvider,
      options,
      callback,
    );
  }

  override async preload(): Promise<boolean> {
    return this.preloadAborts;
  }
}

const response = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  ({
    status,
    ok: status >= 200 && status < 300,
    statusText: `status ${status}`,
    headers: new Map(Object.entries(headers)),
    text: () => Promise.resolve(typeof body === "string" ? body : JSON.stringify(body)),
  }) as unknown as Response;

const orm = { id: "orm-id", key: "orm", version: 1, type: "BOOLEAN", value: true, l: false };
const ling = { id: "ling-id", key: "ling", version: 2, type: "STRING", value: "kwong", l: false };

describe("polling follows the FeatureHub protocol", () => {
  let fetchSpy: any;
  let delivered: Array<FeatureEnvironmentCollection[]>;
  const callback: FeaturesFunction = (e) => delivered.push(e);

  beforeEach(() => {
    delivered = [];
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
  });

  describe("PollingBase", () => {
    it("is not left busy when preload aborts the request, so later polls still go out", async () => {
      const poller = new TestPoller(10, callback);
      fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(response(200, []));

      poller.preloadAborts = true;
      await poller.poll();
      expect(poller.busy).toBe(false);

      poller.preloadAborts = false;
      await poller.poll();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    const env = (id: string, pollInterval?: unknown) =>
      pollInterval === undefined ? { id, features: [] } : { id, features: [], pollInterval };

    // featurehub-protocol.yaml featurehub_edge.polling.poll_interval examples, with 60s configured
    it.each([
      ["shorter than configured", [30], 30000],
      ["longer than configured is honoured", [120], 120000],
      ["several environments: the smallest", [45, 20, null], 20000],
      ["below 5 is ignored", [3, 40], 40000],
      ["5 itself is used: it is the minimum interval", [5], 5000],
      ["4 is ignored, 5 is used", [4, 5], 5000],
      ["a fraction is not a whole number, so is ignored", [7.5], 60000],
      ["a string is ignored", ["30"], 60000],
    ])("applies a pollInterval: %s", async (_name, intervals, expected) => {
      const poller = new TestPoller(60000, callback);
      fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
        response(
          200,
          (intervals as unknown[]).map((i, n) => env(`orm${n}`, i)),
        ),
      );

      await poller.poll();

      expect(poller.frequency).toBe(expected);
    });

    // polling_transport.interval.test_mode: a pollInterval of at least 1 second is used
    it("uses a pollInterval of 1 second in test mode", async () => {
      setTestPolling(true);
      try {
        const poller = new TestPoller(60000, callback);
        fetchSpy = vi
          .spyOn(global, "fetch")
          .mockResolvedValue(response(200, [env("kwong", 1), env("orm", 0)]));

        await poller.poll();

        expect(poller.frequency).toBe(1000);
      } finally {
        setTestPolling(false);
      }
    });

    it("returns to the configured interval when a full response has no pollInterval", async () => {
      const poller = new TestPoller(60000, callback);
      fetchSpy = vi.spyOn(global, "fetch");

      fetchSpy.mockResolvedValueOnce(response(200, [env("ling", 30)]));
      await poller.poll();
      expect(poller.frequency).toBe(30000);

      fetchSpy.mockResolvedValueOnce(response(200, [env("ling")]));
      await poller.poll();
      expect(poller.frequency).toBe(60000);
    });

    it("reads pollInterval only from a 200 or 236 body, never a 304 or an error", async () => {
      const poller = new TestPoller(60000, callback);
      fetchSpy = vi.spyOn(global, "fetch");

      fetchSpy.mockResolvedValueOnce(response(200, [env("ling", 30)]));
      await poller.poll();
      expect(poller.frequency).toBe(30000);

      fetchSpy.mockResolvedValueOnce(response(304, ""));
      await poller.poll();
      expect(poller.frequency).toBe(30000);

      fetchSpy.mockResolvedValueOnce(response(503, JSON.stringify([env("ling", 5)])));
      await poller.poll().catch(() => {});
      expect(poller.frequency).toBe(30000);

      fetchSpy.mockResolvedValueOnce(response(236, [env("ling", 45)]));
      await poller.poll();
      expect(poller.frequency).toBe(45000);
    });

    it("never reads Cache-Control max-age", async () => {
      const poller = new TestPoller(60000, callback);
      fetchSpy = vi
        .spyOn(global, "fetch")
        .mockResolvedValue(response(200, [env("ling")], { "cache-control": "max-age=10" }));

      await poller.poll();

      expect(poller.frequency).toBe(60000);
    });

    it("does not let a pollInterval start polling when the interval is 0 (poll once)", async () => {
      const poller = new TestPoller(0, callback);
      fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(response(200, [env("ling", 60)]));

      await poller.poll();

      expect(poller.frequency).toBe(0);
    });

    it.each([
      ["a single environment that is not wrapped in an array", { id: "e1", features: [] }],
      ["an array holding something other than environments", ["e1"]],
      ["an environment whose features is not an array", [{ id: "e1", features: { key: "f1" } }]],
      ["something that is not JSON", "<html>keep silent</html>"],
    ])("rejects %s, delivering nothing", async (_name, body) => {
      const poller = new TestPoller(10, callback);
      fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(response(200, body));

      await expect(poller.poll()).rejects.toThrow();

      expect(delivered).toEqual([]);
      expect(poller.busy).toBe(false);
    });

    it("treats absent or null features as none and skips null environments", async () => {
      const poller = new TestPoller(10, callback);
      fetchSpy = vi
        .spyOn(global, "fetch")
        .mockResolvedValue(response(200, [{ id: "e1" }, null, { id: "e2", features: null }]));

      await poller.poll();

      expect(delivered).toEqual([
        [
          { id: "e1", features: [] },
          { id: "e2", features: [] },
        ],
      ]);
    });

    it("fetches again for a new context when it changes while a request is in flight", async () => {
      const poller = new TestPoller(10, callback);
      let hold: ((r: Response) => void) | undefined;
      fetchSpy = vi
        .spyOn(global, "fetch")
        .mockImplementationOnce(() => new Promise<Response>((resolve) => (hold = resolve)))
        .mockResolvedValueOnce(response(200, [{ id: "e1", features: [ling] }]));

      await poller.attributeHeader("userkey=orm");
      const forOrm = poller.poll();
      await new Promise((r) => setTimeout(r, 5));

      await poller.attributeHeader("userkey=ling");
      const forLing = poller.poll(); // queued behind the request for orm

      hold!(response(200, [{ id: "e1", features: [orm] }]));
      await Promise.all([forOrm, forLing]);

      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(fetchSpy.mock.calls[1][0]).toContain(`contextSha=${await contextSha("userkey=ling")}`);
      // the response for the old context is not applied
      expect(delivered).toEqual([[{ id: "e1", features: [ling] }]]);
    });

    it("rejects an HTTP error with a PollingError carrying its status", async () => {
      const poller = new TestPoller(10, callback);
      fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(response(401, ""));

      const failure = await poller.poll().catch((e) => e);

      expect(failure).toBeInstanceOf(PollingError);
      expect((failure as PollingError).status).toBe(401);
    });
  });

  describe("FeatureHubPollingClient", () => {
    let repo: SubstituteOf<InternalFeatureRepository>;
    let config: SubstituteOf<FeatureHubConfig>;
    const originalProvider = FeatureHubPollingClient.pollingClientProvider;

    beforeEach(() => {
      repo = Substitute.for<InternalFeatureRepository>();
      config = Substitute.for<FeatureHubConfig>();
      config.getHost().returns("http://localhost/");
      config.getApiKeys().returns(["ling"]);
      config.clientEvaluated().returns(true);
      FeatureHubPollingClient.pollingClientProvider = (opt, _url, freq, cb) =>
        new TestPoller(freq, cb, opt);
    });

    afterEach(() => {
      FeatureHubPollingClient.pollingClientProvider = originalProvider;
    });

    it.each([400, 401, 403, 404, 429])("stops polling for good on a %d", async (status) => {
      const client = new FeatureHubPollingClient(repo, config, 0);
      fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(response(status, ""));

      await client.poll().catch(() => {});

      repo.received(1).notify(SSEResultState.Failure, null, "polling-service");
      expect(client.canStart).toBe(false);

      await client.poll().catch(() => {});
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("keeps polling after a 5xx", async () => {
      const client = new FeatureHubPollingClient(repo, config, 0);
      fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(response(503, ""));

      await client.poll().catch(() => {});

      repo.didNotReceive().notify(SSEResultState.Failure, null, "polling-service");
      expect(client.canStart).toBe(true);
      client.close();
    });

    it("polls passively only once when the interval is 0, however many evaluations follow", async () => {
      const client = new FeatureHubPollingClient(repo, config, 0, { active: false });
      fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(response(200, []));

      await client.poll();
      await new Promise((r) => setTimeout(r, 5));
      await client.poll(true);
      await client.poll(true);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("gives an empty list of environments to the repository as a full set with no features", async () => {
      const client = new FeatureHubPollingClient(repo, config, 0);
      fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(response(200, []));

      await client.poll();

      repo.received(1).notify(SSEResultState.Features, [], "polling-service");
      repo.didNotReceive().notify(SSEResultState.Failure, null, "polling-service");
      expect(client.canStart).toBe(true);
    });

    it("gives the features of every environment to the repository as one full set", async () => {
      const client = new FeatureHubPollingClient(repo, config, 0);
      fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
        response(200, [
          { id: "e1", features: [orm] },
          { id: "e2", features: [ling] },
        ]),
      );

      await client.poll();

      repo.received(1).notify(
        SSEResultState.Features,
        [
          { ...orm, environmentId: "e1" },
          { ...ling, environmentId: "e2" },
        ],
        "polling-service",
      );
    });
  });
});

describe("a 236 marks the environment stale", () => {
  const originalProvider = FeatureHubPollingClient.pollingClientProvider;
  let fetchSpy: any;

  afterEach(() => {
    FeatureHubPollingClient.pollingClientProvider = originalProvider;
    fetchSpy?.mockRestore();
  });

  it("applies the 236's features, marks the environment stale and polls no more", async () => {
    const repo = Substitute.for<InternalFeatureRepository>();
    const config = Substitute.for<FeatureHubConfig>();
    config.getHost().returns("http://localhost/");
    config.getApiKeys().returns(["ling"]);
    FeatureHubPollingClient.pollingClientProvider = (opt, _url, freq, cb) =>
      new TestPoller(freq, cb, opt);
    fetchSpy = vi
      .spyOn(global, "fetch")
      .mockResolvedValue(response(236, [{ id: "e1", features: [orm] }]));

    const client = new FeatureHubPollingClient(repo, config, 10);
    await client.poll();
    await new Promise((r) => setTimeout(r, 50));

    repo
      .received(1)
      .notify(SSEResultState.Features, [{ ...orm, environmentId: "e1" }], "polling-service");
    repo.received(1).markEnvironmentStale();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(client.isTimerSet).toBe(false);
    client.close();
  });
});

// featurehub-protocol.yaml conformance polling-context-change-after-close
describe("a context change on a closed polling client", () => {
  const originalProvider = FeatureHubPollingClient.pollingClientProvider;
  let fetchSpy: any;

  afterEach(() => {
    FeatureHubPollingClient.pollingClientProvider = originalProvider;
    fetchSpy?.mockRestore();
  });

  const setup = (repoState: { connectionFailed?: boolean; environmentStale?: boolean } = {}) => {
    const repo = Substitute.for<InternalFeatureRepository>();
    repo.connectionFailed.returns!(repoState.connectionFailed ?? false);
    repo.environmentStale.returns!(repoState.environmentStale ?? false);
    const config = Substitute.for<FeatureHubConfig>();
    config.getHost().returns("http://localhost/");
    config.getApiKeys().returns(["kwong"]);
    config.clientEvaluated().returns(false);
    FeatureHubPollingClient.pollingClientProvider = (opt, _url, freq, cb) =>
      new TestPoller(freq, cb, opt);
    return { repo, client: new FeatureHubPollingClient(repo, config, 5000) };
  };

  it("makes exactly one request, applies its features and does not start polling again", async () => {
    const { repo, client } = setup();
    fetchSpy = vi
      .spyOn(global, "fetch")
      .mockResolvedValue(response(200, [{ id: "e1", features: [ling] }]));

    client.close();
    await client.contextChange("userkey=lingling");
    await new Promise((r) => setTimeout(r, 30));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][1].headers["x-featurehub"]).toBe("userkey=lingling");
    repo
      .received(1)
      .notify(SSEResultState.Features, [{ ...ling, environmentId: "e1" }], "polling-service");
    expect(client.isTimerSet).toBe(false);
  });

  it.each([{ connectionFailed: true }, { environmentStale: true }])(
    "makes no request once nothing more can be fetched (%o)",
    async (state) => {
      const { client } = setup(state);
      fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(response(200, []));

      client.close();
      await client.contextChange("userkey=orm");

      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );
});
