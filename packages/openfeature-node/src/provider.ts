import type {
  EvaluationContext,
  JsonValue,
  Logger,
  Provider,
  ProviderMetadata,
  ResolutionDetails,
} from "@openfeature/server-sdk";
import { OpenFeatureEventEmitter, ProviderEvents } from "@openfeature/server-sdk";
import type { ClientContext, FeatureHubConfig } from "featurehub-javascript-node-sdk";
import { EdgeFeatureHubConfig, Readyness } from "featurehub-javascript-node-sdk";
import {
  contextSignature,
  type FeatureKind,
  type FeatureSnapshot,
  generalErrorResolution,
  InvalidContextError,
  invalidContextResolution,
  isClientEvaluatedKey,
  notReadyResolution,
  resolveFromEvaluation,
  snapshotFeature,
  toContextRecord,
} from "featurehub-openfeature-common";

export interface FeatureHubProviderOptions {
  /** Base URL of FeatureHub Edge, e.g. `https://edge.featurehub.io` or `http://localhost:8553`. */
  host: string;
  /**
   * A FeatureHub SDK API key for the environment.
   *
   * - **client-evaluated keys** (containing `*`): the feature bundle (including
   *   rollout strategies) is streamed/polled to the provider and every
   *   evaluation is performed locally against the supplied context. This is
   *   the recommended mode for Node servers handling many different users.
   * - **server-evaluated keys** (`default/...`): the provider holds a single
   *   shared evaluation context for its lifetime; when the OpenFeature context
   *   changes, the bundle is re-fetched from Edge evaluated for that context
   *   (the SDK pools concurrent refreshes and honours ETag/304). Because the
   *   context is shared, resolutions are serialised; use a client-evaluated
   *   key for concurrent multi-user workloads.
   */
  apiKey: string;
  /** Poll Edge every N milliseconds (REST active). Overrides streaming. */
  pollIntervalMs?: number;
  /**
   * Passive refresh: only contact Edge when an evaluation happens after the
   * cache age exceeds this many milliseconds (REST passive). Overrides
   * `pollIntervalMs` and streaming.
   */
  cacheTimeToLiveMs?: number;
  /** How long `initialize` (and context changes) wait for readiness. Default 10s. */
  waitForReadyMs?: number;
  /** Supply a pre-built config (used by tests). */
  configFactory?: (options: FeatureHubProviderOptions) => FeatureHubConfig;
}

/**
 * Official OpenFeature provider for FeatureHub (Node.js).
 *
 * The provider holds no evaluation logic of its own: it drives a
 * [FeatureHubConfig]{@link FeatureHubConfig}, which keeps a local repository
 * of the entire feature bundle up to date (streaming, polling or passive
 * refresh), and every OpenFeature resolution is served from that local
 * repository — never with a per-flag network call.
 */
export class FeatureHubProvider implements Provider {
  public readonly metadata: ProviderMetadata = { name: "featurehub" };
  public readonly runsOn = "server" as const;

  public readonly events = new OpenFeatureEventEmitter();

  private readonly options: FeatureHubProviderOptions;
  private readonly clientEval: boolean;
  private readonly waitForReadyMs: number;

  private config?: FeatureHubConfig;
  /**
   * Server-evaluated keys only: the single shared evaluation context, held for
   * the provider's lifetime. Holding exactly one keeps the SDK's internal
   * reference count at 1, so `config.close()` tears everything down correctly.
   */
  private sharedContext?: ClientContext;
  /** Serialises server-eval context rebuilds + reads (holders are live objects on a shared repository). */
  private lock: Promise<unknown> = Promise.resolve();
  private ready = false;
  private lastContextSignature: string | undefined;

  constructor(options: FeatureHubProviderOptions) {
    if (!options?.host || !options?.apiKey) {
      throw new Error("FeatureHubProvider requires `host` and `apiKey`.");
    }
    this.options = options;
    this.clientEval = isClientEvaluatedKey(options.apiKey);
    this.waitForReadyMs = options.waitForReadyMs ?? 10_000;
  }

  async initialize(context?: EvaluationContext): Promise<void> {
    const cfg = this.options.configFactory
      ? this.options.configFactory(this.options)
      : new EdgeFeatureHubConfig(this.options.host, this.options.apiKey);
    this.config = cfg;

    cfg.addReadinessListener((readiness) => {
      if (readiness === Readyness.Ready) {
        this.ready = true;
        this.events.emit(ProviderEvents.Ready, { message: "FeatureHub repository is ready" });
      } else if (readiness === Readyness.Failed) {
        this.ready = false;
        this.events.emit(ProviderEvents.Error, { message: "FeatureHub repository failed" });
      }
    });

    cfg.registerRawUpdateFeatureListener({
      get connected(): boolean {
        return cfg.initialized;
      },
      processUpdate: (feature) => {
        if (feature?.key) {
          this.events.emit(ProviderEvents.ConfigurationChanged, { flagsChanged: [feature.key] });
        }
      },
      processUpdates: (features) => {
        const keys = features.map((f) => f.key).filter((k): k is string => !!k);
        if (keys.length > 0) {
          this.events.emit(ProviderEvents.ConfigurationChanged, { flagsChanged: keys });
        }
      },
      deleteFeature: (feature) => {
        if (feature?.key) {
          this.events.emit(ProviderEvents.ConfigurationChanged, { flagsChanged: [feature.key] });
        }
      },
      close: () => {
        /* lifecycle handled via config.close() in onClose */
      },
      configChanged: () => {
        /* configuration-level change; individual features emit above */
      },
    });

    if (this.options.cacheTimeToLiveMs !== undefined) {
      cfg.restPassive(this.options.cacheTimeToLiveMs);
    } else if (this.options.pollIntervalMs !== undefined) {
      cfg.restActive(this.options.pollIntervalMs);
    } else {
      cfg.streaming();
    }

    cfg.init();

    const record = toContextRecord(context, { sessionAsSessionKey: !this.clientEval });
    if (this.clientEval) {
      // client-evaluated keys evaluate locally; nothing to pre-fetch
      if (Object.keys(record).length > 0) {
        cfg.context(record);
      }
    } else {
      // server-evaluated keys: create the ONE shared context for the provider's
      // lifetime and fetch the initial bundle (even for an empty context, so
      // readiness reflects a real fetch)
      this.sharedContext = cfg.context(record);
      await this.sharedContext.build();
    }

    const readiness = await cfg.waitForReady(this.waitForReadyMs);
    if (readiness !== Readyness.Ready) {
      throw new Error(
        `FeatureHub did not become ready within ${this.waitForReadyMs}ms (readiness: ${readiness}).`,
      );
    }
    this.ready = true;
    this.lastContextSignature = contextSignature(context);
  }

  async onClose(): Promise<void> {
    this.ready = false;
    const cfg = this.config;
    this.config = undefined;
    if (!cfg) {
      return;
    }
    try {
      // forceClose tears down the SSE/polling edge, repository and usage
      // adapter regardless of the shared context's reference count. A plain
      // close() only decrements once and (with server-evaluated keys, whose
      // shared context is reference-counted) may never reach zero.
      cfg.forceClose();
    } catch {
      // already closed
    }
    this.sharedContext = undefined;
  }

  async resolveBooleanEvaluation(
    flagKey: string,
    defaultValue: boolean,
    context: EvaluationContext,
    logger: Logger,
  ): Promise<ResolutionDetails<boolean>> {
    return this.resolve(flagKey, context, "boolean", defaultValue, logger) as Promise<
      ResolutionDetails<boolean>
    >;
  }

  async resolveStringEvaluation(
    flagKey: string,
    defaultValue: string,
    context: EvaluationContext,
    logger: Logger,
  ): Promise<ResolutionDetails<string>> {
    return this.resolve(flagKey, context, "string", defaultValue, logger) as Promise<
      ResolutionDetails<string>
    >;
  }

  async resolveNumberEvaluation(
    flagKey: string,
    defaultValue: number,
    context: EvaluationContext,
    logger: Logger,
  ): Promise<ResolutionDetails<number>> {
    return this.resolve(flagKey, context, "number", defaultValue, logger) as Promise<
      ResolutionDetails<number>
    >;
  }

  async resolveObjectEvaluation<T extends JsonValue>(
    flagKey: string,
    defaultValue: T,
    context: EvaluationContext,
    logger: Logger,
  ): Promise<ResolutionDetails<T>> {
    return this.resolve(flagKey, context, "object", defaultValue, logger) as Promise<
      ResolutionDetails<T>
    >;
  }

  private async resolve(
    flagKey: string,
    context: EvaluationContext,
    kind: FeatureKind,
    defaultValue: unknown,
    logger: Logger,
  ): Promise<ResolutionDetails<unknown>> {
    if (!this.ready || !this.config) {
      return notReadyResolution(defaultValue);
    }

    let evaluation: FeatureSnapshot;
    try {
      evaluation = await this.evaluate(flagKey, context);
    } catch (err) {
      if (err instanceof InvalidContextError) {
        return invalidContextResolution(defaultValue, err);
      }
      logger.error(`FeatureHub evaluation of '${flagKey}' failed`, err);
      return generalErrorResolution(defaultValue, err);
    }

    return resolveFromEvaluation(flagKey, kind, defaultValue, evaluation);
  }

  /**
   * Produces a consistent snapshot of a flag evaluation.
   *
   * - client-evaluated keys: a fresh local context is created per resolution
   *   (no shared state) and the flag is evaluated in-memory.
   * - server-evaluated keys: the single shared context is fully reset and
   *   re-applied when the OpenFeature context changes, the refreshed bundle is
   *   awaited, and the values are extracted — all inside a mutex, because the
   *   context and its repository are shared, mutable, and process-wide.
   */
  private async evaluate(flagKey: string, context: EvaluationContext): Promise<FeatureSnapshot> {
    if (this.clientEval) {
      const ctx = this.config!.context(toContextRecord(context));
      return snapshotFeature(ctx.feature(flagKey));
    }

    const run = async (): Promise<FeatureSnapshot> => {
      const cfg = this.config!;
      const signature = contextSignature(context);

      if (signature !== this.lastContextSignature) {
        const ctx = this.sharedContext ?? cfg.context({});
        this.sharedContext = ctx;
        // the SDK's attributes setter MERGES into the existing attribute map
        // and clear() does not reset the user key — reset both, then apply
        ctx.userKey(undefined);
        ctx.clear();
        ctx.attributes = toContextRecord(context, { sessionAsSessionKey: true });
        await ctx.build();
        const readiness = await cfg.waitForReady(this.waitForReadyMs);
        if (readiness === Readyness.Failed) {
          throw new Error("FeatureHub repository failed to refresh for the new context.");
        }
        this.lastContextSignature = signature;
      }

      // read through the shared context itself (config.feature would create
      // another reference-counted context per resolution)
      return snapshotFeature(this.sharedContext!.feature(flagKey));
    };

    const run1 = this.lock.then(run, run);
    this.lock = run1.then(
      () => undefined,
      () => undefined,
    );
    return run1;
  }
}
