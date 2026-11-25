import { ErrorCode, OpenFeature, ProviderEvents, ProviderStatus } from "@openfeature/server-sdk";
import {
  EdgeFeatureHubConfig,
  type EdgeService,
  type FeatureState,
  FeatureValueType,
  type InternalFeatureRepository,
  SSEResultState,
} from "featurehub-javascript-node-sdk";
import { afterEach, describe, expect, it } from "vitest";

import { FeatureHubProvider } from "../provider";

// The provider against the real OpenFeature server SDK and the real FeatureHub SDK, with an edge service
// that answers each context's request from a script, so the repository's protocol behaviour
// (featurehub-protocol.yaml repository, providers.events) reaches OpenFeature as it would from Edge.

type Answer =
  | Array<FeatureState>
  | "fail"
  | { features: Array<FeatureState>; then: "stale" | "fail" };

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

    if (answer === "fail") {
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

  it("goes STALE when a context change is answered by a failure, keeping the old features", async () => {
    const t = setup({ "": [feature("kwong_pastry", "omu&co")], "userkey=orm": "fail" });
    await t.start();

    const details = await t.client.getStringDetails("kwong_pastry", "chago", {
      targetingKey: "orm",
    });
    await tick();

    // readiness was already Stale for the context change: only the connection event tells it
    expect(t.events).toEqual([ProviderEvents.Ready, ProviderEvents.Stale]);
    expect(details.value).toBe("omu&co");
    expect(details.errorCode).toBeUndefined();
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
});
