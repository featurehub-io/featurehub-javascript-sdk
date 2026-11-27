import { describe, expect, it } from "vitest";

import {
  ClientFeatureRepository,
  ConnectionEvent,
  EdgeFeatureHubConfig,
  type FeatureState,
  FeatureValueType,
  Readyness,
  SSEResultState,
} from "../index";

// featurehub-protocol.yaml repository.connection_failed and repository.environment_stale: each is told once,
// as an event of its own, separately from readiness

const feature = (value: string, version = 1): FeatureState =>
  ({
    id: "ling-id",
    key: "always_wonder",
    version,
    type: FeatureValueType.String,
    value,
    l: false,
  }) as FeatureState;

function watched() {
  const repo = new ClientFeatureRepository();
  const events: ConnectionEvent[] = [];
  const readiness: Readyness[] = [];
  repo.addConnectionEventListener((e) => events.push(e));
  repo.addReadinessListener((r) => readiness.push(r), true);
  return { repo, events, readiness };
}

describe("connection events", () => {
  it("tell a failure after features once, with readiness going to Stale", () => {
    const { repo, events, readiness } = watched();
    repo.notify(SSEResultState.Features, [feature("omu&co")], "test");

    repo.notify(SSEResultState.Failure, null, "test");
    repo.notify(SSEResultState.Failure, null, "test");

    expect(events).toEqual([ConnectionEvent.ConnectionFailed]);
    expect(readiness).toEqual([Readyness.Ready, Readyness.Stale]);
    expect(repo.connectionFailed).toBe(true);
  });

  it("tell a failure before any features, with readiness going to Failed", () => {
    const { repo, events, readiness } = watched();

    repo.notify(SSEResultState.Failure, null, "test");

    expect(events).toEqual([ConnectionEvent.ConnectionFailed]);
    expect(readiness).toEqual([Readyness.Failed]);
  });

  it("tell a failure during a context change, when readiness is already Stale and does not change", () => {
    const { repo, events, readiness } = watched();
    repo.notify(SSEResultState.Features, [feature("omu&co")], "test");
    repo.notReady(); // a context change: Ready -> Stale

    repo.notify(SSEResultState.Failure, null, "test");

    // no readiness broadcast tells it, so only the event does
    expect(readiness).toEqual([Readyness.Ready, Readyness.Stale]);
    expect(events).toEqual([ConnectionEvent.ConnectionFailed]);
  });

  it("tell a stale environment once, during a context change too", () => {
    const { repo, events, readiness } = watched();
    repo.notify(SSEResultState.Features, [feature("omu&co")], "test");
    repo.notReady();

    repo.markEnvironmentStale();
    repo.markEnvironmentStale();

    expect(readiness).toEqual([Readyness.Ready, Readyness.Stale]);
    expect(events).toEqual([ConnectionEvent.EnvironmentStale]);
    expect(repo.environmentStale).toBe(true);
  });

  it("tell a listener added late what has already happened", () => {
    const repo = new ClientFeatureRepository();
    repo.notify(SSEResultState.Features, [feature("omu&co")], "test");
    repo.markEnvironmentStale();
    repo.notify(SSEResultState.Failure, null, "test");

    const events: ConnectionEvent[] = [];
    repo.addConnectionEventListener((e) => events.push(e));

    expect(events).toEqual([ConnectionEvent.ConnectionFailed, ConnectionEvent.EnvironmentStale]);
  });

  it("are not told to a removed listener, and one failing listener does not stop the others", () => {
    const repo = new ClientFeatureRepository();
    const removed: ConnectionEvent[] = [];
    const kept: ConnectionEvent[] = [];
    const handle = repo.addConnectionEventListener((e) => removed.push(e));
    repo.addConnectionEventListener(() => {
      throw new Error("keep silent");
    });
    repo.addConnectionEventListener((e) => kept.push(e));
    repo.removeConnectionEventListener(handle);

    repo.notify(SSEResultState.Failure, null, "test");

    expect(removed).toEqual([]);
    expect(kept).toEqual([ConnectionEvent.ConnectionFailed]);
  });

  it("are available from the config", () => {
    const config = new EdgeFeatureHubConfig("http://localhost:8085", "default/env-ling/kornaphat");
    const events: ConnectionEvent[] = [];
    config.addConnectionEventListener((e) => events.push(e));

    expect(config.connectionFailed).toBe(false);
    expect(config.environmentStale).toBe(false);

    config.repository().notify(SSEResultState.Features, [feature("omu&co")], "test");
    config.repository().markEnvironmentStale();

    expect(config.environmentStale).toBe(true);
    expect(events).toEqual([ConnectionEvent.EnvironmentStale]);

    config.forceClose();
    expect(config.environmentStale).toBe(false);
  });
});
