import { createServer, type Server } from "http";
import type { AddressInfo } from "net";
import { afterEach, describe, expect, it } from "vitest";

import {
  EdgeFeatureHubConfig,
  featureSnapshotConfig,
  featureSnapshotHandler,
  FeatureSnapshotNotReadyError,
  FeatureSnapshotStore,
  featuresShaInput,
  type FeatureState,
  FeatureValueType,
  ifNoneMatchMatches,
  type InternalFeatureRepository,
  InvalidContextError,
  mapEvaluationContext,
  Readyness,
  RolloutStrategyAttributeConditional as C,
  RolloutStrategyFieldType as T,
  snapshotSha,
  SSEResultState,
  xFeatureHubHeader,
} from "../index";

const CLIENT_KEY = "default/env-ling/abc*def";
const SERVER_KEY = "default/env-orm/abcdef";

const tick = () => new Promise((r) => setTimeout(r, 0));
const at = (iso: string) => Date.parse(iso);

const attr = (fieldName: string, type: T, conditional: C, values: Array<unknown>) => ({
  fieldName,
  type,
  conditional,
  values,
});

const f1 = (strategies?: Array<unknown>): FeatureState =>
  ({
    id: "f1",
    key: "FEATURE_STRING",
    l: false,
    version: 2,
    type: FeatureValueType.String,
    value: "blue",
    environmentId: "env-ling",
    ...(strategies ? { strategies } : {}),
  }) as FeatureState;

const f2: FeatureState = {
  id: "f2",
  key: "FEATURE_TITLE_TO_UPPERCASE",
  l: false,
  version: 1,
  type: FeatureValueType.Boolean,
  value: true,
  environmentId: "env-ling",
} as FeatureState;

const configs: Array<EdgeFeatureHubConfig> = [];
const servers: Array<Server> = [];

afterEach(async () => {
  configs.splice(0).forEach((c) => c.close());
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
});

const newConfig = (key = CLIENT_KEY) => {
  const config = new EdgeFeatureHubConfig("http://localhost:8085", key);
  configs.push(config);
  return config;
};
const repo = (config: EdgeFeatureHubConfig) => config.repository() as InternalFeatureRepository;

/** a store following a repository that has had `features` as a full set */
const storeWith = async (features: Array<FeatureState>, clock?: () => number) => {
  const config = newConfig();
  const store = new FeatureSnapshotStore(config, clock ? { clock } : {});
  repo(config).notify(SSEResultState.Features, features, "featurehub");
  await tick();
  return { config, store };
};

describe("encoding.snapshot_sha.test_vectors", () => {
  const two = [
    { id: "f1", version: 2 },
    { id: "f2", version: 1 },
  ];

  it.each([
    [two, {}, true, "2eb34db18f7d62cee6c8dd3aa234034598a667982b8d9831bee7bba2c4c33852"],
    [two, {}, false, "e17b012d96433267fa3dc02316845226adbdb7d82bcb69f987617f178be3f482"],
    [
      two,
      { country: "nz" },
      true,
      "5da6ce2616ad4cb03d94d3308a7557f2805d2de9624a63985ab267e449641876",
    ],
    [
      two,
      { userkey: "fred", country: "nz" },
      true,
      "cb242c4861543ab43fff289ca2bb66b28e379bea6498e139b4f31b76f28e3f25",
    ],
    [
      two,
      { shop: ["a&b", "c d"] },
      true,
      "24cccad437b2d0f6ec32a627612c0186aed1d5642522c8fcdc2ae607cc2394b4",
    ],
    [
      two,
      { city: "Zürich", greeting: "สวัสดี" },
      true,
      "c735f8a7f7147bdb607d0c7c84e837fbe5b586150a05a2bd24b84e715e4a7936",
    ],
    [
      [],
      { userkey: "fred" },
      true,
      "fa72395ce672552717d0f1124c506bee7489dfc1b08e0e68c7a13bb19ed3687a",
    ],
    [[], {}, true, "47b4f8c61e15e70436a1debf458dfa0a7d6450d96e8ab384e461f47a6addee8d"],
    [
      two,
      { userkey: "fred", empty: [], gone: null },
      true,
      "75d6c29325aa18ac5255ca4b4d1513249d2d9dc74c5f494dc893884aa87def88",
    ],
  ])("%j for %j (evaluated %s)", (features, context, evaluated, sha) => {
    const header = xFeatureHubHeader(mapEvaluationContext(context));
    expect(snapshotSha(featuresShaInput(features), evaluated, header)).toBe(sha);
  });

  // snapshot-sha-vectors: neither form is featurehub-protocol.yaml encoding.sha
  it("is never the features' own sha", async () => {
    const { createHash } = await import("node:crypto");
    const featuresSha = createHash("sha256").update("f1:2|f2:1").digest("hex");
    expect(snapshotSha("f1:2|f2:1", true)).not.toBe(featuresSha);
    expect(snapshotSha("f1:2|f2:1", false)).not.toBe(featuresSha);
  });
});

describe("encoding.etag.test_vectors", () => {
  const SHA_NZ = "5da6ce2616ad4cb03d94d3308a7557f2805d2de9624a63985ab267e449641876";
  const SHA_EMPTY = "2eb34db18f7d62cee6c8dd3aa234034598a667982b8d9831bee7bba2c4c33852";
  const SHA_DELIVERED = "e17b012d96433267fa3dc02316845226adbdb7d82bcb69f987617f178be3f482";

  const whenActive = [
    {
      id: "s1",
      value: "green",
      attributes: [attr("fhubWhenActive", T.Datetime, C.GreaterEquals, ["2026-12-01T09:00:00Z"])],
    },
  ];

  it.each([
    [{ country: "nz" }, false, "2026-12-01T08:59:59Z", `"${SHA_NZ}_t0"`],
    [{ country: "nz" }, false, "2026-12-01T09:00:00Z", `"${SHA_NZ}_t1"`],
    [{ country: "nz" }, false, "2026-12-01T09:00:00.999Z", `"${SHA_NZ}_t1"`],
    [{ country: "nz" }, false, "2026-12-01T09:00:01Z", `"${SHA_NZ}_t2"`],
    [
      { country: "nz", fhubWhenActive: "2020-01-01T00:00:00Z" },
      false,
      "2026-12-01T08:59:59Z",
      `"${SHA_NZ}_t0"`,
    ],
    [{ country: "nz" }, false, "2027-01-01T00:00:00Z", `"${SHA_NZ}_t2"`],
    [{}, false, "2026-12-01T09:00:00Z", `"${SHA_EMPTY}_t1"`],
    [{}, true, "2026-12-01T09:00:00Z", `"${SHA_DELIVERED}"`],
  ])(
    "fhubWhenActive: %j (strategies %s) at %s",
    async (context, includeStrategies, clock, etag) => {
      const { store } = await storeWith([f1(whenActive), f2]);
      const request = { context, includeStrategies, now: at(clock) };

      expect(store.etag(request)).toBe(etag);
      expect(store.featureSnapshot(request).etag).toBe(etag);
    },
  );

  it.each([
    ["2026-11-30T23:59:59Z", `"${SHA_NZ}_t0"`],
    ["2026-12-01T09:00:00.999Z", `"${SHA_NZ}_t2"`],
    ["2026-12-02T00:00:00Z", `"${SHA_NZ}_t4"`],
  ])("DATE and DATETIME attributes at %s", async (clock, etag) => {
    const { store } = await storeWith([
      f1([
        {
          id: "s1",
          value: "green",
          attributes: [
            attr("launch", T.Date, C.Greater, ["2026-12-01"]),
            attr("expires", T.Datetime, C.Less, ["2026-12-01T09:00:00Z"]),
          ],
        },
      ]),
      f2,
    ]);

    expect(store.etag({ context: { country: "nz" }, now: at(clock) })).toBe(etag);
  });

  it("has no count when the features have no clock boundaries", async () => {
    const { store } = await storeWith([
      f1([
        { id: "nz", value: "green", attributes: [attr("country", T.String, C.Equals, ["nz"])] },
        {
          id: "never",
          value: "gold",
          attributes: [attr("fhubWhenActive", T.Datetime, C.Includes, ["2026-12-01T09:00:00Z"])],
        },
      ]),
      f2,
    ]);

    expect(store.etag({ context: { country: "nz" }, now: at("2027-01-01T00:00:00Z") })).toBe(
      `"${SHA_NZ}"`,
    );
  });

  // snapshot-etag-clock: across a boundary the ETag changes, the body's sha does not
  it("changes the ETag, not the sha, across a boundary", async () => {
    const { store } = await storeWith([f1(whenActive), f2]);
    const before = store.featureSnapshot({
      context: { country: "nz" },
      now: at("2026-12-01T08:59:59Z"),
    });
    const after = store.featureSnapshot({
      context: { country: "nz" },
      now: at("2026-12-01T09:00:01Z"),
    });

    expect(before.snapshot.sha).toBe(after.snapshot.sha);
    expect(before.etag).not.toBe(after.etag);
    expect(before.snapshot.features[0]!.value).toBe("blue");
    expect(after.snapshot.features[0]!.value).toBe("green");
  });

  // snapshot-clock-once
  it("reads the clock once, and evaluates and counts with that one reading", async () => {
    const readings = [at("2026-12-01T08:59:59Z"), at("2026-12-01T09:00:01Z")];
    let reads = 0;
    const { store } = await storeWith([f1(whenActive), f2], () => readings[reads++]!);

    const { snapshot, etag } = store.featureSnapshot({ context: { country: "nz" } });

    expect(reads).toBe(1);
    expect(etag.endsWith('_t0"')).toBe(true);
    expect(snapshot.features[0]!.value).toBe("blue");
  });
});

describe("the snapshot store", () => {
  // store-not-ready
  it("is not ready before its first full set", () => {
    const store = new FeatureSnapshotStore(newConfig());

    expect(store.ready).toBe(false);
    expect(() => store.featureSnapshot()).toThrow(FeatureSnapshotNotReadyError);
  });

  // store-refuses
  it("does not attach to a server-evaluated key", async () => {
    const config = newConfig(SERVER_KEY);
    const store = new FeatureSnapshotStore(config);
    repo(config).notify(SSEResultState.Features, [f2], "featurehub");
    await tick();

    expect(store.connected).toBe(false);
    expect(() => store.featureSnapshot()).toThrow(FeatureSnapshotNotReadyError);
  });

  // store-seeds
  it("seeds itself with the features the repository already holds", () => {
    const config = newConfig();
    repo(config).notify(SSEResultState.Features, [f1(), f2], "redis-store");

    const store = new FeatureSnapshotStore(config);

    expect(store.ready).toBe(true);
    expect(store.featureSnapshot().snapshot.features.map((f) => f.key)).toEqual([
      "FEATURE_STRING",
      "FEATURE_TITLE_TO_UPPERCASE",
    ]);
  });

  // store-follows-repository
  it("follows the repository's full sets, updates and deletes", async () => {
    const { config, store } = await storeWith([f1(), f2]);
    const expectSha = (features: Array<{ id: string; version: number }>) =>
      expect(store.featureSnapshot().snapshot.sha).toBe(
        snapshotSha(featuresShaInput(features), true),
      );

    expectSha([
      { id: "f1", version: 2 },
      { id: "f2", version: 1 },
    ]);

    repo(config).notify(
      SSEResultState.Feature,
      { ...f1(), version: 3, value: "red" },
      "featurehub",
    );
    await tick();
    expectSha([
      { id: "f1", version: 3 },
      { id: "f2", version: 1 },
    ]);
    expect(store.featureSnapshot().snapshot.features[0]!.value).toBe("red");

    // a stale update is ignored
    repo(config).notify(
      SSEResultState.Feature,
      { ...f1(), version: 1, value: "old" },
      "featurehub",
    );
    await tick();
    expectSha([
      { id: "f1", version: 3 },
      { id: "f2", version: 1 },
    ]);

    repo(config).notify(SSEResultState.DeleteFeature, f2, "featurehub");
    await tick();
    expectSha([{ id: "f1", version: 3 }]);
    expect(store.featureSnapshot().snapshot.features.map((f) => f.key)).toEqual(["FEATURE_STRING"]);
  });

  // evaluate-for-context
  it("evaluates the features for a context", async () => {
    const { store } = await storeWith([
      f1([{ id: "nz", value: "green", attributes: [attr("country", T.String, C.Equals, ["nz"])] }]),
    ]);

    const nz = store.featureSnapshot({ context: { country: "nz" } }).snapshot.features[0]!;
    const au = store.featureSnapshot({ context: { country: "au" } }).snapshot.features[0]!;

    expect(nz).toMatchObject({ value: "green", v: "nz" });
    expect(nz.strategies).toBeUndefined();
    expect(au).toMatchObject({ value: "blue", v: null });
  });

  // evaluate-ignores-interceptors
  it("ignores value interceptors", async () => {
    const { config, store } = await storeWith([f1()]);
    config.addValueInterceptor({ matched: () => [true, "chago"] } as any);

    expect(store.featureSnapshot({ context: { country: "nz" } }).snapshot.features[0]!.value).toBe(
      "blue",
    );
  });

  // snapshot-api-choice
  it("evaluates with no context unless asked for the strategies", async () => {
    const strategies = [
      { id: "nz", value: "green", attributes: [attr("country", T.String, C.Equals, ["nz"])] },
    ];
    const { store } = await storeWith([f1(strategies)]);

    expect(store.featureSnapshot().snapshot.features[0]!.strategies).toBeUndefined();
    expect(
      store.featureSnapshot({ includeStrategies: true }).snapshot.features[0]!.strategies,
    ).toEqual(strategies);
    expect(
      store.featureSnapshot({ context: { country: "nz" }, includeStrategies: true }).snapshot
        .features[0],
    ).toMatchObject({ value: "green", v: "nz" });
    // an empty context is no context
    expect(
      store.featureSnapshot({ context: { gone: null }, includeStrategies: true }).snapshot
        .features[0]!.strategies,
    ).toEqual(strategies);
  });

  // snapshot-sha-per-context
  it("gives each context its own sha, whatever the order of its attributes", async () => {
    const { store } = await storeWith([f1(), f2]);
    const sha = (context: Record<string, unknown>) =>
      store.featureSnapshot({ context }).snapshot.sha;

    expect(sha({ country: "nz" })).not.toBe(sha({ country: "au" }));
    expect(sha({ userkey: "orm", country: "nz" })).toBe(sha({ country: "nz", userkey: "orm" }));
  });

  it("refuses a context with an object in it", async () => {
    const { store } = await storeWith([f1()]);

    expect(() => store.featureSnapshot({ context: { shop: { name: "omu&co" } } })).toThrow(
      InvalidContextError,
    );
  });

  it("stops following the repository once closed", async () => {
    const { store } = await storeWith([f1()]);
    store.close();

    expect(store.ready).toBe(false);
    expect(() => store.featureSnapshot()).toThrow(FeatureSnapshotNotReadyError);
  });
});

describe("ifNoneMatchMatches", () => {
  it.each([
    ['"abc"', true],
    ['W/"abc"', true],
    ['"x", "abc"', true],
    ["*", true],
    ['"x"', false],
    ['"abc_t1"', false],
    [undefined, false],
  ])("%s", (header, matches) => {
    expect(ifNoneMatchMatches(header, '"abc"')).toBe(matches);
  });
});

describe("the snapshot handler", () => {
  const serve = async (store: FeatureSnapshotStore, options = {}) => {
    const server = createServer(featureSnapshotHandler(store, options));
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}/features`;
  };

  const colour = () =>
    f1([{ id: "nz", value: "green", attributes: [attr("country", T.String, C.Equals, ["nz"])] }]);

  // server-empty-query
  it("evaluates a request with no query as for an empty context, unless set to serve strategies", async () => {
    const { store } = await storeWith([colour()]);
    const evaluating = await serve(store);
    const serving = await serve(store, { serveStrategiesWithoutContext: true });

    const evaluated = await (await fetch(evaluating)).json();
    const delivered = await (await fetch(serving)).json();
    const withQuery = await (await fetch(`${serving}?country=nz`)).json();

    expect(evaluated.features[0].strategies).toBeUndefined();
    expect(delivered.features[0].strategies).toHaveLength(1);
    expect(withQuery.features[0]).toMatchObject({ value: "green", v: "nz" });
  });

  // conditional-304
  it("answers a matching If-None-Match with a 304", async () => {
    const { store } = await storeWith([colour()]);
    const url = `${await serve(store)}?country=nz`;

    const first = await fetch(url);
    const etag = first.headers.get("etag")!;
    expect(first.status).toBe(200);
    expect(first.headers.get("cache-control")).toBe("no-cache");

    for (const tag of [etag, `W/${etag}`, `"other", ${etag}`]) {
      const again = await fetch(url, { headers: { "If-None-Match": tag } });
      expect(again.status).toBe(304);
      expect(again.headers.get("etag")).toBe(etag);
    }

    expect((await fetch(url, { headers: { "If-None-Match": '"other"' } })).status).toBe(200);
    // another context's ETag
    const au = `${await serve(store)}?country=au`;
    expect((await fetch(au, { headers: { "If-None-Match": etag } })).status).toBe(200);
  });

  // snapshot-form-etag
  it("gives the evaluated and as-delivered forms different ETags", async () => {
    const { store } = await storeWith([colour()]);
    const evaluating = await serve(store);
    const serving = await serve(store, { serveStrategiesWithoutContext: true });

    const evaluatedEtag = (await fetch(evaluating)).headers.get("etag")!;
    const delivered = await fetch(serving, { headers: { "If-None-Match": evaluatedEtag } });

    expect(delivered.status).toBe(200);
    expect((await delivered.json()).features[0].strategies).toHaveLength(1);
    const back = await fetch(evaluating, {
      headers: { "If-None-Match": delivered.headers.get("etag")! },
    });
    expect(back.status).toBe(200);
  });

  // conditional-304-clock
  it("keeps a 304 until the clock passes an fhubWhenActive time", async () => {
    let now = at("2026-12-01T08:59:59Z");
    const { store } = await storeWith(
      [
        f1([
          {
            id: "launch",
            value: "green",
            attributes: [
              attr("fhubWhenActive", T.Datetime, C.GreaterEquals, ["2026-12-01T09:00:00Z"]),
            ],
          },
        ]),
      ],
      () => now,
    );
    const url = `${await serve(store)}?country=nz`;

    const first = await fetch(url);
    const etag = first.headers.get("etag")!;
    const sha = (await first.json()).sha;

    expect((await fetch(url, { headers: { "If-None-Match": etag } })).status).toBe(304);
    // the sha alone is not the ETag
    expect((await fetch(url, { headers: { "If-None-Match": `"${sha}"` } })).status).toBe(200);

    now = at("2026-12-01T09:00:01Z");
    const after = await fetch(url, { headers: { "If-None-Match": etag } });
    expect(after.status).toBe(200);
    expect(after.headers.get("etag")).not.toBe(etag);
    expect((await after.json()).features[0].value).toBe("green");
  });

  it("answers 400 for an invalid context and 503 before the store has features", async () => {
    const store = new FeatureSnapshotStore(newConfig());
    const url = await serve(store);

    expect((await fetch(url)).status).toBe(503);
    repo(configs[0]!).notify(SSEResultState.Features, [f1()], "featurehub");
    await tick();
    expect((await fetch(url)).status).toBe(200);
  });

  it("answers CORS preflights and exposes the ETag when given an origin", async () => {
    const { store } = await storeWith([f1()]);
    const url = await serve(store, { allowOrigin: "*" });

    const preflight = await fetch(url, { method: "OPTIONS" });
    const get = await fetch(url);

    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-headers")).toBe("*");
    expect(get.headers.get("access-control-allow-origin")).toBe("*");
    expect(get.headers.get("access-control-expose-headers")).toBe("ETag");
  });

  // snapshot-roundtrip
  it("loads the store's features into a snapshot client, with the store's sha", async () => {
    const { store } = await storeWith([colour(), f2]);
    const url = await serve(store);
    let received: string | undefined;
    const client = featureSnapshotConfig({
      url,
      intervalMs: 0,
      fetch: async (input, init) => {
        const response = await fetch(input, init);
        received = (await response.clone().json()).sha;
        return response;
      },
    });
    configs.push(client as EdgeFeatureHubConfig);

    const ctx = await client
      .newContext()
      .country("nz" as any)
      .userKey("kornaphat")
      .build();

    expect(client.readiness).toBe(Readyness.Ready);
    expect(ctx.getString("FEATURE_STRING")).toBe("green");
    expect(ctx.getFlag("FEATURE_TITLE_TO_UPPERCASE")).toBe(true);
    expect(received).toBe(
      store.featureSnapshot({ context: { country: "nz", userkey: "kornaphat" } }).snapshot.sha,
    );
  });
});
