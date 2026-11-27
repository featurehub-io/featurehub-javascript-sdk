import { ProviderFatalError } from "@openfeature/core";
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
  connectionFailed = false;
  environmentStale = false;
  readinessOnWait = "Ready";
  /** what the repository's readiness is when the provider starts listening */
  initialReadiness = "Ready";
  forceCloses = 0;

  private readinessListener?: (readiness: string) => void;
  private connectionListener?: (event: string) => void;

  addConnectionEventListener(listener: (event: string) => void): number {
    this.connectionListener = listener;
    return 1;
  }

  stopConnection(event: "ConnectionFailed" | "EnvironmentStale"): void {
    if (event === "ConnectionFailed") this.connectionFailed = true;
    else this.environmentStale = true;
    this.connectionListener?.(event);
  }

  addReadinessListener(listener: (readiness: string) => void): number {
    this.readinessListener = listener;
    listener(this.initialReadiness);
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
    return this.readinessOnWait;
  }

  forceClose(): void {
    this.forceCloses++;
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

  constructor(public fake: FakeConfig) {
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

  resolvable(): boolean {
    return this.ready;
  }

  events(): string[] {
    return this.emitted.map((e) => e.event);
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

  it("reports a feature a full set no longer holds as changed", async () => {
    const cfg = new FakeConfig();
    const provider = new TestProvider(cfg);
    provider.start();
    await provider.readyUp();

    cfg.listener?.processUpdates([flag("ling", 1), flag("orm", 1)], "test");
    cfg.listener?.processUpdates([flag("ling", 1)], "test");

    expect(provider.changes()).toEqual(["orm"]);
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

// featurehub-protocol.yaml providers.events and repository.readiness: Stale still resolves; STALE is for a
// connection that stopped for good, never for a context change
describe("provider lifecycle with Stale readiness", () => {
  it("keeps resolving through a context change, with no event", async () => {
    const cfg = new FakeConfig();
    const provider = new TestProvider(cfg);
    provider.start();
    await provider.readyUp();

    cfg.setReadiness("Stale");
    expect(provider.resolvable()).toBe(true);
    cfg.setReadiness("Ready");

    expect(provider.resolvable()).toBe(true);
    expect(provider.emitted).toEqual([]);
  });

  it("emits STALE once when the connection stops for good, and keeps resolving", async () => {
    const cfg = new FakeConfig();
    const provider = new TestProvider(cfg);
    provider.start();
    await provider.readyUp();

    cfg.setReadiness("Stale");
    cfg.stopConnection("ConnectionFailed");
    cfg.stopConnection("EnvironmentStale");

    expect(provider.events()).toEqual(["PROVIDER_STALE"]);
    expect(provider.resolvable()).toBe(true);
  });

  it("emits STALE for a failure during a context change, which readiness does not show", async () => {
    const cfg = new FakeConfig();
    const provider = new TestProvider(cfg);
    provider.start();
    await provider.readyUp();
    cfg.setReadiness("Stale"); // the context change

    cfg.stopConnection("ConnectionFailed"); // readiness stays Stale

    expect(provider.events()).toEqual(["PROVIDER_STALE"]);
  });

  it("initialises with the first features when the connection stopped with them, then emits STALE", async () => {
    const cfg = new FakeConfig();
    const provider = new TestProvider(cfg);
    provider.start();
    cfg.readinessOnWait = "Stale";
    cfg.connectionFailed = true;

    await provider.readyUp();

    // after initialize resolves, so after the OpenFeature SDK's own READY
    expect(provider.events()).toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(provider.events()).toEqual(["PROVIDER_STALE"]);
    expect(provider.resolvable()).toBe(true);
  });

  it("fails initialisation as fatal when the connection is rejected before any features", async () => {
    const cfg = new FakeConfig();
    const provider = new TestProvider(cfg);
    provider.start();
    cfg.readinessOnWait = "Failed";

    await expect(provider.readyUp()).rejects.toBeInstanceOf(ProviderFatalError);
  });

  it("fails initialisation, not as fatal, when only a context change is in progress at the deadline", async () => {
    const cfg = new FakeConfig();
    const provider = new TestProvider(cfg);
    provider.start();
    cfg.readinessOnWait = "Stale";

    const failure = await provider.readyUp().catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(ProviderFatalError);
  });
});

describe("provider lifecycle across a failed start and a restart", () => {
  it("emits READY when the features arrive after initialisation timed out", async () => {
    const cfg = new FakeConfig();
    cfg.initialReadiness = "NotReady";
    cfg.readinessOnWait = "NotReady";
    const provider = new TestProvider(cfg);
    provider.start();

    await expect(provider.readyUp()).rejects.toThrow("did not become ready");

    // Edge answers after the deadline: OpenFeature only leaves ERROR when the provider says so
    cfg.setReadiness("Ready");

    expect(provider.events()).toEqual(["PROVIDER_READY"]);
    expect(provider.resolvable()).toBe(true);
  });

  it("closes the config when the connection is rejected before any features", async () => {
    const cfg = new FakeConfig();
    cfg.readinessOnWait = "Failed";
    const provider = new TestProvider(cfg);
    provider.start();

    await expect(provider.readyUp()).rejects.toBeInstanceOf(ProviderFatalError);

    expect(cfg.forceCloses).toBe(1);
  });

  it("starts afresh when initialised again after closing", async () => {
    const first = new FakeConfig();
    const provider = new TestProvider(first);
    provider.start();
    await provider.readyUp();
    first.listener?.processUpdates([flag("kwong_pastry", 1)], "test");
    first.stopConnection("ConnectionFailed");
    expect(provider.events()).toEqual(["PROVIDER_STALE"]);

    await provider.onClose();
    provider.emitted.length = 0;

    const second = new FakeConfig();
    second.initialReadiness = "NotReady";
    provider.fake = second;
    provider.start();
    // the SDK emits READY itself when initialize resolves
    second.setReadiness("Ready");
    expect(provider.events()).toEqual([]);
    await provider.readyUp();

    // a new baseline: the first full set is not a change
    second.listener?.processUpdates([flag("kwong_pastry", 1), flag("omu_co", 1)], "test");
    expect(provider.changes()).toEqual([]);

    // and STALE can be told again
    second.stopConnection("EnvironmentStale");
    expect(provider.events()).toEqual(["PROVIDER_STALE"]);
  });
});
