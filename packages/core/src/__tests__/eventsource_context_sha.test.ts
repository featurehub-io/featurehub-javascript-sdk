import { Substitute, type SubstituteOf } from "@fluffy-spoon/substitute";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  contextSha,
  type EventSourceProvider,
  type FeatureHubConfig,
  FeatureHubEventSourceClient,
  type InternalFeatureRepository,
} from "../index";

describe("streaming sends the contextSha", () => {
  const edgeUrl = "http://localhost/features/default/ormkorn";
  let config: SubstituteOf<FeatureHubConfig>;
  let repo: SubstituteOf<InternalFeatureRepository>;
  let originalProvider: EventSourceProvider;
  let originalEventSource: unknown;
  let urls: string[];

  beforeEach(() => {
    config = Substitute.for<FeatureHubConfig>();
    config.url().returns(edgeUrl);
    repo = Substitute.for<InternalFeatureRepository>();
    originalProvider = FeatureHubEventSourceClient.eventSourceProvider;
    originalEventSource = (globalThis as any).EventSource;
    urls = [];

    // the default (browser) provider constructs a global EventSource
    (globalThis as any).EventSource = class {
      constructor(url: string) {
        urls.push(url);
      }

      addEventListener() {}

      close() {}
    };
  });

  afterEach(() => {
    FeatureHubEventSourceClient.eventSourceProvider = originalProvider;
    (globalThis as any).EventSource = originalEventSource;
  });

  it("sends contextSha=0 for a client-evaluated key", async () => {
    config.clientEvaluated().returns(true);

    await new FeatureHubEventSourceClient(config, repo).poll();

    expect(urls).toEqual([`${edgeUrl}?contextSha=0&sdk_version=2`]);
  });

  it("hashes the context with the replaceable contextHash", async () => {
    // a platform package (the browser SDK) sets its own
    const original = FeatureHubEventSourceClient.contextHash;
    FeatureHubEventSourceClient.contextHash = (_algorithm, data) =>
      Promise.resolve(`hashed-${data}`);
    try {
      config.clientEvaluated().returns(false);

      await new FeatureHubEventSourceClient(config, repo).contextChange("userkey=kornaphat");

      expect(urls[0]).toContain("?contextSha=hashed-userkey=kornaphat&");
    } finally {
      FeatureHubEventSourceClient.contextHash = original;
    }
  });

  it("sends the hex contextSha, then the encoded context, for a server-evaluated key", async () => {
    config.clientEvaluated().returns(false);
    const header = "country=thailand,userkey=lingling%20kwong";

    await new FeatureHubEventSourceClient(config, repo).contextChange(header);

    expect(urls).toEqual([
      `${edgeUrl}?contextSha=${await contextSha(header)}&sdk_version=2&xfeaturehub=${encodeURIComponent(header)}`,
    ]);
    expect(await contextSha(header)).toMatch(/^[0-9a-f]{64}$/);
  });
});
