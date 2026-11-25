import { act, render, screen } from "@testing-library/react";
import {
  EdgeFeatureHubConfig,
  type EdgeService,
  FeatureHub as fhStatic,
  type FeatureState,
  FeatureValueType,
  Readyness,
  SSEResultState,
} from "featurehub-javascript-client-sdk";
import { afterEach, describe, expect, it } from "vitest";

import { FeatureHub, useFeature } from "..";

// The component against a real config and repository, fed by a fake edge service, so the repository's
// behaviour (featurehub-protocol.yaml repository) reaches React as it does in an application:
// readiness broadcast only on change, Stale during a context change and after a permanent stop, and
// feature changes told by their own event.

class FakeEdge implements EdgeService {
  readonly headers: string[] = [];
  closed = false;

  contextChange(header: string): Promise<void> {
    this.headers.push(header);
    return Promise.resolve();
  }

  clientEvaluated(): boolean {
    return false;
  }

  requiresReplacementOnHeaderChange(): boolean {
    return false;
  }

  close(): void {
    this.closed = true;
  }

  poll(): Promise<void> {
    return Promise.resolve();
  }
}

const url = "http://localhost:8085";
let keyCount = 0;

function setup() {
  // a server-evaluated key, new for each test: EdgeFeatureHubConfig.config() keeps one config per url/key
  const apiKey = `default/env-ling/kwong-pastry-${++keyCount}`;
  const config = EdgeFeatureHubConfig.config(url, apiKey);
  const edge = new FakeEdge();
  config.edgeServiceProvider(() => edge);
  const repo = config.repository();

  const broadcasts: Readyness[] = [];
  config.addReadinessListener((r) => broadcasts.push(r), true);

  return { apiKey, config, edge, repo, broadcasts };
}

const pastry = (value: string | null, version: number, l: boolean | null = false): FeatureState =>
  ({
    id: "kwong-pastry-id",
    key: "kwong_pastry",
    version,
    type: FeatureValueType.String,
    value,
    l,
  }) as FeatureState;

function Flag() {
  const value = useFeature<string>("kwong_pastry");
  return <span data-testid="flag">{value === undefined ? "(none)" : value}</span>;
}

const flag = () => screen.getByTestId("flag").textContent;

describe("FeatureHub with a real repository", () => {
  afterEach(() => {
    fhStatic.setConfig(undefined);
    fhStatic.setContext(undefined);
  });

  it("waits for the first full set, sending the user key as the context", async () => {
    const { apiKey, edge, repo, broadcasts } = setup();

    render(
      <FeatureHub url={url} apiKey={apiKey} userKey="lingling">
        <Flag />
      </FeatureHub>,
    );

    expect(screen.queryByTestId("flag")).not.toBeInTheDocument();
    expect(edge.headers).toContain("userkey=lingling");

    await act(async () => repo.notify(SSEResultState.Features, [pastry("omu&co", 1)], "test"));

    expect(flag()).toBe("omu&co");
    expect(broadcasts).toEqual([Readyness.Ready]);
  });

  it("updates a feature from a later full set, with no readiness broadcast", async () => {
    const { apiKey, repo, broadcasts } = setup();

    render(
      <FeatureHub url={url} apiKey={apiKey} userKey="lingling">
        <Flag />
      </FeatureHub>,
    );
    await act(async () => repo.notify(SSEResultState.Features, [pastry("omu&co", 1)], "test"));

    // every poll delivers a full set: an unchanged one changes nothing, a changed one only the feature
    await act(async () => repo.notify(SSEResultState.Features, [pastry("omu&co", 1)], "test"));
    await act(async () =>
      repo.notify(SSEResultState.Features, [pastry("always wonder", 2)], "test"),
    );

    expect(flag()).toBe("always wonder");
    expect(broadcasts).toEqual([Readyness.Ready]);
  });

  it("keeps rendering through a context change, then shows the new context's value", async () => {
    const { apiKey, config, edge, repo, broadcasts } = setup();

    const { rerender } = render(
      <FeatureHub url={url} apiKey={apiKey} userKey="lingling">
        <Flag />
      </FeatureHub>,
    );
    await act(async () => repo.notify(SSEResultState.Features, [pastry("omu&co", 1)], "test"));

    await act(async () => {
      rerender(
        <FeatureHub url={url} apiKey={apiKey} userKey="orm">
          <Flag />
        </FeatureHub>,
      );
    });

    // the old context's features are still held and shown while the new ones are fetched
    expect(edge.headers.at(-1)).toBe("userkey=orm");
    expect(config.readiness).toBe(Readyness.Stale);
    expect(flag()).toBe("omu&co");

    await act(async () => repo.notify(SSEResultState.Features, [pastry("keep silent", 1)], "test"));

    expect(flag()).toBe("keep silent");
    expect(broadcasts).toEqual([Readyness.Ready, Readyness.Stale, Readyness.Ready]);
  });

  it("keeps the last features when the connection fails after them", async () => {
    const { apiKey, config, repo } = setup();

    render(
      <FeatureHub url={url} apiKey={apiKey} userKey="lingling">
        <Flag />
      </FeatureHub>,
    );
    await act(async () => repo.notify(SSEResultState.Features, [pastry("omu&co", 1)], "test"));
    await act(async () => repo.notify(SSEResultState.Failure, null, "test"));

    expect(config.readiness).toBe(Readyness.Stale);
    expect(repo.connectionFailed).toBe(true);
    expect(flag()).toBe("omu&co");
  });

  it("keeps the last features when the environment goes stale", async () => {
    const { apiKey, config, repo } = setup();

    render(
      <FeatureHub url={url} apiKey={apiKey} userKey="lingling">
        <Flag />
      </FeatureHub>,
    );
    await act(async () => repo.notify(SSEResultState.Features, [pastry("omu&co", 1)], "test"));
    await act(async () => repo.markEnvironmentStale());

    expect(config.readiness).toBe(Readyness.Stale);
    expect(flag()).toBe("omu&co");
  });

  it("renders nothing when the connection fails before any features", async () => {
    const { apiKey, config, repo } = setup();

    render(
      <FeatureHub url={url} apiKey={apiKey} userKey="lingling">
        <Flag />
      </FeatureHub>,
    );
    await act(async () => repo.notify(SSEResultState.Failure, null, "test"));

    expect(config.readiness).toBe(Readyness.Failed);
    expect(screen.queryByTestId("flag")).not.toBeInTheDocument();
  });

  it("shows a deleted feature as having no value, and a null lock as unlocked", async () => {
    const { apiKey, repo } = setup();

    render(
      <FeatureHub url={url} apiKey={apiKey} userKey="lingling">
        <Flag />
      </FeatureHub>,
    );
    await act(async () =>
      repo.notify(SSEResultState.Features, [pastry("omu&co", 1, null)], "test"),
    );

    expect(flag()).toBe("omu&co");
    expect(repo.feature("kwong_pastry").locked).toBe(false);

    await act(async () => repo.notify(SSEResultState.DeleteFeature, pastry(null, 2), "test"));

    expect(flag()).toBe("(none)");
  });

  it("closes the config, and its connection, when it unmounts", async () => {
    const { apiKey, config, edge, repo } = setup();

    const { unmount } = render(
      <FeatureHub url={url} apiKey={apiKey} userKey="lingling">
        <Flag />
      </FeatureHub>,
    );
    await act(async () => repo.notify(SSEResultState.Features, [pastry("omu&co", 1)], "test"));

    unmount();

    expect(edge.closed).toBe(true);
    expect(config.isClosed).toBe(true);
  });
});
