import { createHash } from "node:crypto";

import {
  type FeatureHubConfig,
  type FeatureState,
  fhLog,
  type InternalFeatureRepository,
  type RawUpdateFeatureListener,
  SSEResultState,
} from "featurehub-javascript-core-sdk";
import {
  createClient,
  createCluster,
  type RedisClientOptions,
  type RedisClusterOptions,
  WatchError,
} from "redis";

const REDIS_STORE_SOURCE = "redis-store";

export interface RedisSessionStoreOptions {
  /** Key prefix for all FeatureHub state in Redis (default: "featurehub") */
  prefix?: string;
  /** Milliseconds to wait between write retries on WATCH conflict (default: 500) */
  backoffTimeout?: number;
  /** Maximum number of write attempts before giving up (default: 10) */
  retryUpdateCount?: number;
  /** How often (in seconds) to poll Redis for external changes (default: 300) */
  refreshTimeout?: number;
  /** don't do an immediate init (default: false) */
  delayInit?: boolean;
}

const DEFAULTS: Required<RedisSessionStoreOptions> = {
  prefix: "featurehub",
  backoffTimeout: 500,
  retryUpdateCount: 10,
  refreshTimeout: 300,
  delayInit: false,
};

// Minimal structural interface covering what we actually call on both single-node and cluster clients.
interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
  connect(): Promise<unknown>;
  isOpen: boolean;
}

// Extended interface for single-node clients that support WATCH/MULTI/EXEC.
interface RedisTransactionLike {
  set(key: string, value: string): this;
  exec(): Promise<Array<unknown> | null>;
}

interface RedisSingleNodeLike extends RedisLike {
  watch(key: string): Promise<unknown>;
  unwatch(): Promise<unknown>;
  multi(): RedisTransactionLike;
}

abstract class RedisSessionStoreBase implements RawUpdateFeatureListener {
  protected readonly _config: FeatureHubConfig;
  protected _client!: RedisLike;
  protected _isCluster = false;

  private readonly _prefix: string;
  private readonly _backoffTimeout: number;
  private readonly _retryCount: number;
  private readonly _refreshTimeout: number;
  private _timer: ReturnType<typeof setInterval> | undefined;
  private _lastSha: string | undefined;
  private _active = false;

  protected constructor(config: FeatureHubConfig, options?: Partial<RedisSessionStoreOptions>) {
    this._config = config;
    this._prefix = options?.prefix ?? DEFAULTS.prefix;
    this._backoffTimeout = options?.backoffTimeout ?? DEFAULTS.backoffTimeout;
    this._retryCount = options?.retryUpdateCount ?? DEFAULTS.retryUpdateCount;
    this._refreshTimeout = options?.refreshTimeout ?? DEFAULTS.refreshTimeout;
  }

  // ── key derivation ───────────────────────────────────────────────────────

  private _featuresKey(): string {
    return `${this._prefix}_${this._config.environmentId}`;
  }

  private _shaKey(): string {
    return `${this._prefix}_${this._config.environmentId}_sha`;
  }

  // ── SHA256 ───────────────────────────────────────────────────────────────

  private _computeSha(features: FeatureState[]): string {
    const input = features
      .slice()
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((f) => `${f.id}:${f.version ?? 0}`)
      .join("|");
    return createHash("sha256").update(input).digest("hex");
  }

  // ── Redis helpers ────────────────────────────────────────────────────────

  private async _readFeaturesFromRedis(): Promise<FeatureState[] | null> {
    const raw = await this._client.get(this._featuresKey());
    if (!raw) {
      fhLog.trace("[featurehubsdk] no features found in redis source");
      return null;
    }
    try {
      return JSON.parse(raw) as FeatureState[];
    } catch {
      return null;
    }
  }

  // ── version comparison ───────────────────────────────────────────────────

  private _anyIncomingIsNewer(incoming: FeatureState[], existing: FeatureState[]): boolean {
    const existingMap = new Map(existing.map((f) => [f.id, f.version ?? 0]));
    return incoming.some(
      (f) => (f.version ?? 0) > (existingMap.has(f.id) ? existingMap.get(f.id)! : -1),
    );
  }

  /** Returns a new array keeping the higher-versioned copy of each feature by id. */
  private _mergeFeatures(incoming: FeatureState[], existing: FeatureState[]): FeatureState[] {
    const merged = new Map(existing.map((f) => [f.id, f]));
    for (const f of incoming) {
      const storedVersion = merged.get(f.id)?.version ?? -1;
      if ((f.version ?? 0) > storedVersion) {
        merged.set(f.id, f);
      }
    }
    return Array.from(merged.values());
  }

  private _sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ── write helper (optimistic locking for single-node, plain write for cluster) ──

  private async _storeFeatures(features: FeatureState[]): Promise<void> {
    const newSha = this._computeSha(features);
    const encoded = JSON.stringify(features);

    if (this._isCluster) {
      await this._client.set(this._shaKey(), newSha);
      await this._client.set(this._featuresKey(), encoded);
      this._lastSha = newSha;
      return;
    }

    const singleNode = this._client as unknown as RedisSingleNodeLike;
    let featuresToWrite = features;
    let shaToWrite = newSha;
    let encodedToWrite = encoded;

    fhLog.trace(`[featurehubsdk] writing ${features.length} features to redis`);

    for (let attempt = 0; attempt < this._retryCount; attempt++) {
      try {
        await singleNode.watch(this._shaKey());

        const currentSha = await this._client.get(this._shaKey());

        if (currentSha === shaToWrite) {
          await singleNode.unwatch();
          this._lastSha = shaToWrite;
          return;
        }

        if (currentSha !== null && currentSha !== this._lastSha) {
          // Another writer has updated Redis since our last write — check versions
          const redisFeatures = await this._readFeaturesFromRedis();
          if (redisFeatures !== null) {
            if (!this._anyIncomingIsNewer(featuresToWrite, redisFeatures)) {
              await singleNode.unwatch();
              return; // our data is entirely stale, abort
            }
            featuresToWrite = this._mergeFeatures(featuresToWrite, redisFeatures);
            shaToWrite = this._computeSha(featuresToWrite);
            encodedToWrite = JSON.stringify(featuresToWrite);
          }
        }

        const result = await singleNode
          .multi()
          .set(this._shaKey(), shaToWrite)
          .set(this._featuresKey(), encodedToWrite)
          .exec();

        if (result !== null) {
          this._lastSha = shaToWrite;
          return;
        }
        // null result = WATCH invalidated (treat same as WatchError)
      } catch (e) {
        if (!(e instanceof WatchError)) {
          fhLog.error("RedisSessionStore: unexpected write error", e);
          return;
        }
        // WatchError — retry after backoff
      }

      await this._sleep(this._backoffTimeout);
    }

    fhLog.error("RedisSessionStore: exhausted write retries — giving up");
  }

  // ── startup load and periodic refresh ───────────────────────────────────

  private async _loadFromRedis(): Promise<void> {
    const features = await this._readFeaturesFromRedis();
    if (!features) {
      return;
    }

    (this._config.repository() as InternalFeatureRepository).notify(
      SSEResultState.Features,
      features,
      REDIS_STORE_SOURCE,
    );
  }

  private async _refreshFromRedis(): Promise<void> {
    const currentSha = await this._client.get(this._shaKey());
    if (currentSha === null || currentSha === this._lastSha) return;
    this._lastSha = currentSha;
    await this._loadFromRedis();
  }

  // ── async handlers for RawUpdateFeatureListener callbacks ───────────────

  private async _handleProcessUpdates(features: FeatureState[]): Promise<void> {
    const newSha = this._computeSha(features);
    const redisSha = await this._client.get(this._shaKey());

    if (newSha === redisSha) return;

    if (redisSha !== null) {
      const redisFeatures = await this._readFeaturesFromRedis();
      if (redisFeatures !== null && !this._anyIncomingIsNewer(features, redisFeatures)) {
        return;
      }
    }

    await this._storeFeatures(features);
  }

  private async _handleProcessUpdate(feature: FeatureState): Promise<void> {
    const redisFeatures = await this._readFeaturesFromRedis();
    if (redisFeatures !== null) {
      const existing = redisFeatures.find((f) => f.id === feature.id);
      if (existing && (existing.version ?? 0) >= (feature.version ?? 0)) {
        return; // Redis already has same or newer version
      }
    }
    const base = redisFeatures ?? [];
    const updated = base.filter((f) => f.id !== feature.id).concat(feature);
    await this._storeFeatures(updated);
  }

  private async _handleDeleteFeature(feature: FeatureState): Promise<void> {
    const redisFeatures = await this._readFeaturesFromRedis();
    if (!redisFeatures) return;
    if (!redisFeatures.some((f) => f.id === feature.id)) return;
    await this._storeFeatures(redisFeatures.filter((f) => f.id !== feature.id));
  }

  // ── public API ────────────────────────────────────────────────────────────

  /**
   * Connect to Redis, rehydrate the repository from any stored state, and start the
   * refresh timer. Must be awaited before the store is operational.
   */
  async init(): Promise<void> {
    const keys = this._config.getApiKeys();
    if (keys.length > 0 && !this._config.clientEvaluated()) {
      fhLog.error(
        "RedisSessionStore: refusing to initialise — config uses server-evaluated API keys. " +
          "Sharing feature state in Redis across server-evaluated contexts can produce " +
          "incorrect values for different evaluation contexts.",
      );
      return;
    }

    if (!this._client.isOpen) {
      fhLog.trace("connecting to redis");
      await this._client.connect();
      fhLog.trace("connected to redis");
    }

    this._config.repository().registerRawUpdateFeatureListener(this);

    this._lastSha = (await this._client.get(this._shaKey())) ?? undefined;
    if (this._lastSha !== undefined) {
      await this._loadFromRedis();
    }

    this._timer = setInterval(() => {
      this._refreshFromRedis().catch((e) =>
        fhLog.error("RedisSessionStore: refresh timer error", e),
      );
    }, this._refreshTimeout * 1000);

    this._active = true;
  }

  get connected(): boolean {
    return this._active && this._client.isOpen;
  }

  close(): void {
    this._active = false;
    if (this._timer !== undefined) {
      clearInterval(this._timer);
      this._timer = undefined;
    }
  }

  configChanged(): void {
    // no-op — environmentId is derived from the config key which doesn't change
  }

  // ── RawUpdateFeatureListener ─────────────────────────────────────────────

  processUpdates(features: FeatureState[], source: string): void {
    if (source === REDIS_STORE_SOURCE) return;
    this._handleProcessUpdates(features).catch((e) =>
      fhLog.error("RedisSessionStore: processUpdates error", e),
    );
  }

  processUpdate(feature: FeatureState, source: string): void {
    if (source === REDIS_STORE_SOURCE) return;
    this._handleProcessUpdate(feature).catch((e) =>
      fhLog.error("RedisSessionStore: processUpdate error", e),
    );
  }

  deleteFeature(feature: FeatureState, source: string): void {
    if (source === REDIS_STORE_SOURCE) return;
    this._handleDeleteFeature(feature).catch((e) =>
      fhLog.error("RedisSessionStore: deleteFeature error", e),
    );
  }
}

// ── Concrete subclasses ───────────────────────────────────────────────────────

/** Connect using a Redis URL string, e.g. `"redis://localhost:6379"`. */
export class RedisSessionStoreUrl extends RedisSessionStoreBase {
  constructor(url: string, config: FeatureHubConfig, options?: Partial<RedisSessionStoreOptions>) {
    super(config, options);
    this._client = createClient({ url }) as unknown as RedisLike;
    this._isCluster = false;
    if (!options?.delayInit) {
      this.init();
    }
  }
}

/** Connect using a `RedisClientOptions` object (TLS, password, socket, etc.). */
export class RedisSessionStoreClient extends RedisSessionStoreBase {
  constructor(
    clientOptions: RedisClientOptions,
    config: FeatureHubConfig,
    options?: Partial<RedisSessionStoreOptions>,
  ) {
    super(config, options);
    this._client = createClient(clientOptions) as unknown as RedisLike;
    this._isCluster = false;
    if (!options?.delayInit) {
      this.init();
    }
  }
}

/** Connect to a Redis Cluster. WATCH/MULTI are skipped; writes are non-atomic sequential SETs. */
export class RedisSessionStoreCluster extends RedisSessionStoreBase {
  constructor(
    clusterOptions: RedisClusterOptions,
    config: FeatureHubConfig,
    options?: Partial<RedisSessionStoreOptions>,
  ) {
    super(config, options);
    this._client = createCluster(clusterOptions) as unknown as RedisLike;
    this._isCluster = true;
    if (!options?.delayInit) {
      this.init();
    }
  }
}
