import { ErrorCode, OpenFeature, ProviderEvents, ProviderStatus } from "@openfeature/server-sdk";
import {
  DefaultUsagePlugin,
  EdgeFeatureHubConfig,
  type EdgeService,
  EdgeType,
  type FeatureRolloutStrategy,
  type FeatureState,
  FeatureValueType,
  type InternalFeatureRepository,
  SSEResultState,
  type UsageEvent,
} from "featurehub-javascript-node-sdk";
import { afterEach, describe, expect, it } from "vitest";

import { FeatureHubProvider } from "../provider";

// The provider against the real OpenFeature server SDK and the real FeatureHub SDK, with an edge service
// that answers each context's request from a script, so the repository's protocol behaviour
// (featurehub-protocol.yaml repository, providers.events) reaches OpenFeature as it would from Edge.

type Answer =
  | Array<FeatureState>
  | "fail"
  | { features: Array<FeatureState>; then: "stale" | "fail" }
  /** Edge answers once `after` settles (never, if it never does) */
  | { features: Array<FeatureState>; after: Promise<unknown> };

class ScriptedEdge implements EdgeService {
  readonly headers: string[] = [];

  constructor(
    private readonly repo: InternalFeatureRepository,
    private readonly answers: Record<string, Answer>,
  ) {}

  async contextChange(header: string): Promise<void> {
    this.headers.push(header);
    const answer = this.answers[header];
    if (answer === undefined) return;

    if (!Array.isArray(answer) && typeof answer === "object" && "after" in answer) {
      await answer.after;
      this.repo.notify(SSEResultState.Features, answer.features, "test");
    } else if (answer === "fail") {
      this.repo.notify(SSEResultState.Failure, null, "test");
    } else if (Array.isArray(answer)) {
      this.repo.notify(SSEResultState.Features, answer, "test");
    } else {
      this.repo.notify(SSEResultState.Features, answer.features, "test");
      if (answer.then === "stale") this.repo.markEnvironmentStale();
      else this.repo.notify(SSEResultState.Failure, null, "test");
    }
  }

  clientEvaluated(): boolean {
    return false;
  }

  requiresReplacementOnHeaderChange(): boolean {
    return false;
  }

  close(): void {}

  poll(): Promise<void> {
    return Promise.resolve();
  }
}

const feature = (
  key: string,
  value: string | null,
  version = 1,
  extra: Partial<FeatureState> = {},
): FeatureState =>
  ({
    id: `${key}-id`,
    key,
    version,
    type: FeatureValueType.String,
    value,
    l: false,
    ...extra,
  }) as FeatureState;

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

let domainCount = 0;

function setup(answers: Record<string, Answer>) {
  const domain = `kwong-pastry-${++domainCount}`;
  let config: EdgeFeatureHubConfig | undefined;

  const provider = new FeatureHubProvider({
    host: "http://localhost:8085",
    // server-evaluated: each OpenFeature context is a context change in the repository
    apiKey: "default/env-ling/lingorm",
    waitForReadyMs: 1000,
    configFactory: (options) => {
      config = new EdgeFeatureHubConfig(options.host, options.apiKey);
      config.edgeServiceProvider((repo) => new ScriptedEdge(repo, answers));
      return config;
    },
  });

  const client = OpenFeature.getClient(domain);
  const events: string[] = [];
  const changed: string[] = [];
  for (const event of [
    ProviderEvents.Ready,
    ProviderEvents.Stale,
    ProviderEvents.Error,
    ProviderEvents.ConfigurationChanged,
  ]) {
    client.addHandler(event, (details) => {
      events.push(event);
      if (event === ProviderEvents.ConfigurationChanged) {
        changed.push(...((details as { flagsChanged?: string[] } | undefined)?.flagsChanged ?? []));
      }
    });
  }

  return {
    domain,
    provider,
    client,
    events,
    changed,
    repo: () => config!.repository(),
    config: () => config,
    start: () => OpenFeature.setProviderAndWait(domain, provider),
  };
}

describe("FeatureHubProvider against the FeatureHub SDK's protocol behaviour", () => {
  afterEach(async () => {
    await OpenFeature.clearProviders();
  });

  it("follows a context change with no further lifecycle event", async () => {
    const t = setup({
      "": [feature("kwong_pastry", "omu&co")],
      "userkey=lingling": [feature("kwong_pastry", "keep silent")],
    });
    await t.start();

    const details = await t.client.getStringDetails("kwong_pastry", "chago", {
      targetingKey: "lingling",
    });

    expect(details.value).toBe("keep silent");
    expect(details.errorCode).toBeUndefined();
    await tick();
    // the context change went Ready -> Stale -> Ready: not a new READY
    expect(t.events).toEqual([ProviderEvents.Ready]);
  });

  it("goes STALE once when the connection fails after features, still resolving the last ones", async () => {
    const t = setup({ "": [feature("kwong_pastry", "omu&co")] });
    await t.start();

    t.repo().notify(SSEResultState.Failure, null, "test");
    t.repo().notify(SSEResultState.Failure, null, "test");
    await tick();

    expect(t.events).toEqual([ProviderEvents.Ready, ProviderEvents.Stale]);
    expect(t.client.providerStatus).toBe(ProviderStatus.STALE);
    const details = await t.client.getStringDetails("kwong_pastry", "chago");
    expect(details.value).toBe("omu&co");
    expect(details.errorCode).toBeUndefined();
  });

  it("goes STALE when a context change is answered by a failure, and does not give the old context's values", async () => {
    const t = setup({ "": [feature("kwong_pastry", "omu&co")], "userkey=orm": "fail" });
    await t.start();

    const details = await t.client.getStringDetails("kwong_pastry", "chago", {
      targetingKey: "orm",
    });
    await tick();

    // readiness was already Stale for the context change: only the connection event tells it
    expect(t.events).toEqual([ProviderEvents.Ready, ProviderEvents.Stale]);
    // the features held are the empty context's, not orm's
    expect(details.value).toBe("chago");
    expect(details.errorCode).toBe(ErrorCode.GENERAL);
    expect(details.errorMessage).toContain("could not fetch the features for the new context");

    // nor on a later resolution for the same context
    const again = await t.client.getStringDetails("kwong_pastry", "chago", { targetingKey: "orm" });
    expect(again.value).toBe("chago");
    expect(again.errorCode).toBe(ErrorCode.GENERAL);
  });

  it("refuses a different context while another context's resolution is in progress", async () => {
    let answer: (value?: unknown) => void = () => {};
    const after = new Promise((resolve) => (answer = resolve));
    const t = setup({
      "": [feature("kwong_pastry", "omu&co")],
      "userkey=lingling": { features: [feature("kwong_pastry", "always wonder")], after },
      "userkey=orm": [feature("kwong_pastry", "keep silent")],
    });
    await t.start();

    const lingling = t.client.getStringDetails("kwong_pastry", "chago", {
      targetingKey: "lingling",
    });
    const sameContext = t.client.getStringDetails("kwong_pastry", "chago", {
      targetingKey: "lingling",
    });
    await tick();
    const orm = await t.client.getStringDetails("kwong_pastry", "chago", { targetingKey: "orm" });

    expect(orm.value).toBe("chago");
    expect(orm.errorCode).toBe(ErrorCode.INVALID_CONTEXT);
    expect(orm.errorMessage).toContain("server-evaluated");

    answer();
    expect((await lingling).value).toBe("always wonder");
    expect((await sameContext).value).toBe("always wonder");

    // once nothing is in progress, the context may change
    const later = await t.client.getStringDetails("kwong_pastry", "chago", { targetingKey: "orm" });
    expect(later.value).toBe("keep silent");
    expect(later.errorCode).toBeUndefined();
  });

  it("fails initialisation on an initial context it cannot send, leaving no connection behind", async () => {
    const t = setup({ "": [feature("kwong_pastry", "omu&co")] });
    OpenFeature.setContext({ targetingKey: "lingling", shop: { name: "omu&co" } as never });

    try {
      await expect(t.start()).rejects.toThrow("shop");
      const config = t.config();
      expect(config === undefined || config.isClosed).toBe(true);
    } finally {
      await OpenFeature.setContext({});
    }
  });

  it("fails initialisation within waitForReadyMs when the initial context is never answered", async () => {
    const t = setup({ "": { features: [], after: new Promise(() => {}) } });
    const started = Date.now();

    await expect(t.start()).rejects.toThrow("did not become ready");

    expect(Date.now() - started).toBeLessThan(2500);
  });

  it("initialises when the environment goes stale with the first features, then goes STALE", async () => {
    const t = setup({ "": { features: [feature("kwong_pastry", "omu&co")], then: "stale" } });

    await t.start();
    await tick();

    expect(t.events).toEqual([ProviderEvents.Ready, ProviderEvents.Stale]);
    expect(t.client.providerStatus).toBe(ProviderStatus.STALE);
    expect(await t.client.getStringValue("kwong_pastry", "chago")).toBe("omu&co");
  });

  it("fails as fatal when the connection is rejected before any features", async () => {
    const t = setup({ "": "fail" });

    await expect(t.start()).rejects.toThrow();

    expect(t.client.providerStatus).toBe(ProviderStatus.FATAL);
    const details = await t.client.getStringDetails("kwong_pastry", "chago");
    expect(details.value).toBe("chago");
    expect(details.errorCode).toBe(ErrorCode.PROVIDER_FATAL);
  });

  it("reports a feature a later full set no longer holds as changed", async () => {
    const t = setup({
      "": [feature("kwong_pastry", "omu&co"), feature("always_wonder", "ormkorn")],
    });
    await t.start();

    t.repo().notify(SSEResultState.Features, [feature("kwong_pastry", "omu&co")], "test");
    await tick();

    expect(t.changed).toEqual(["always_wonder"]);
  });

  it("reports the strategy the server applied (v) as TARGETING_MATCH, with the properties as metadata", async () => {
    const t = setup({
      "": [feature("kwong_pastry", "plain")],
      "userkey=lingling": [
        feature("kwong_pastry", "mango", 4, { v: "chago", fp: { shop: "omu&co" } }),
        feature("always_wonder", null, 2, { v: "ormkorn" }),
      ],
    });
    await t.start();

    const targeted = await t.client.getStringDetails("kwong_pastry", "plain", {
      targetingKey: "lingling",
    });
    expect(targeted).toMatchObject({ value: "mango", reason: "TARGETING_MATCH", variant: "chago" });
    expect(targeted.flagMetadata).toEqual({
      shop: "omu&co",
      featureVersion: 4,
      featureType: "STRING",
    });

    const disabled = await t.client.getStringDetails("always_wonder", "keep silent", {
      targetingKey: "lingling",
    });
    expect(disabled).toMatchObject({
      value: "keep silent",
      reason: "DISABLED",
      variant: "ormkorn",
    });
  });

  it("sends session as session, and a date-time as UTC to the second, for a server-evaluated key", async () => {
    const header = "session=s1,signedUp=2026-11-17T02%3A47%3A28Z,userkey=lingling";
    const t = setup({
      "": [feature("kwong_pastry", "plain")],
      [header]: [feature("kwong_pastry", "mango", 2, { v: "chago" })],
    });
    await t.start();

    const details = await t.client.getStringDetails("kwong_pastry", "plain", {
      targetingKey: "lingling",
      session: "s1",
      signedUp: new Date("2026-11-17T02:47:28.456Z"),
    });

    expect(details).toMatchObject({ value: "mango", reason: "TARGETING_MATCH", variant: "chago" });
  });
});

// featurehub-protocol.yaml providers.environment_variables, source_selection and local_evaluation_rule, and
// OpenFeature tracking as FeatureHub named usage
describe("FeatureHubProvider configuration and tracking", () => {
  const saved = { ...process.env };

  afterEach(async () => {
    process.env = { ...saved };
    await OpenFeature.clearProviders();
  });

  // never connects anywhere
  const offline = (config: EdgeFeatureHubConfig) => {
    config.edgeServiceProvider((repo) => new ScriptedEdge(repo, {}));
    return config;
  };

  const clearEnvironment = () => {
    delete process.env["FEATUREHUB_EDGE_URL"];
    delete process.env["FEATUREHUB_CLIENT_API_KEY"];
    delete process.env["FEATUREHUB_SERVER_API_KEY"];
  };

  it("takes the host and API key from the environment when they are not given in code", async () => {
    clearEnvironment();
    process.env["FEATUREHUB_EDGE_URL"] = " http://edge.example.com ";
    process.env["FEATUREHUB_CLIENT_API_KEY"] = "";
    process.env["FEATUREHUB_SERVER_API_KEY"] = "default/env-ling/kwong";

    let seen: { host?: string | undefined; apiKey?: string | undefined } = {};
    const provider = new FeatureHubProvider({
      waitForReadyMs: 50,
      configFactory: (options) => {
        seen = { host: options.host, apiKey: options.apiKey };
        return offline(new EdgeFeatureHubConfig(options.host, options.apiKey));
      },
    });
    // the offline edge sends no features, so initialisation times out
    await provider.initialize().catch(() => {});
    await provider.onClose();

    // an empty variable counts as not set, so the server key is used
    expect(seen).toEqual({ host: "http://edge.example.com", apiKey: "default/env-ling/kwong" });
  });

  it("lets code win over the environment, setting by setting", async () => {
    clearEnvironment();
    process.env["FEATUREHUB_EDGE_URL"] = "http://edge.example.com";
    process.env["FEATUREHUB_CLIENT_API_KEY"] = "default/env-ling/orm*key";

    let seen: { host?: string | undefined; apiKey?: string | undefined } = {};
    const provider = new FeatureHubProvider({
      apiKey: "default/env-ling/kornaphat",
      waitForReadyMs: 50,
      configFactory: (options) => {
        seen = { host: options.host, apiKey: options.apiKey };
        return offline(new EdgeFeatureHubConfig(options.host, options.apiKey));
      },
    });
    await provider.initialize().catch(() => {});
    await provider.onClose();

    expect(seen).toEqual({ host: "http://edge.example.com", apiKey: "default/env-ling/kornaphat" });
  });

  it("refuses only one of host and API key, and nothing at all without a configFactory", () => {
    clearEnvironment();

    expect(() => new FeatureHubProvider({ host: "http://edge.example.com" })).toThrow(/both/);
    expect(() => new FeatureHubProvider({})).toThrow(/configFactory/);
  });

  it("keeps the config's own mode when no transport option is given (the node SDK's, from the environment)", async () => {
    let config: EdgeFeatureHubConfig | undefined;
    const factory = (restActive: boolean) => (options: { host?: string; apiKey?: string }) => {
      config = new EdgeFeatureHubConfig(options.host, options.apiKey);
      if (restActive) config.restActive(30000);
      config.edgeServiceProvider((repo) => new ScriptedEdge(repo, { "": [feature("a", "b")] }));
      return config;
    };

    await new FeatureHubProvider({
      host: "http://localhost:8085",
      apiKey: "default/env-ling/lingorm",
      configFactory: factory(true),
    }).initialize();
    expect(config!.edgeType).toBe(EdgeType.REST_ACTIVE);

    await new FeatureHubProvider({
      host: "http://localhost:8085",
      apiKey: "default/env-ling/lingorm",
      transport: "streaming",
      configFactory: factory(true),
    }).initialize();
    expect(config!.edgeType).toBe(EdgeType.STREAMING);
  });

  it("runs from stores alone, evaluating each context locally", async () => {
    clearEnvironment();
    const strategies = [
      {
        id: "chago",
        value: "mango",
        attributes: [
          { conditional: "EQUALS", fieldName: "country", type: "STRING", values: ["nz"] },
        ],
      },
    ] as unknown as FeatureRolloutStrategy[];

    await OpenFeature.setProviderAndWait(
      "stores-only",
      new FeatureHubProvider({
        configFactory: () => {
          const config = new EdgeFeatureHubConfig();
          // as a feature store would load them
          config
            .repository()
            .notify(
              SSEResultState.Features,
              [{ ...feature("kwong_pastry", "plain"), strategies } as FeatureState],
              "local-yaml-store",
            );
          return config;
        },
      }),
    );
    const client = OpenFeature.getClient("stores-only");

    expect(
      await client.getStringDetails("kwong_pastry", "x", { targetingKey: "ling", country: "nz" }),
    ).toMatchObject({ value: "mango", reason: "TARGETING_MATCH", variant: "chago" });
    // a context of its own each time: nothing of the last one is left over
    expect(await client.getStringValue("kwong_pastry", "x", { targetingKey: "orm" })).toBe("plain");
  });

  it("records a tracked event as a FeatureHub named usage event", async () => {
    const events: UsageEvent[] = [];
    class Collector extends DefaultUsagePlugin {
      override canSendAsync = false;
      send(event: UsageEvent): void {
        events.push(event);
      }
    }

    const t = setup({ "": [feature("kwong_pastry", "omu&co")] });
    const config = { current: undefined as EdgeFeatureHubConfig | undefined };
    await OpenFeature.setProviderAndWait(
      t.domain,
      new FeatureHubProvider({
        host: "http://localhost:8085",
        apiKey: "default/env-ling/lingorm*client",
        configFactory: (options) => {
          config.current = new EdgeFeatureHubConfig(options.host, options.apiKey);
          config.current.edgeServiceProvider((repo) => new ScriptedEdge(repo, {}));
          config.current
            .repository()
            .notify(SSEResultState.Features, [feature("kwong_pastry", "omu&co")], "test");
          config.current.addUsagePlugin(new Collector());
          return config.current;
        },
      }),
    );

    t.client.track(
      "todo-add",
      { targetingKey: "lingling", plan: "always wonder" },
      { gaValue: "10" },
    );
    await tick();

    const named = events.find((e) => (e as { eventName?: string }).eventName === "todo-add");
    expect(named).toBeDefined();
    expect(named!.userKey).toBe("lingling");
    expect(named!.collectUsageRecord()).toMatchObject({ gaValue: "10", plan: "always wonder" });
  });

  // openfeature-resolution.yaml tracking.test_vectors
  describe("tracking", () => {
    class Collector extends DefaultUsagePlugin {
      override canSendAsync = false;
      readonly events: UsageEvent[] = [];
      send(event: UsageEvent): void {
        events.push(event);
        this.events.push(event);
      }
    }
    let events: UsageEvent[] = [];
    const named = (name: string) =>
      events.filter((e) => (e as { eventName?: string }).eventName === name);

    async function tracking(apiKey: string, answers: Record<string, Answer>) {
      events = [];
      const edges: ScriptedEdge[] = [];
      const domain = `tracking-${++domainCount}`;
      await OpenFeature.setProviderAndWait(
        domain,
        new FeatureHubProvider({
          host: "http://localhost:8085",
          apiKey,
          configFactory: (options) => {
            const config = new EdgeFeatureHubConfig(options.host, options.apiKey);
            config.edgeServiceProvider((repo) => {
              const edge = new ScriptedEdge(repo, answers);
              edges.push(edge);
              return edge;
            });
            config
              .repository()
              .notify(SSEResultState.Features, [feature("kwong_pastry", "omu&co")], "test");
            config.addUsagePlugin(new Collector());
            return config;
          },
        }),
      );
      return { client: OpenFeature.getClient(domain), edges };
    }

    it("uses the session as the user key when there is no targetingKey", async () => {
      const { client } = await tracking("default/env-ling/lingorm*client", {});

      client.track("todo-add", { session: "s1", Country: "NZ" }, {});
      await tick();

      const [event] = named("todo-add");
      expect(event!.userKey).toBe("s1");
      expect(event!.collectUsageRecord()).toMatchObject({ session: "s1", country: "NZ" });
    });

    it("records nothing, and raises nothing, for a context it cannot map", async () => {
      const { client } = await tracking("default/env-ling/lingorm*client", {});

      expect(() =>
        client.track("kwong-pastry", { targetingKey: "orm", shop: { nested: true } } as never, {}),
      ).not.toThrow();
      await tick();

      expect(named("kwong-pastry")).toEqual([]);
    });

    it("leaves a server-evaluated key's shared context alone, and fetches nothing", async () => {
      const { client, edges } = await tracking("default/env-ling/lingorm", {
        "": [feature("kwong_pastry", "omu&co")],
        "userkey=chago": [feature("kwong_pastry", "mango")],
      });
      expect(await client.getStringValue("kwong_pastry", "x", { targetingKey: "chago" })).toBe(
        "mango",
      );
      const requests = edges.flatMap((e) => e.headers).length;

      client.track("omu-co", { targetingKey: "kornaphat" }, {});
      await tick();

      expect(named("omu-co")[0]!.userKey).toBe("kornaphat");
      expect(edges.flatMap((e) => e.headers).length).toBe(requests);
      // the shared context is still chago's: no new context change for the next resolution
      expect(await client.getStringValue("kwong_pastry", "x", { targetingKey: "chago" })).toBe(
        "mango",
      );
      expect(edges.flatMap((e) => e.headers).length).toBe(requests);
    });

    it("records nothing before initialisation", () => {
      const provider = new FeatureHubProvider({
        host: "http://localhost:8085",
        apiKey: "default/env-ling/lingorm*client",
      });

      expect(() => provider.track("always-wonder", { targetingKey: "orm" }, {})).not.toThrow();
    });
  });
});
