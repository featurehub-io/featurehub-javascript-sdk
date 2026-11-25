import { ErrorCode, OpenFeature, ProviderEvents, ProviderStatus } from "@openfeature/web-sdk";
import {
  EdgeFeatureHubConfig,
  type EdgeService,
  type FeatureRolloutStrategy,
  type FeatureState,
  type FeatureValueInterceptor,
  FeatureValueType,
  type InternalFeatureRepository,
  SSEResultState,
} from "featurehub-javascript-client-sdk";
import { afterEach, describe, expect, it } from "vitest";

import { FeatureHubWebProvider } from "../provider";

// The provider against the real OpenFeature web SDK and the real FeatureHub SDK, with an edge service whose
// first poll answers from a script (featurehub-protocol.yaml repository, providers.events).

class ScriptedEdge implements EdgeService {
  constructor(
    private readonly repo: InternalFeatureRepository,
    private readonly answer: Array<FeatureState> | "fail",
  ) {}

  contextChange(): Promise<void> {
    return Promise.resolve();
  }

  clientEvaluated(): boolean {
    return true;
  }

  requiresReplacementOnHeaderChange(): boolean {
    return false;
  }

  close(): void {}

  poll(): Promise<void> {
    if (this.answer === "fail") {
      this.repo.notify(SSEResultState.Failure, null, "test");
    } else {
      this.repo.notify(SSEResultState.Features, this.answer, "test");
    }
    return Promise.resolve();
  }
}

const feature = (value: string): FeatureState =>
  ({
    id: "kwong-pastry-id",
    key: "kwong_pastry",
    version: 1,
    type: FeatureValueType.String,
    value,
    l: false,
  }) as FeatureState;

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

let domainCount = 0;

function setup(answer: Array<FeatureState> | "fail", overrides?: Record<string, string>) {
  const domain = `omu-co-${++domainCount}`;
  let config: EdgeFeatureHubConfig | undefined;

  const provider = new FeatureHubWebProvider({
    host: "http://localhost:8085",
    apiKey: "default/env-ling/kornaphat*sirilak",
    waitForReadyMs: 1000,
    configFactory: (options) => {
      config = new EdgeFeatureHubConfig(options.host, options.apiKey);
      config.edgeServiceProvider((repo) => new ScriptedEdge(repo, answer));
      if (overrides) {
        // as a local override would: values as strings
        const interceptor: FeatureValueInterceptor = {
          matched: (key) => (key in overrides ? [true, overrides[key]] : [false, undefined]),
        };
        config.addValueInterceptor(interceptor);
      }
      return config;
    },
  });

  const client = OpenFeature.getClient(domain);
  const events: string[] = [];
  for (const event of [ProviderEvents.Ready, ProviderEvents.Stale, ProviderEvents.Error]) {
    client.addHandler(event, () => events.push(event));
  }

  return {
    client,
    events,
    repo: () => config!.repository(),
    start: () => OpenFeature.setProviderAndWait(domain, provider),
  };
}

describe("FeatureHubWebProvider against the FeatureHub SDK's protocol behaviour", () => {
  afterEach(async () => {
    await OpenFeature.clearProviders();
  });

  it("goes STALE once when the connection fails after features, still resolving the last ones", async () => {
    const t = setup([feature("omu&co")]);
    await t.start();

    t.repo().notify(SSEResultState.Failure, null, "test");
    await tick();

    expect(t.events).toEqual([ProviderEvents.Ready, ProviderEvents.Stale]);
    expect(t.client.providerStatus).toBe(ProviderStatus.STALE);
    const details = t.client.getStringDetails("kwong_pastry", "chago");
    expect(details.value).toBe("omu&co");
    expect(details.errorCode).toBeUndefined();
  });

  it("fails as fatal when the connection is rejected before any features", async () => {
    const t = setup("fail");

    await expect(t.start()).rejects.toThrow();

    expect(t.client.providerStatus).toBe(ProviderStatus.FATAL);
    expect(t.client.getStringDetails("kwong_pastry", "chago").errorCode).toBe(
      ErrorCode.PROVIDER_FATAL,
    );
  });

  it("evaluates strategies locally: SPLIT for a percentage rollout, TARGETING_MATCH for attributes", async () => {
    const strategies = [
      {
        id: "chago",
        value: "mango",
        attributes: [
          { conditional: "EQUALS", fieldName: "country", type: "STRING", values: ["nz"] },
        ],
      },
      { id: "omu-co", value: "durian", percentage: 1000000, attributes: [] },
    ] as unknown as FeatureRolloutStrategy[];
    const t = setup([{ ...feature("plain"), strategies } as FeatureState]);
    await t.start();

    await OpenFeature.setContext({ targetingKey: "lingling", country: "nz" });
    expect(t.client.getStringDetails("kwong_pastry", "x")).toMatchObject({
      value: "mango",
      reason: "TARGETING_MATCH",
      variant: "chago",
    });

    await OpenFeature.setContext({ targetingKey: "lingling", country: "au" });
    expect(t.client.getStringDetails("kwong_pastry", "x")).toMatchObject({
      value: "durian",
      reason: "SPLIT",
      variant: "omu-co",
    });
  });

  it("converts an interceptor's string to the kind asked for", async () => {
    const t = setup(
      [
        {
          id: "keep-silent-id",
          key: "keep_silent",
          version: 1,
          type: FeatureValueType.Boolean,
          value: false,
          l: false,
        } as FeatureState,
      ],
      { keep_silent: "true" },
    );
    await t.start();

    expect(t.client.getBooleanDetails("keep_silent", false)).toMatchObject({
      value: true,
      reason: "STATIC",
    });
  });

  it("matches a date-time strategy against a Date in the context", async () => {
    const strategies = [
      {
        id: "always-wonder",
        value: "early bird",
        attributes: [
          {
            conditional: "LESS",
            fieldName: "signedUp",
            type: "DATETIME",
            values: ["2026-01-01T00:00:00Z"],
          },
        ],
      },
    ] as unknown as FeatureRolloutStrategy[];
    const t = setup([{ ...feature("plain"), strategies } as FeatureState]);
    await t.start();

    await OpenFeature.setContext({
      targetingKey: "orm",
      signedUp: new Date("2025-06-01T08:00:00Z"),
    });
    expect(t.client.getStringDetails("kwong_pastry", "x")).toMatchObject({
      value: "early bird",
      reason: "TARGETING_MATCH",
      variant: "always-wonder",
    });

    await OpenFeature.setContext({
      targetingKey: "orm",
      signedUp: new Date("2026-06-01T08:00:00Z"),
    });
    expect(t.client.getStringDetails("kwong_pastry", "x")).toMatchObject({
      value: "plain",
      reason: "STATIC",
    });
  });
});
