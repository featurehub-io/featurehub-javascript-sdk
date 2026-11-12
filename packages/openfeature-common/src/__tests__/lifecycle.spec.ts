import type { FeatureHubConfig, FeatureState } from "featurehub-javascript-core-sdk";
import { describe, expect, it } from "vitest";

import {
  applyTransport,
  type BaseProviderOptions,
  FeatureHubProviderCore,
  type ProviderEventSink,
  type Transport,
} from "../lifecycle";

type RawListener = Parameters<FeatureHubConfig["registerRawUpdateFeatureListener"]>[0];

interface Emitted {
  event: string;
  details?: { message?: string; flagsChanged?: string[] };
}

class FakeConfig {
  initialized = true;
  readonly transports: string[] = [];
  listener?: RawListener;

  private readinessListener?: (readiness: string) => void;

  addReadinessListener(listener: (readiness: string) => void): number {
    this.readinessListener = listener;
    listener("Ready");
    return 1;
  }

  registerRawUpdateFeatureListener(listener: RawListener): number {
    this.listener = listener;
    return 1;
  }

  streaming(): this {
    this.transports.push("streaming");
    return this;
  }

  restActive(): this {
    this.transports.push("polling");
    return this;
  }

  restPassive(): this {
    this.transports.push("passive");
    return this;
  }

  init(): void {
    /* no-op */
  }

  async waitForReady(): Promise<string> {
    return "Ready";
  }

  forceClose(): void {
    /* no-op */
  }

  setReadiness(readiness: string): void {
    this.readinessListener?.(readiness);
  }

  asConfig(): FeatureHubConfig {
    return this as unknown as FeatureHubConfig;
  }
}

interface TestOptions extends BaseProviderOptions<TestOptions> {
  readonly __test?: true;
}

class TestProvider extends FeatureHubProviderCore<TestOptions> {
  readonly emitted: Emitted[] = [];

  constructor(private readonly fake: FakeConfig) {
    super("TestProvider", { host: "http://edge.test", apiKey: "*client-key" });
  }

  protected get eventSink(): ProviderEventSink {
    return {
      emit: (event, details) => {
        this.emitted.push({ event, details });
      },
    };
  }

  protected createConfig(): FeatureHubConfig {
    return this.fake.asConfig();
  }

  protected get defaultTransport(): Transport {
    return "streaming";
  }

  start(): FeatureHubConfig {
    return this.startConfig();
  }

  readyUp(): Promise<void> {
    return this.awaitReady(this.fake.asConfig());
  }

  changes(): string[] {
    return this.emitted
      .filter((e) => e.event === "PROVIDER_CONFIGURATION_CHANGED")
      .flatMap((e) => e.details?.flagsChanged ?? []);
  }
}

function flag(key: string, version: number): FeatureState {
  return { key, version } as unknown as FeatureState;
}

describe("provider lifecycle events", () => {
  it("does not emit Ready during initialize (the OpenFeature SDK does), only on recovery", async () => {
    const cfg = new FakeConfig();
    const provider = new TestProvider(cfg);

    provider.start();
    expect(provider.emitted).toHaveLength(0);

    await provider.readyUp();
    expect(provider.emitted).toHaveLength(0);

    cfg.setReadiness("Failed");
    expect(provider.emitted.at(-1)?.event).toBe("PROVIDER_ERROR");

    cfg.setReadiness("Ready");
    expect(provider.emitted.at(-1)?.event).toBe("PROVIDER_READY");
  });

  it("emits ConfigurationChanged only when a feature version actually changes", async () => {
    const cfg = new FakeConfig();
    const provider = new TestProvider(cfg);
    provider.start();
    await provider.readyUp();

    // baseline payload: remembered, not announced
    cfg.listener?.processUpdates([flag("a", 1), flag("b", 1)], "test");
    expect(provider.changes()).toEqual([]);

    // an unchanged poll (the repository replays every feature on each poll)
    cfg.listener?.processUpdates([flag("a", 1), flag("b", 1)], "test");
    expect(provider.changes()).toEqual([]);

    // a real version change
    cfg.listener?.processUpdates([flag("a", 2), flag("b", 1)], "test");
    expect(provider.changes()).toEqual(["a"]);

    // a newly added feature
    cfg.listener?.processUpdates([flag("a", 2), flag("b", 1), flag("c", 1)], "test");
    expect(provider.changes()).toEqual(["a", "c"]);

    // a deletion
    cfg.listener?.deleteFeature(flag("b", 1), "test");
    expect(provider.changes()).toEqual(["a", "c", "b"]);
  });

  it("stays silent until initialize has completed", () => {
    const cfg = new FakeConfig();
    const provider = new TestProvider(cfg);
    provider.start();

    cfg.listener?.processUpdates([flag("a", 1)], "test");
    cfg.listener?.processUpdates([flag("a", 2)], "test");
    expect(provider.emitted).toHaveLength(0);
  });
});

describe("applyTransport", () => {
  it("uses the platform default when nothing is selected", () => {
    const cfg = new FakeConfig();
    applyTransport(cfg.asConfig(), {}, "passive");
    expect(cfg.transports).toEqual(["passive"]);
  });

  it("treats cacheTimeToLiveMs as passive and pollIntervalMs as polling", () => {
    const a = new FakeConfig();
    applyTransport(a.asConfig(), { cacheTimeToLiveMs: 5000 }, "streaming");
    expect(a.transports).toEqual(["passive"]);

    const b = new FakeConfig();
    applyTransport(b.asConfig(), { pollIntervalMs: 1000 }, "passive");
    expect(b.transports).toEqual(["polling"]);
  });

  it("honours an explicit transport over the default", () => {
    const cfg = new FakeConfig();
    applyTransport(cfg.asConfig(), { transport: "streaming" }, "passive");
    expect(cfg.transports).toEqual(["streaming"]);
  });
});
