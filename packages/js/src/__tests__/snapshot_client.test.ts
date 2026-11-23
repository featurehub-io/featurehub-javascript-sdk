import { createServer, type IncomingMessage, type Server, type ServerResponse } from "http";
import type { AddressInfo } from "net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  featureSnapshotConfig,
  featuresSha,
  type FeatureState,
  FeatureValueType,
  type InternalFeatureRepository,
  Readyness,
  RolloutStrategyAttributeConditional,
  RolloutStrategyFieldType,
  snapshotRequestUrl,
} from "../index";

const until = async (check: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 10));
  }
};

const feature = (key: string, version: number, value: unknown): FeatureState =>
  ({
    id: `${key}-id`,
    key,
    version,
    type: FeatureValueType.String,
    value,
    l: false,
  }) as FeatureState;

describe("snapshotRequestUrl", () => {
  it("adds the context after the URL's own parameters, a list as repeated parameters", () => {
    expect(
      snapshotRequestUrl("https://my.app/api/features?app=web", {
        userkey: "fred",
        country: "nz",
        tags: ["a", "b"],
      }),
    ).toBe("https://my.app/api/features?app=web&userkey=fred&country=nz&tags=a&tags=b");
  });

  it("uses the URL unchanged when the context has no attributes", () => {
    expect(snapshotRequestUrl("https://my.app/api/features", {})).toBe(
      "https://my.app/api/features",
    );
  });

  it("lets a context attribute replace a URL parameter of the same name, and drops fhubWhenActive", () => {
    expect(
      snapshotRequestUrl("https://my.app/features?country=au", {
        country: "th",
        fhubWhenActive: "2020-01-01T00:00:00Z",
      }),
    ).toBe("https://my.app/features?country=th");
  });

  it("sends a date-time as UTC ISO-8601", () => {
    expect(
      snapshotRequestUrl("https://my.app/features", { since: new Date("2026-11-17T02:47:28Z") }),
    ).toBe("https://my.app/features?since=2026-11-17T02%3A47%3A28.000Z");
  });
});

describe("the snapshot client", () => {
  let server: Server;
  let base: string;
  let requests: IncomingMessage[];
  let respond: (req: IncomingMessage, res: ServerResponse, n: number) => void;
  let configs: Array<ReturnType<typeof featureSnapshotConfig>>;

  const ok = (res: ServerResponse, features: FeatureState[], etag?: string) => {
    res.writeHead(200, {
      "content-type": "application/json",
      ...(etag ? { etag } : {}),
    });
    res.end(JSON.stringify({ features }));
  };

  beforeEach(async () => {
    requests = [];
    configs = [];
    server = createServer((req, res) => {
      requests.push(req);
      respond(req, res, requests.length);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/features`;
  });

  afterEach(async () => {
    configs.forEach((c) => c.close());
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  });

  const make = (options: Parameters<typeof featureSnapshotConfig>[0]) => {
    const config = featureSnapshotConfig(options);
    configs.push(config);
    return config;
  };
  const repo = (config: ReturnType<typeof featureSnapshotConfig>) =>
    config.repository() as InternalFeatureRepository;

  it("sends the context and loads the server's features", async () => {
    respond = (_req, res) => ok(res, [feature("colour", 1, "green")]);
    const config = make({ url: base, intervalMs: 0 });

    const context = await config
      .newContext()
      .country("nz" as any)
      .userKey("lingling")
      .build();

    expect(requests[0]!.url).toBe("/features?userkey=lingling&country=nz");
    expect(requests[0]!.headers["accept"]).toBe("application/json");
    expect(context.getString("colour")).toBe("green");
    expect(config.readiness).toBe(Readyness.Ready);
  });

  it("evaluates locally when it does not send the context", async () => {
    respond = (_req, res) =>
      ok(res, [
        {
          ...feature("colour", 1, "blue"),
          strategies: [
            {
              id: "th",
              value: "gold",
              attributes: [
                {
                  fieldName: "country",
                  type: RolloutStrategyFieldType.String,
                  conditional: RolloutStrategyAttributeConditional.Equals,
                  values: ["th"],
                },
              ],
            },
          ],
        } as FeatureState,
      ]);
    const config = make({ url: base, sendContext: false, intervalMs: 0 });

    const thai = await config.newContext().attributeValue("country", "th").build();
    await until(() => repo(config).readyness === Readyness.Ready);
    const other = config.newContext().attributeValue("country", "nz");

    expect(requests[0]!.url).toBe("/features");
    expect(thai.getString("colour")).toBe("gold");
    expect(other.getString("colour")).toBe("blue");
  });

  it("sends the ETag back for the same URL, and keeps the features on a 304", async () => {
    respond = (req, res, n) => {
      if (n === 1) ok(res, [feature("colour", 1, "green")], '"v1"');
      else {
        res.writeHead(req.headers["if-none-match"] === '"v1"' ? 304 : 500);
        res.end();
      }
    };
    const config = make({ url: base, intervalMs: 5000 });
    const ctx = await config.newContext().userKey("orm").build();

    await until(() => requests.length >= 2, 7000);

    expect(requests[1]!.headers["if-none-match"]).toBe('"v1"');
    expect(ctx.getString("colour")).toBe("green");
  }, 10000);

  it("falls back to the snapshot's sha in quotes when the server sends no ETag", async () => {
    const features = [feature("colour", 1, "green")];
    respond = (_req, res) => ok(res, features);
    const config = make({ url: base, intervalMs: 5000 });

    await config.newContext().userKey("orm").build();
    await until(() => requests.length >= 2, 7000);

    expect(requests[1]!.headers["if-none-match"]).toBe(`"${featuresSha(features)}"`);
  }, 10000);

  // client-if-none-match-per-url
  it("sends no If-None-Match on the first request after a context change", async () => {
    respond = (_req, res) => ok(res, [feature("colour", 1, "green")], '"v1"');
    const config = make({ url: base, intervalMs: 0 });
    const ctx = config.newContext();

    await ctx.userKey("orm").build();
    await ctx.userKey("ling").build();

    expect(requests).toHaveLength(2);
    expect(requests[1]!.url).toBe("/features?userkey=ling");
    expect(requests[1]!.headers["if-none-match"]).toBeUndefined();
  });

  // client-discards-stale-context
  it("does not load a response that arrives after the context changed", async () => {
    let release: (() => void) | undefined;
    respond = (req, res) => {
      if (req.url === "/features?userkey=orm") {
        release = () => ok(res, [feature("colour", 1, "orm-colour")]);
      } else {
        ok(res, [feature("colour", 2, "ling-colour")]);
      }
    };
    const config = make({ url: base, intervalMs: 0 });
    const ctx = config.newContext();

    const forOrm = ctx.userKey("orm").build();
    await until(() => release !== undefined);
    const forLing = ctx.userKey("ling").build();
    release!();
    await Promise.all([forOrm, forLing]);

    expect(ctx.getString("colour")).toBe("ling-colour");
  });

  // client-rejection
  it.each([401, 408])(
    "stops for good on a %d and tells the repository it failed",
    async (status) => {
      respond = (_req, res) => {
        res.writeHead(status);
        res.end();
      };
      const config = make({ url: base, intervalMs: 5000 });

      await config.newContext().userKey("kornaphat").build();
      await new Promise((r) => setTimeout(r, 50));

      expect(config.readiness).toBe(Readyness.Failed);
      expect(requests).toHaveLength(1);
    },
  );

  // client-retry
  it.each([500, 429])(
    "retries after a %d, staying not ready until a request succeeds",
    async (status) => {
      respond = (_req, res, n) => {
        if (n === 1) {
          res.writeHead(status);
          res.end();
        } else {
          ok(res, [feature("colour", 1, "green")]);
        }
      };
      const config = make({ url: base, intervalMs: 5000 });

      await config.newContext().userKey("sirilak").build();
      expect(config.readiness).toBe(Readyness.NotReady);

      await until(() => config.readiness === Readyness.Ready, 7000);
      expect(requests).toHaveLength(2);
    },
    10000,
  );

  it("polls passively only when a feature is evaluated after the interval", async () => {
    respond = (_req, res) => ok(res, [feature("colour", 1, "green")]);
    const config = make({ url: base, intervalMs: 0, passive: true });
    const ctx = await config.newContext().userKey("chago").build();

    ctx.getString("colour");
    ctx.getString("colour");
    await new Promise((r) => setTimeout(r, 50));

    // an interval of 0 fetches once, however many evaluations follow
    expect(requests).toHaveLength(1);
  });

  it("sends the config's extra headers", async () => {
    respond = (_req, res) => ok(res, [feature("colour", 1, "green")]);
    const config = make({
      url: base,
      intervalMs: 0,
      headers: { "x-gateway-key": "always-wonder" },
    });

    await config.newContext().userKey("orm").build();

    expect(requests[0]!.headers["x-gateway-key"]).toBe("always-wonder");
  });

  it("refuses an interval under 5 seconds", () => {
    expect(() => featureSnapshotConfig({ url: base, intervalMs: 1000 })).toThrow(/5000ms/);
  });
});
