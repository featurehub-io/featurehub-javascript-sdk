import type {
  EvaluationContext,
  JsonValue,
  Logger,
  Provider,
  ProviderMetadata,
  ResolutionDetails,
} from "@openfeature/server-sdk";
import {
  ErrorCode,
  OpenFeatureEventEmitter,
  ProviderEvents,
  StandardResolutionReasons,
} from "@openfeature/server-sdk";
import type { FeatureHubConfig, FeatureStateHolder } from "featurehub-javascript-node-sdk";
import { EdgeFeatureHubConfig, Readyness } from "featurehub-javascript-node-sdk";

import { contextSignature, InvalidContextError, toContextRecord } from "./context-mapper.js";

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
   * - **server-evaluated keys** (`default/...`): the provider maintains a
   *   single shared evaluation context; when the OpenFeature context changes,
   *   the bundle is re-fetched from Edge evaluated for that context (the SDK
   *   pools concurrent requests and honours ETag/304). Recommended when the
   *   criteria must not leave the server.
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

type EvaluatedFeatureLike = { strategyId?: string | undefined };

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
  private ready = false;
  private lastContextSignature: string | undefined;

  constructor(options: FeatureHubProviderOptions) {
    if (!options?.host || !options?.apiKey) {
      throw new Error("FeatureHubProvider requires `host` and `apiKey`.");
    }
    this.options = options;
    this.clientEval = options.apiKey.includes("*");
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
    if (Object.keys(record).length > 0) {
      const ctx = cfg.context(record);
      if (!this.clientEval) {
        // server-evaluated keys: the context change triggers a bundle fetch
        await ctx.build();
      }
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
    this.config?.close();
    this.config = undefined;
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
    kind: "boolean" | "string" | "number" | "object",
    defaultValue: unknown,
    logger: Logger,
  ): Promise<ResolutionDetails<unknown>> {
    if (!this.ready || !this.config) {
      return {
        value: defaultValue,
        reason: StandardResolutionReasons.ERROR,
        errorCode: ErrorCode.PROVIDER_NOT_READY,
        errorMessage: "FeatureHub provider has not completed initialization.",
      };
    }

    let holder: FeatureStateHolder | undefined;
    try {
      holder = await this.holderFor(flagKey, context);
    } catch (err) {
      if (err instanceof InvalidContextError) {
        return {
          value: defaultValue,
          reason: StandardResolutionReasons.ERROR,
          errorCode: ErrorCode.INVALID_CONTEXT,
          errorMessage: err.message,
        };
      }
      logger.error(`FeatureHub evaluation of '${flagKey}' failed`, err);
      return {
        value: defaultValue,
        reason: StandardResolutionReasons.ERROR,
        errorCode: ErrorCode.GENERAL,
        errorMessage: err instanceof Error ? err.message : String(err),
      };
    }

    if (holder === undefined || !holder.exists) {
      return {
        value: defaultValue,
        reason: StandardResolutionReasons.ERROR,
        errorCode: ErrorCode.FLAG_NOT_FOUND,
        errorMessage: `Flag '${flagKey}' was not found in this FeatureHub environment.`,
      };
    }

    const metadata: Record<string, string | number | boolean> = {};
    const version = holder.getVersion();
    if (typeof version === "number" && version >= 0) {
      metadata["featureVersion"] = version;
    }
    const featureType = holder.getType();
    if (featureType) {
      metadata["featureType"] = featureType.toString();
    }

    // mismatched feature type (e.g. boolean resolution against a string flag)
    const expected =
      kind === "boolean"
        ? "BOOLEAN"
        : kind === "string"
          ? "STRING"
          : kind === "number"
            ? "NUMBER"
            : "JSON";
    if (featureType && featureType.toString() !== expected) {
      return {
        value: defaultValue,
        reason: StandardResolutionReasons.ERROR,
        errorCode: ErrorCode.TYPE_MISMATCH,
        errorMessage: `Flag '${flagKey}' is of type ${featureType.toString()} and cannot be resolved as ${kind}.`,
        flagMetadata: metadata,
      };
    }

    const rawValue =
      kind === "boolean"
        ? holder.getBoolean()
        : kind === "string"
          ? holder.getString()
          : kind === "number"
            ? holder.getNumber()
            : holder.getRawJson();

    // value-less features (strings/numbers/json can be value-less) resolve to
    // the code default
    if (rawValue === undefined || rawValue === null) {
      return {
        value: defaultValue,
        reason: StandardResolutionReasons.DEFAULT,
        flagMetadata: metadata,
      };
    }

    let value: unknown = rawValue;
    if (kind === "object" && typeof rawValue === "string") {
      try {
        value = JSON.parse(rawValue) as JsonValue;
      } catch {
        return {
          value: defaultValue,
          reason: StandardResolutionReasons.ERROR,
          errorCode: ErrorCode.PARSE_ERROR,
          errorMessage: `Flag '${flagKey}' contains invalid JSON.`,
          flagMetadata: metadata,
        };
      }
    }

    const strategyId = this.strategyIdFor(holder);
    return {
      value,
      reason: strategyId
        ? StandardResolutionReasons.TARGETING_MATCH
        : StandardResolutionReasons.STATIC,
      variant: strategyId,
      flagMetadata: metadata,
    };
  }

  /**
   * Locates the feature holder for a flag.
   *
   * - client-evaluated keys: the context is applied locally and the flag is
   *   evaluated in-memory per call.
   * - server-evaluated keys: the provider keeps a single shared context; only
   *   when the OpenFeature context actually changes does it ask the SDK to
   *   re-fetch the bundle evaluated for the new context (the SDK pools
   *   concurrent refreshes and honours ETag/304).
   */
  private async holderFor(
    flagKey: string,
    context: EvaluationContext,
  ): Promise<FeatureStateHolder | undefined> {
    const cfg = this.config!;
    const record = toContextRecord(context, { sessionAsSessionKey: !this.clientEval });

    if (this.clientEval) {
      return cfg.context(record).feature(flagKey);
    }

    const signature = contextSignature(context);

    if (signature !== this.lastContextSignature) {
      const ctx = cfg.context(record);
      await ctx.build();
      const readiness = await cfg.waitForReady(this.waitForReadyMs);
      if (readiness === Readyness.Failed) {
        throw new Error("FeatureHub repository failed to refresh for the new context.");
      }
      this.lastContextSignature = signature;
    }
    return cfg.feature(flagKey);
  }

  /**
   * Best-effort retrieval of the matched rollout strategy id.
   *
   * For client-evaluated keys the repository evaluates strategies and exposes
   * the match; for server-evaluated keys the evaluated bundle carries the
   * matched strategy id on the feature state itself.
   */
  private strategyIdFor(holder: FeatureStateHolder): string | undefined {
    try {
      const evaluated = (
        holder as unknown as { internalGetValue?: (triggerUsage: boolean) => EvaluatedFeatureLike }
      ).internalGetValue?.(false);
      if (evaluated?.strategyId) {
        return evaluated.strategyId;
      }
      // server-evaluated bundles carry the matched strategy id on the state
      const fs = (
        holder as unknown as { featureState?: () => { v?: string } | undefined }
      ).featureState?.();
      return fs?.v ?? undefined;
    } catch {
      return undefined;
    }
  }
}
