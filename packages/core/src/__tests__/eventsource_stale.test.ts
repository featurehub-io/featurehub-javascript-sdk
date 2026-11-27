import { Substitute, type SubstituteOf } from "@fluffy-spoon/substitute";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  type EventSourceProvider,
  type FeatureHubConfig,
  FeatureHubEventSourceClient,
  type InternalFeatureRepository,
} from "../index";

class FakeEventSource {
  static created: FakeEventSource[] = [];
  listeners = new Map<string, (e: { data: string }) => void>();
  closed = false;
  onerror: ((e: unknown) => void) | undefined;
  readyState = 1;

  constructor(public url: string) {
    FakeEventSource.created.push(this);
  }

  addEventListener(name: string, l: (e: { data: string }) => void) {
    this.listeners.set(name, l);
  }

  emit(name: string, data: unknown) {
    this.listeners.get(name)!({ data: JSON.stringify(data) });
  }

  close() {
    this.closed = true;
  }
}

describe("streaming treats edge.stale as permanent", () => {
  let config: SubstituteOf<FeatureHubConfig>;
  let repo: SubstituteOf<InternalFeatureRepository>;
  let originalProvider: EventSourceProvider;

  beforeEach(() => {
    config = Substitute.for<FeatureHubConfig>();
    config.url().returns("http://localhost/features/default/always-wonder");
    config.clientEvaluated().returns(true);
    repo = Substitute.for<InternalFeatureRepository>();
    originalProvider = FeatureHubEventSourceClient.eventSourceProvider;
    FakeEventSource.created = [];
    FeatureHubEventSourceClient.eventSourceProvider = (url) =>
      new FakeEventSource(url) as unknown as ReturnType<EventSourceProvider>;
  });

  afterEach(() => {
    FeatureHubEventSourceClient.eventSourceProvider = originalProvider;
  });

  it.each([true, false, null, 0, "chago"])(
    "closes the stream for good on edge.stale = %s",
    async (value) => {
      const client = new FeatureHubEventSourceClient(config, repo);
      await client.poll();

      FakeEventSource.created[0]!.emit("config", { "edge.stale": value });

      expect(FakeEventSource.created[0]!.closed).toBe(true);
      expect(client.environmentStale).toBe(true);
      repo.received(1).markEnvironmentStale();

      await client.poll();
      expect(FakeEventSource.created).toHaveLength(1);
    },
  );

  it.each([{}, ["edge.stale"], "edge.stale", 5])(
    "ignores a config event without an edge.stale key (%s)",
    async (data) => {
      const client = new FeatureHubEventSourceClient(config, repo);
      await client.poll();

      FakeEventSource.created[0]!.emit("config", data);

      expect(FakeEventSource.created[0]!.closed).toBe(false);
      expect(client.environmentStale).toBe(false);
    },
  );
});
