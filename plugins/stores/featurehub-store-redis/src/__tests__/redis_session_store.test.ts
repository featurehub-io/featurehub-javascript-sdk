import { createHash } from "node:crypto";

import {
  ClientFeatureRepository,
  type FeatureHubConfig,
  type FeatureState,
  FeatureValueType,
  SSEResultState,
} from "featurehub-javascript-core-sdk";
import { WatchError } from "redis";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RedisSessionStoreUrl } from "../redis_session_store";

// ── helpers ──────────────────────────────────────────────────────────────────

/** Drain all pending microtasks and I/O callbacks so fire-and-forget async chains complete. */
function flushAsync(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function computeSha(features: FeatureState[]): string {
  const input = features
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((f) => `${f.id}:${f.version ?? 0}`)
    .join("|");
  return createHash("sha256").update(input).digest("hex");
}

function feat(overrides: Partial<FeatureState> = {}): FeatureState {
  return {
    id: "f1",
    key: "flag",
    version: 1,
    type: FeatureValueType.Boolean,
    value: true,
    ...overrides,
  } as FeatureState;
}

// ── fake Redis client ─────────────────────────────────────────────────────────

interface FakeMulti {
  set(key: string, value: string): FakeMulti;
  exec(): Promise<Array<unknown> | null>;
}

class FakeRedis {
  store: Map<string, string> = new Map();
  isOpen = false;
  /** Throw WatchError from exec() this many times before succeeding. */
  watchFailTimes = 0;

  async connect(): Promise<void> {
    this.isOpen = true;
  }

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async watch(_key: string): Promise<void> {}

  async unwatch(): Promise<void> {}

  multi(): FakeMulti {
    const store = this.store;
    const fail = () => {
      if (this.watchFailTimes > 0) {
        this.watchFailTimes--;
        throw new WatchError();
      }
    };
    const ops: Array<{ key: string; value: string }> = [];
    const m: FakeMulti = {
      set(key: string, value: string): FakeMulti {
        ops.push({ key, value });
        return m;
      },
      async exec(): Promise<Array<unknown> | null> {
        fail();
        for (const op of ops) {
          store.set(op.key, op.value);
        }
        return ops.map(() => "OK");
      },
    };
    return m;
  }
}

// ── config / store factories ──────────────────────────────────────────────────

const ENV_ID = "env-abc";

function makeConfig(
  repo: ClientFeatureRepository,
  opts: { clientEval?: boolean; apiKeys?: string[] } = {},
): FeatureHubConfig {
  return {
    environmentId: ENV_ID,
    clientEvaluated: () => opts.clientEval ?? true,
    getApiKeys: () => opts.apiKeys ?? ["key*"],
    repository: () => repo,
    registerRawUpdateFeatureListener: (listener: unknown) =>
      repo.registerRawUpdateFeatureListener(listener as never),
  } as unknown as FeatureHubConfig;
}

function makeStore(
  fakeRedis: FakeRedis,
  repo: ClientFeatureRepository,
  configOpts: { clientEval?: boolean; apiKeys?: string[] } = {},
  storeOpts: Partial<{
    prefix: string;
    backoffTimeout: number;
    retryUpdateCount: number;
    delayInit: boolean;
  }> = {},
) {
  const config = makeConfig(repo, configOpts);
  if (storeOpts.delayInit === undefined) {
    // reverse of normal
    storeOpts.delayInit = true;
  }
  const store = new RedisSessionStoreUrl("redis://unused", config, {
    refreshTimeout: 9999, // disable timer in most tests
    backoffTimeout: 0,
    ...storeOpts,
  });
  (store as unknown as { _client: FakeRedis })._client = fakeRedis;
  return { store, config };
}

function seedRedis(r: FakeRedis, features: FeatureState[]) {
  r.store.set(`featurehub_${ENV_ID}_sha`, computeSha(features));
  r.store.set(`featurehub_${ENV_ID}`, JSON.stringify(features));
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("RedisSessionStore", () => {
  let repo: ClientFeatureRepository;
  let redis: FakeRedis;

  beforeEach(() => {
    repo = new ClientFeatureRepository();
    redis = new FakeRedis();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── init ────────────────────────────────────────────────────────────────────

  describe("init", () => {
    it("connects to redis if not already open", async () => {
      const { store } = makeStore(redis, repo);
      const spy = vi.spyOn(redis, "connect");
      await store.init();
      expect(spy).toHaveBeenCalledOnce();
      store.close();
    });

    it("skips connect when client is already open", async () => {
      redis.isOpen = true;
      const { store } = makeStore(redis, repo);
      const spy = vi.spyOn(redis, "connect");
      await store.init();
      expect(spy).not.toHaveBeenCalled();
      store.close();
    });

    it("registers itself as a RawUpdateFeatureListener", async () => {
      const { store, config } = makeStore(redis, repo);
      const spy = vi.spyOn(config, "registerRawUpdateFeatureListener");
      await store.init();
      expect(spy).toHaveBeenCalledOnce();
      store.close();
    });

    it("does not notify repo when Redis is empty", async () => {
      const spy = vi.spyOn(repo, "notify");
      const { store } = makeStore(redis, repo);
      await store.init();
      expect(spy).not.toHaveBeenCalled();
      store.close();
    });

    it("replays stored features into repo on startup", async () => {
      const features = [feat({ id: "f1" }), feat({ id: "f2", key: "other" })];
      seedRedis(redis, features);

      const spy = vi.spyOn(repo, "notify");
      const { store } = makeStore(redis, repo);
      await store.init();

      expect(spy).toHaveBeenCalledOnce();
      expect(spy).toHaveBeenCalledWith(SSEResultState.Features, features, "redis-store");
      store.close();
    });

    it("refuses to init with server-evaluated API keys", async () => {
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const { store, config } = makeStore(redis, repo, {
        clientEval: false,
        apiKeys: ["server-key"],
      });
      const regSpy = vi.spyOn(config, "registerRawUpdateFeatureListener");
      await store.init();
      expect(regSpy).not.toHaveBeenCalled();
      errSpy.mockRestore();
    });

    it("allows init with empty API keys regardless of clientEvaluated", async () => {
      const { store, config } = makeStore(redis, repo, { clientEval: false, apiKeys: [] });
      const regSpy = vi.spyOn(config, "registerRawUpdateFeatureListener");
      await store.init();
      expect(regSpy).toHaveBeenCalledOnce();
      store.close();
    });

    it("connected is true after init", async () => {
      const { store } = makeStore(redis, repo);
      await store.init();
      expect(store.connected).toBe(true);
      store.close();
    });

    it("connected is false before init", () => {
      const { store } = makeStore(redis, repo);
      expect(store.connected).toBe(false);
    });
  });

  // ── processUpdates ──────────────────────────────────────────────────────────

  describe("processUpdates", () => {
    it("ignores updates from redis-store source", async () => {
      const { store } = makeStore(redis, repo);
      await store.init();
      store.processUpdates([feat()], "redis-store");
      await flushAsync();
      expect(redis.store.size).toBe(0);
      store.close();
    });

    it("writes features and sha to Redis", async () => {
      const { store } = makeStore(redis, repo);
      await store.init();
      const features = [feat({ id: "f1" })];

      store.processUpdates(features, "polling");
      await flushAsync();

      expect(redis.store.get(`featurehub_${ENV_ID}`)).toBe(JSON.stringify(features));
      expect(redis.store.get(`featurehub_${ENV_ID}_sha`)).toBe(computeSha(features));
      store.close();
    });

    it("skips write when computed sha matches Redis sha", async () => {
      const features = [feat({ id: "f1" })];
      seedRedis(redis, features);

      const { store } = makeStore(redis, repo);
      await store.init();

      const setSpy = vi.spyOn(redis, "set");
      store.processUpdates(features, "polling");
      await flushAsync();
      expect(setSpy).not.toHaveBeenCalled();
      store.close();
    });

    it("skips write when all incoming features are older than Redis", async () => {
      const newerFeatures = [feat({ id: "f1", version: 5 })];
      seedRedis(redis, newerFeatures);

      const { store } = makeStore(redis, repo);
      await store.init();

      const setSpy = vi.spyOn(redis, "set");
      store.processUpdates([feat({ id: "f1", version: 1 })], "polling");
      await flushAsync();
      expect(setSpy).not.toHaveBeenCalled();
      store.close();
    });

    it("merges when an external writer has changed Redis between init and processUpdates", async () => {
      // Start with f1v1 only in Redis
      const initialFeatures = [feat({ id: "f1", version: 1 })];
      seedRedis(redis, initialFeatures);

      const { store } = makeStore(redis, repo);
      await store.init(); // _lastSha = sha([f1v1])

      // Simulate another process writing [f1v1, f2v5] to Redis
      const externalFeatures = [
        feat({ id: "f1", version: 1 }),
        feat({ id: "f2", key: "b", version: 5 }),
      ];
      seedRedis(redis, externalFeatures); // _lastSha still sha([f1v1]) but redis sha is different

      // Incoming from FeatureHub: f1 is newer, f2 is older than what the external writer stored
      store.processUpdates(
        [feat({ id: "f1", version: 3 }), feat({ id: "f2", key: "b", version: 2 })],
        "polling",
      );
      await flushAsync();

      const stored = JSON.parse(redis.store.get(`featurehub_${ENV_ID}`)!) as FeatureState[];
      const f1 = stored.find((f) => f.id === "f1");
      const f2 = stored.find((f) => f.id === "f2");
      expect(f1?.version).toBe(3); // incoming newer
      expect(f2?.version).toBe(5); // external writer's version is newer
      store.close();
    });

    it("writes incoming directly when we are the sole writer (currentSha === _lastSha)", async () => {
      // Seed Redis, init (so _lastSha = sha(seed)), then processUpdates
      const seedFeatures = [feat({ id: "f1", version: 1 })];
      seedRedis(redis, seedFeatures);

      const { store } = makeStore(redis, repo);
      await store.init(); // _lastSha = sha([f1v1])

      // No external writer — redis sha still matches _lastSha
      store.processUpdates([feat({ id: "f1", version: 2 })], "polling");
      await flushAsync();

      const stored = JSON.parse(redis.store.get(`featurehub_${ENV_ID}`)!) as FeatureState[];
      expect(stored[0]?.version).toBe(2);
      store.close();
    });
  });

  // ── processUpdate ───────────────────────────────────────────────────────────

  describe("processUpdate", () => {
    it("ignores updates from redis-store source", async () => {
      const { store } = makeStore(redis, repo);
      await store.init();
      store.processUpdate(feat(), "redis-store");
      await flushAsync();
      expect(redis.store.size).toBe(0);
      store.close();
    });

    it("adds a new feature when Redis is empty", async () => {
      const { store } = makeStore(redis, repo);
      await store.init();
      store.processUpdate(feat({ id: "f1", version: 1 }), "streaming");
      await flushAsync();

      const stored = JSON.parse(redis.store.get(`featurehub_${ENV_ID}`)!) as FeatureState[];
      expect(stored).toHaveLength(1);
      expect(stored[0]?.id).toBe("f1");
      store.close();
    });

    it("replaces an existing feature with a newer version", async () => {
      const existing = [feat({ id: "f1", version: 1, value: false })];
      seedRedis(redis, existing);

      const { store } = makeStore(redis, repo);
      await store.init();
      store.processUpdate(feat({ id: "f1", version: 2, value: true }), "streaming");
      await flushAsync();

      const stored = JSON.parse(redis.store.get(`featurehub_${ENV_ID}`)!) as FeatureState[];
      expect(stored[0]?.version).toBe(2);
      expect(stored[0]?.value).toBe(true);
      store.close();
    });

    it("skips write when Redis already has same or newer version", async () => {
      const existing = [feat({ id: "f1", version: 5 })];
      seedRedis(redis, existing);

      const { store } = makeStore(redis, repo);
      await store.init();

      const setSpy = vi.spyOn(redis, "set");
      store.processUpdate(feat({ id: "f1", version: 3 }), "streaming");
      await flushAsync();
      expect(setSpy).not.toHaveBeenCalled();
      store.close();
    });

    it("adds alongside existing features without replacing them", async () => {
      const existing = [feat({ id: "f1", version: 1 })];
      seedRedis(redis, existing);

      const { store } = makeStore(redis, repo);
      await store.init();
      store.processUpdate(feat({ id: "f2", key: "other", version: 1 }), "streaming");
      await flushAsync();

      const stored = JSON.parse(redis.store.get(`featurehub_${ENV_ID}`)!) as FeatureState[];
      expect(stored).toHaveLength(2);
      store.close();
    });
  });

  // ── deleteFeature ───────────────────────────────────────────────────────────

  describe("deleteFeature", () => {
    it("ignores deletes from redis-store source", async () => {
      const existing = [feat({ id: "f1" })];
      seedRedis(redis, existing);

      const { store } = makeStore(redis, repo);
      await store.init();

      const setSpy = vi.spyOn(redis, "set");
      store.deleteFeature(feat({ id: "f1" }), "redis-store");
      await flushAsync();
      expect(setSpy).not.toHaveBeenCalled();
      store.close();
    });

    it("removes a feature from Redis", async () => {
      const existing = [feat({ id: "f1" }), feat({ id: "f2", key: "b" })];
      seedRedis(redis, existing);

      const { store } = makeStore(redis, repo);
      await store.init();
      store.deleteFeature(feat({ id: "f1" }), "streaming");
      await flushAsync();

      const stored = JSON.parse(redis.store.get(`featurehub_${ENV_ID}`)!) as FeatureState[];
      expect(stored).toHaveLength(1);
      expect(stored[0]?.id).toBe("f2");
      store.close();
    });

    it("is a no-op when feature is not in Redis", async () => {
      const existing = [feat({ id: "f2", key: "b" })];
      seedRedis(redis, existing);

      const { store } = makeStore(redis, repo);
      await store.init();

      const setSpy = vi.spyOn(redis, "set");
      store.deleteFeature(feat({ id: "unknown" }), "streaming");
      await flushAsync();
      expect(setSpy).not.toHaveBeenCalled();
      store.close();
    });

    it("is a no-op when Redis has no features at all", async () => {
      const { store } = makeStore(redis, repo);
      await store.init();

      const setSpy = vi.spyOn(redis, "set");
      store.deleteFeature(feat({ id: "f1" }), "streaming");
      await flushAsync();
      expect(setSpy).not.toHaveBeenCalled();
      store.close();
    });
  });

  // ── WATCH retry ─────────────────────────────────────────────────────────────

  describe("WATCH/MULTI/EXEC retry", () => {
    it("retries after WatchError and succeeds", async () => {
      vi.useFakeTimers();
      redis.watchFailTimes = 2;
      const { store } = makeStore(redis, repo, {}, { backoffTimeout: 1, retryUpdateCount: 5 });
      await store.init();

      store.processUpdates([feat({ id: "f1" })], "polling");
      // Advance enough for each retry sleep and drain microtasks between
      await vi.advanceTimersByTimeAsync(10);

      expect(redis.store.get(`featurehub_${ENV_ID}_sha`)).toBe(computeSha([feat({ id: "f1" })]));
      store.close();
    });

    it("gives up after exhausting retryUpdateCount", async () => {
      vi.useFakeTimers();
      redis.watchFailTimes = 99;
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const { store } = makeStore(redis, repo, {}, { backoffTimeout: 1, retryUpdateCount: 3 });
      await store.init();

      store.processUpdates([feat()], "polling");
      await vi.advanceTimersByTimeAsync(50);

      expect(redis.store.has(`featurehub_${ENV_ID}_sha`)).toBe(false);
      expect(errSpy.mock.calls.some((c) => String(c[1]).includes("exhausted"))).toBe(true);
      errSpy.mockRestore();
      store.close();
    });

    it("skips the features read inside _storeFeatures when currentSha matches _lastSha", async () => {
      // Seed Redis and init so _lastSha is set
      const seedFeatures = [feat({ id: "f1", version: 1 })];
      seedRedis(redis, seedFeatures);

      const { store } = makeStore(redis, repo);
      await store.init(); // _lastSha = sha([f1v1])

      // Redis sha still matches _lastSha (no external writer)
      const getSpy = vi.spyOn(redis, "get");
      store.processUpdates([feat({ id: "f1", version: 2 })], "polling");
      await flushAsync();

      // The features key should be read once by _handleProcessUpdates for the version check,
      // but NOT a second time inside _storeFeatures (because currentSha === _lastSha)
      const featureKeyReads = getSpy.mock.calls.filter((c) => c[0] === `featurehub_${ENV_ID}`);
      expect(featureKeyReads).toHaveLength(1);
      store.close();
    });
  });

  // ── refresh timer ───────────────────────────────────────────────────────────

  describe("refresh timer", () => {
    it("notifies repo when Redis sha changes on tick", async () => {
      vi.useFakeTimers();
      const config = makeConfig(repo);
      const s = new RedisSessionStoreUrl("redis://unused", config, {
        refreshTimeout: 1,
        backoffTimeout: 0,
        delayInit: true,
      });
      (s as unknown as { _client: FakeRedis })._client = redis;
      await s.init();

      const newFeatures = [feat({ id: "f1", version: 9 })];
      seedRedis(redis, newFeatures);

      const notifySpy = vi.spyOn(repo, "notify");
      await vi.advanceTimersByTimeAsync(1100);

      expect(notifySpy).toHaveBeenCalledWith(SSEResultState.Features, newFeatures, "redis-store");
      s.close();
    });

    it("does not notify repo when sha is unchanged on tick", async () => {
      vi.useFakeTimers();
      const features = [feat({ id: "f1" })];
      seedRedis(redis, features);

      const config = makeConfig(repo);
      const s = new RedisSessionStoreUrl("redis://unused", config, {
        refreshTimeout: 1,
        backoffTimeout: 0,
        delayInit: true,
      });
      (s as unknown as { _client: FakeRedis })._client = redis;
      await s.init();

      const notifySpy = vi.spyOn(repo, "notify");
      await vi.advanceTimersByTimeAsync(1100);

      expect(notifySpy).not.toHaveBeenCalled();
      s.close();
    });
  });

  // ── close ────────────────────────────────────────────────────────────────────

  describe("close", () => {
    it("sets connected to false", async () => {
      const { store } = makeStore(redis, repo);
      await store.init();
      store.close();
      expect(store.connected).toBe(false);
    });
  });

  // ── custom prefix ────────────────────────────────────────────────────────────

  describe("custom prefix", () => {
    it("uses the configured prefix for all keys", async () => {
      const { store } = makeStore(redis, repo, {}, { prefix: "myapp" });
      await store.init();
      store.processUpdates([feat()], "polling");
      await flushAsync();

      expect(redis.store.has(`myapp_${ENV_ID}_sha`)).toBe(true);
      expect(redis.store.has(`myapp_${ENV_ID}`)).toBe(true);
      store.close();
    });
  });
});
