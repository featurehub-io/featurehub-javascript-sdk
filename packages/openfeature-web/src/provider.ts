import type {
  EvaluationContext,
  JsonValue,
  Logger,
  Provider,
  ProviderMetadata,
  ResolutionDetails,
} from "@openfeature/web-sdk";
import {
  ErrorCode,
  OpenFeatureEventEmitter,
  ProviderEvents,
  StandardResolutionReasons,
} from "@openfeature/web-sdk";
import type { FeatureHubConfig, FeatureStateHolder } from "featurehub-javascript-client-sdk";
import { EdgeFeatureHubConfig, Readyness } from "featurehub-javascript-client-sdk";

import { InvalidContextError, toContextRecord } from "./context-mapper.js";

type Reason = NonNullable<ResolutionDetails<unknown>["reason"]>;

export interface FeatureHubWebProviderOptions {
  /** Base URL of FeatureHub Edge, e.g. `https://edge.featurehub.io`. */
  host: string;
  /**
   * A **client-evaluated** FeatureHub API key (contains `*`): the full feature
   * bundle — including rollout strategies — is streamed to the browser and
   * every OpenFeature resolution is evaluated locally. Server-evaluated keys
   * are not supported by this provider because the OpenFeature web paradigm
   * resolves synchronously.
   */
  apiKey: string;
  /** Poll Edge every N milliseconds instead of streaming (SSE). */
  pollIntervalMs?: number;
  /** How long `initialize` waits for the first feature payload. Default 10s. */
  waitForReadyMs?: number;
  /** Supply a pre-built config (used by tests). */
  configFactory?: (options: FeatureHubWebProviderOptions) => FeatureHubConfig;
}

/**
 * Official OpenFeature provider for FeatureHub (Web/browser).
 *
 * The provider holds no evaluation logic of its own: it drives a
 * [FeatureHubConfig]{@link FeatureHubConfig}, which keeps the entire feature
 * bundle in a local repository (streamed over SSE or polled), and every
 * OpenFeature resolution is evaluated locally against the supplied context —
 * never with a per-flag network call.
 */
export class FeatureHubWebProvider implements Provider {
  public readonly metadata: ProviderMetadata = { name: "featurehub" };
  public readonly runsOn = "client" as const;

  public readonly events = new OpenFeatureEventEmitter();

  private readonly options: FeatureHubWebProviderOptions;
  private readonly waitForReadyMs: number;

  private config?: FeatureHubConfig;
  private ready = false;

  constructor(options: FeatureHubWebProviderOptions) {
    if (!options?.host || !options?.apiKey) {
      throw new Error("FeatureHubWebProvider requires `host` and `apiKey`.");
    }
    if (!options.apiKey.includes("*")) {
      // fail fast: this provider evaluates synchronously from a locally held
      // repository, which only client-evaluated keys can populate correctly.
      throw new Error(
        "FeatureHubWebProvider requires a client-evaluated API key (containing '*'). " +
          "Server-evaluated keys cannot be resolved synchronously in a browser.",
      );
    }
    this.options = options;
    this.waitForReadyMs = options.waitForReadyMs ?? 10_000;
  }

  async initialize(context?: EvaluationContext): Promise<void> {
    const cfg = this.options.configFactory
      ? this.options.configFactory(this.options)
      : new EdgeFeatureHubConfig(this.options.host, this.options.apiKey);
    this.config = cfg;

    if (this.options.pollIntervalMs !== undefined) {
      cfg.restActive(this.options.pollIntervalMs);
    } else {
      cfg.streaming();
    }

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

    cfg.init();

    const record = toContextRecord(context);
    if (Object.keys(record).length > 0) {
      cfg.context(record);
    }

    const readiness = await cfg.waitForReady(this.waitForReadyMs);
    if (readiness !== Readyness.Ready) {
      throw new Error(
        `FeatureHub did not become ready within ${this.waitForReadyMs}ms (readiness: ${readiness}).`,
      );
    }
    this.ready = true;
  }

  async onClose(): Promise<void> {
    this.ready = false;
    this.config?.close();
    this.config = undefined;
  }

  resolveBooleanEvaluation(
    flagKey: string,
    defaultValue: boolean,
    context: EvaluationContext,
    _logger: Logger,
  ): ResolutionDetails<boolean> {
    return this.resolve(
      flagKey,
      context,
      "boolean",
      defaultValue,
      _logger,
    ) as ResolutionDetails<boolean>;
  }

  resolveStringEvaluation(
    flagKey: string,
    defaultValue: string,
    context: EvaluationContext,
    _logger: Logger,
  ): ResolutionDetails<string> {
    return this.resolve(
      flagKey,
      context,
      "string",
      defaultValue,
      _logger,
    ) as ResolutionDetails<string>;
  }

  resolveNumberEvaluation(
    flagKey: string,
    defaultValue: number,
    context: EvaluationContext,
    _logger: Logger,
  ): ResolutionDetails<number> {
    return this.resolve(
      flagKey,
      context,
      "number",
      defaultValue,
      _logger,
    ) as ResolutionDetails<number>;
  }

  resolveObjectEvaluation<T extends JsonValue>(
    flagKey: string,
    defaultValue: T,
    context: EvaluationContext,
    _logger: Logger,
  ): ResolutionDetails<T> {
    return this.resolve(flagKey, context, "object", defaultValue, _logger) as ResolutionDetails<T>;
  }

  private resolve(
    flagKey: string,
    context: EvaluationContext,
    kind: "boolean" | "string" | "number" | "object",
    defaultValue: unknown,
    _logger: Logger,
  ): ResolutionDetails<unknown> {
    if (!this.ready || !this.config) {
      return {
        value: defaultValue,
        reason: StandardResolutionReasons.ERROR,
        errorCode: ErrorCode.PROVIDER_NOT_READY,
        errorMessage: "FeatureHub provider has not completed initialization.",
      };
    }

    let holder: FeatureStateHolder;
    try {
      const ctx = this.config.context(toContextRecord(context));
      holder = ctx.feature(flagKey);
    } catch (err) {
      return {
        value: defaultValue,
        reason: StandardResolutionReasons.ERROR,
        errorCode:
          err instanceof InvalidContextError ? ErrorCode.INVALID_CONTEXT : ErrorCode.GENERAL,
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

    // one evaluation gives both the value and the id of the rollout strategy
    // that matched it (see FeatureStateHolder.getValue)
    const evaluated = holder.getValue();
    const rawValue = evaluated?.value;
    const strategyId = evaluated?.strategyId;

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

    return {
      value,
      reason: (strategyId
        ? StandardResolutionReasons.TARGETING_MATCH
        : StandardResolutionReasons.STATIC) as Reason,
      variant: strategyId,
      flagMetadata: metadata,
    };
  }
}
