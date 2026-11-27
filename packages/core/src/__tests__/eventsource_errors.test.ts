import { Substitute, type SubstituteOf } from "@fluffy-spoon/substitute";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  type EventSourceProvider,
  type FeatureHubConfig,
  FeatureHubEventSourceClient,
  type InternalFeatureRepository,
  SSEResultState,
} from "../index";

class FakeEventSource {
  static created: FakeEventSource[] = [];
  onerror: ((e: unknown) => void) | undefined;
  readyState = 1;
  closed = false;
  listeners = new Map<string, (e: { data: string }) => void>();

  constructor(public url: string) {
    FakeEventSource.created.push(this);
  }

  addEventListener(name: string, l: (e: { data: string }) => void) {
    this.listeners.set(name, l);
  }

  close() {
    this.closed = true;
    this.readyState = 2;
  }
}

describe("streaming connection errors in a browser", () => {
  let config: SubstituteOf<FeatureHubConfig>;
  let repo: InternalFeatureRepository;
  let notified: SSEResultState[];
  let originalProvider: EventSourceProvider;

  beforeEach(() => {
    config = Substitute.for<FeatureHubConfig>();
    config.url().returns("http://localhost/features/default/omu-and-co");
    config.clientEvaluated().returns(true);
    notified = [];
    repo = {
      notify: (state: SSEResultState) => notified.push(state),
    } as unknown as InternalFeatureRepository;
    originalProvider = FeatureHubEventSourceClient.eventSourceProvider;
    FakeEventSource.created = [];
    FeatureHubEventSourceClient.eventSourceProvider = (url) =>
      new FakeEventSource(url) as unknown as ReturnType<EventSourceProvider>;
  });

  afterEach(() => {
    FeatureHubEventSourceClient.eventSourceProvider = originalProvider;
    FeatureHubEventSourceClient.reconnectPolicy = { ...originalPolicy };
    FeatureHubEventSourceClient.shortConnectionThresholdMs = originalThreshold;
  });

  const originalPolicy = { ...FeatureHubEventSourceClient.reconnectPolicy };
  const originalThreshold = FeatureHubEventSourceClient.shortConnectionThresholdMs;

  it("closes the event source for good when short reconnections use up the maximum attempts", async () => {
    FeatureHubEventSourceClient.reconnectPolicy = { ...originalPolicy, maxAttempts: 2 };
    const client = new FeatureHubEventSourceClient(config, repo);
    await client.poll();
    const es = FakeEventSource.created[0]!;
    es.readyState = 0; // CONNECTING: the browser reconnects at once, each time

    es.onerror!({});
    es.onerror!({});
    expect(client.failed).toBe(false);

    es.onerror!({});
    expect(client.failed).toBe(true);
    expect(es.closed).toBe(true);
    expect(notified[notified.length - 1]).toBe(SSEResultState.Failure);
  });

  it("does not count a browser connection that lasted past the threshold and ended in a bye", async () => {
    FeatureHubEventSourceClient.reconnectPolicy = { ...originalPolicy, maxAttempts: 1 };
    FeatureHubEventSourceClient.shortConnectionThresholdMs = 20;
    const client = new FeatureHubEventSourceClient(config, repo);
    await client.poll();
    const es = FakeEventSource.created[0]!;
    es.readyState = 0;

    for (let i = 0; i < 4; i++) {
      await new Promise((r) => setTimeout(r, 30));
      es.listeners.get("bye")!({ data: "{}" });
      es.onerror!({});
    }

    expect(client.failed).toBe(false);
  });

  it("treats a connection the browser is re-establishing as a bye, not a failure", async () => {
    const client = new FeatureHubEventSourceClient(config, repo);
    await client.poll();
    const es = FakeEventSource.created[0]!;

    es.readyState = 0; // CONNECTING: the browser reconnects by itself
    es.onerror!({});

    expect(notified).toEqual([SSEResultState.Bye]);
    expect(client.failed).toBe(false);
    expect(es.closed).toBe(false);
  });

  it("treats a browser event source that has closed as a permanent failure, as it hides the status", async () => {
    const client = new FeatureHubEventSourceClient(config, repo);
    await client.poll();
    const es = FakeEventSource.created[0]!;

    es.readyState = 2; // CLOSED
    es.onerror!({});

    expect(notified).toEqual([SSEResultState.Failure]);
    expect(client.failed).toBe(true);

    await client.poll();
    expect(FakeEventSource.created).toHaveLength(1);
  });

  it("stops for good when FeatureHub sends a failure event", async () => {
    const client = new FeatureHubEventSourceClient(config, repo);
    await client.poll();

    FakeEventSource.created[0]!.listeners.get("failure")!({ data: "{}" });

    expect(notified).toEqual([SSEResultState.Failure]);
    expect(FakeEventSource.created[0]!.closed).toBe(true);
    expect(client.failed).toBe(true);
  });
});
