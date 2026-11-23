import { createServer, type Server } from "http";
import type { AddressInfo } from "net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  EdgeFeatureHubConfig,
  featureSnapshot,
  featureSnapshotHandler,
  type FeatureSnapshotHandlerOptions,
  type FeatureState,
  FeatureValueType,
  ifNoneMatchMatches,
  type InternalFeatureRepository,
  InvalidContextError,
  RolloutStrategyAttributeConditional,
  RolloutStrategyFieldType,
  SSEResultState,
} from "../index";

// feature-snapshot-protocol.yaml conformance evaluate-for-context: colour is blue, green for country nz
const colour: FeatureState = {
  id: "colour-id",
  key: "colour",
  version: 1,
  type: FeatureValueType.String,
  value: "blue",
  l: false,
  environmentId: "env",
  strategies: [
    {
      id: "nz",
      value: "green",
      attributes: [
        {
          fieldName: "country",
          type: RolloutStrategyFieldType.String,
          conditional: RolloutStrategyAttributeConditional.Equals,
          values: ["nz"],
        },
      ],
    },
  ],
} as FeatureState;

const plain: FeatureState = {
  id: "plain-id",
  key: "keep_silent",
  version: 3,
  type: FeatureValueType.Boolean,
  value: true,
  l: false,
  v: "kept",
  environmentId: "env",
} as FeatureState;

function configWithFeatures(apiKey = "env/ling*orm") {
  const config = new EdgeFeatureHubConfig("http://localhost:8085", apiKey);
  (config.repository() as InternalFeatureRepository).notify(
    SSEResultState.Features,
    [colour, plain],
    "test",
  );
  return config;
}

describe("featureSnapshot", () => {
  it("evaluates for a context (evaluate-for-context)", () => {
    const config = configWithFeatures();

    const nz = featureSnapshot(config, { context: { country: "nz" } }).features[0]!;
    expect(nz).toMatchObject({ value: "green", v: "nz" });
    expect(nz.strategies).toBeUndefined();

    expect(featureSnapshot(config, { context: { country: "au" } }).features[0]).toMatchObject({
      value: "blue",
      v: null,
    });
  });

  it("keeps a feature with no strategies as it is, v included", () => {
    expect(featureSnapshot(configWithFeatures(), {}).features[1]).toEqual(plain);
  });

  // snapshot-api-choice
  it("evaluates as for an empty context by default, and gives the strategies only when asked", () => {
    const config = configWithFeatures();

    expect(featureSnapshot(config).features[0]!.strategies).toBeUndefined();
    expect(featureSnapshot(config, { context: {} }).features[0]).toMatchObject({
      value: "blue",
      v: null,
    });
    expect(
      featureSnapshot(config, { includeStrategies: true }).features[0]!.strategies,
    ).toHaveLength(1);
    expect(
      featureSnapshot(config, { context: { country: "nz" }, includeStrategies: true }).features[0],
    ).toMatchObject({ value: "green", v: "nz" });
  });

  it("gives the repository's SHA whichever form it gives", () => {
    const config = configWithFeatures();
    const sha = (config.repository() as InternalFeatureRepository).featuresSha;

    expect(featureSnapshot(config).sha).toBe(sha);
    expect(featureSnapshot(config, { includeStrategies: true }).sha).toBe(sha);
    expect(featureSnapshot(config, { context: { country: "nz" } }).sha).toBe(sha);
  });

  it("maps the context: targetingKey is the user key, and fhubWhenActive is dropped", () => {
    const config = configWithFeatures();

    expect(() =>
      featureSnapshot(config, {
        context: { targetingKey: "lingling", fhubWhenActive: "2020-01-01T00:00:00Z" },
      }),
    ).not.toThrow();
  });

  it("refuses a context holding an object", () => {
    expect(() =>
      featureSnapshot(configWithFeatures(), { context: { shop: { name: "omu&co" } } }),
    ).toThrow(InvalidContextError);
  });

  it("refuses to serve with a server-evaluated key", () => {
    expect(() => featureSnapshot(configWithFeatures("env/sethratanapong"))).toThrow(
      /client-evaluated/,
    );
  });
});

describe("ifNoneMatchMatches (conditional-304)", () => {
  const etag = '"abc"';

  it.each([['"abc"'], ['W/"abc"'], ['"x", "abc"'], ["*"]])("matches %s", (header) => {
    expect(ifNoneMatchMatches(header, etag)).toBe(true);
  });

  it.each([['"x"'], [undefined], [""]])("does not match %s", (header) => {
    expect(ifNoneMatchMatches(header, etag)).toBe(false);
  });
});

describe("featureSnapshotHandler", () => {
  let server: Server;
  let base: string;

  const serve = async (
    config: EdgeFeatureHubConfig,
    options?: FeatureSnapshotHandlerOptions,
  ): Promise<void> => {
    server = createServer(featureSnapshotHandler(config, options));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/features`;
  };

  afterEach(async () => {
    await new Promise((r) => server.close(r));
  });

  beforeEach(() => {
    base = "";
  });

  it("serves the snapshot with its ETag, evaluated for the query", async () => {
    const config = configWithFeatures();
    await serve(config);

    const response = await fetch(`${base}?country=nz&userkey=fred`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBe(`"${body.sha}"`);
    expect(response.headers.get("cache-control")).toBe("no-cache");
    expect(body.features[0]).toMatchObject({ value: "green", v: "nz" });
  });

  it("answers 304 to a matching If-None-Match", async () => {
    await serve(configWithFeatures());
    const etag = (await fetch(base)).headers.get("etag")!;

    const response = await fetch(base, { headers: { "If-None-Match": `W/${etag}` } });

    expect(response.status).toBe(304);
    expect(response.headers.get("etag")).toBe(etag);
  });

  // server-empty-query
  it("evaluates a request with no query as for an empty context, unless told to serve strategies", async () => {
    await serve(configWithFeatures());
    expect((await (await fetch(base)).json()).features[0].strategies).toBeUndefined();
    await new Promise((r) => server.close(r));

    await serve(configWithFeatures(), { serveStrategiesWithoutContext: true });
    expect((await (await fetch(base)).json()).features[0].strategies).toHaveLength(1);
    expect((await (await fetch(`${base}?country=nz`)).json()).features[0]).toMatchObject({
      value: "green",
    });
  });

  it("decodes repeated parameters as a list, and + as a space", async () => {
    const config = new EdgeFeatureHubConfig("http://localhost:8085", "env/ling*orm");
    (config.repository() as InternalFeatureRepository).notify(
      SSEResultState.Features,
      [
        {
          ...colour,
          strategies: [
            {
              id: "pastry",
              value: "gold",
              attributes: [
                {
                  fieldName: "shops",
                  type: RolloutStrategyFieldType.String,
                  conditional: RolloutStrategyAttributeConditional.Equals,
                  values: ["kwong pastry"],
                },
              ],
            },
          ],
        },
      ],
      "test",
    );
    await serve(config);

    const body = await (await fetch(`${base}?shops=omu&shops=kwong+pastry`)).json();

    expect(body.features[0]).toMatchObject({ value: "gold", v: "pastry" });
  });

  it("answers 503 before the server has any features", async () => {
    await serve(new EdgeFeatureHubConfig("http://localhost:8085", "env/ling*orm"));

    expect((await fetch(base)).status).toBe(503);
  });

  it("answers 503 rather than serving with a server-evaluated key", async () => {
    await serve(configWithFeatures("env/kornaphat"));

    expect((await fetch(base)).status).toBe(503);
  });

  it("answers CORS preflights and exposes the ETag when given an origin", async () => {
    await serve(configWithFeatures(), { allowOrigin: "*" });

    const preflight = await fetch(base, { method: "OPTIONS" });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("*");

    const response = await fetch(base);
    expect(response.headers.get("access-control-expose-headers")).toBe("ETag");
  });
});
