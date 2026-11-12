import type {
  EvaluationContext,
  JsonValue,
  Logger,
  Provider,
  ProviderMetadata,
  ResolutionDetails,
} from "@openfeature/web-sdk";
import { OpenFeatureEventEmitter } from "@openfeature/web-sdk";
import type { ClientContext, FeatureHubConfig } from "featurehub-javascript-client-sdk";
import { EdgeFeatureHubConfig } from "featurehub-javascript-client-sdk";
import {
  type BaseProviderOptions,
  contextSignature,
  FeatureHubProviderCore,
  type ProviderEventSink,
  snapshotFeature,
  toContextRecord,
  type Transport,
} from "featurehub-openfeature-common";

export interface FeatureHubWebProviderOptions
  extends BaseProviderOptions<FeatureHubWebProviderOptions> {
  /** Base URL of FeatureHub Edge, e.g. `https://edge.featurehub.io`. */
  host: string;
  /**
   * A **client-evaluated** FeatureHub API key (contains `*`): the full feature
   * bundle — including rollout strategies — is delivered to the browser and
   * every OpenFeature resolution is evaluated locally. Server-evaluated keys
   * are not supported by this provider because the OpenFeature web paradigm
   * resolves synchronously.
   */
  apiKey: string;
  /** How long `initialize` waits for the first feature payload. Default 10s. */
  waitForReadyMs?: number;
  /** Supply a pre-built config, or build the platform one yourself (used by tests). */
  configFactory?: (options: FeatureHubWebProviderOptions) => FeatureHubConfig;
}

/**
 * Official OpenFeature provider for FeatureHub (Web/browser).
 *
 * The provider holds no evaluation logic of its own: it drives a
 * [FeatureHubConfig]{@link FeatureHubConfig}, which keeps the entire feature
 * bundle in a local repository, and every OpenFeature resolution is evaluated
 * locally against the current context — never with a per-flag network call.
 *
 * Because this runs in a browser, the default transport is REST passive: Edge
 * is only contacted when a resolution happens after the cached bundle has
 * expired, which avoids a long-lived SSE connection (or constant polling) per
 * tab. Set `transport: "streaming"` or `pollIntervalMs` to opt in to those.
 */
export class FeatureHubWebProvider
  extends FeatureHubProviderCore<FeatureHubWebProviderOptions>
  implements Provider
{
  public readonly metadata: ProviderMetadata = { name: "featurehub" };
  public readonly runsOn = "client" as const;

  public readonly events = new OpenFeatureEventEmitter();

  /**
   * The single FeatureHub context the web paradigm evaluates against; created
   * in `initialize`, rebuilt on `onContextChange`, and reused across
   * resolutions.
   */
  private context?: ClientContext;
  private currentSignature?: string;

  constructor(options: FeatureHubWebProviderOptions) {
    super("FeatureHubWebProvider", options);
    if (!this.clientEval) {
      // fail fast: this provider evaluates synchronously from a locally held
      // repository, which only client-evaluated keys can populate correctly.
      throw new Error(
        "FeatureHubWebProvider requires a client-evaluated API key (containing '*'). " +
          "Server-evaluated keys cannot be resolved synchronously in a browser.",
      );
    }
  }

  protected get eventSink(): ProviderEventSink {
    // the SDK emitter is typed with its own event enum; the string values are
    // identical across the server and web SDKs
    return this.events as unknown as ProviderEventSink;
  }

  protected get defaultTransport(): Transport {
    return "passive";
  }

  protected createConfig(): FeatureHubConfig {
    return new EdgeFeatureHubConfig(this.options.host, this.options.apiKey);
  }

  async initialize(context?: EvaluationContext): Promise<void> {
    const cfg = this.startConfig();
    this.applyContext(context);
    await this.awaitReady(cfg);
  }

  /** Keeps the single evaluation context in step with the OpenFeature client context. */
  onContextChange(_oldContext: EvaluationContext, newContext: EvaluationContext): void {
    if (this.config) {
      this.applyContext(newContext);
    }
  }

  resolveBooleanEvaluation(
    flagKey: string,
    defaultValue: boolean,
    context: EvaluationContext,
    logger: Logger,
  ): ResolutionDetails<boolean> {
    return this.resolve(
      flagKey,
      context,
      "boolean",
      defaultValue,
      logger,
    ) as ResolutionDetails<boolean>;
  }

  resolveStringEvaluation(
    flagKey: string,
    defaultValue: string,
    context: EvaluationContext,
    logger: Logger,
  ): ResolutionDetails<string> {
    return this.resolve(
      flagKey,
      context,
      "string",
      defaultValue,
      logger,
    ) as ResolutionDetails<string>;
  }

  resolveNumberEvaluation(
    flagKey: string,
    defaultValue: number,
    context: EvaluationContext,
    logger: Logger,
  ): ResolutionDetails<number> {
    return this.resolve(
      flagKey,
      context,
      "number",
      defaultValue,
      logger,
    ) as ResolutionDetails<number>;
  }

  resolveObjectEvaluation<T extends JsonValue>(
    flagKey: string,
    defaultValue: T,
    context: EvaluationContext,
    logger: Logger,
  ): ResolutionDetails<T> {
    return this.resolve(flagKey, context, "object", defaultValue, logger) as ResolutionDetails<T>;
  }

  private resolve(
    flagKey: string,
    context: EvaluationContext,
    kind: "boolean" | "string" | "number" | "object",
    defaultValue: unknown,
    logger: Logger,
  ): ResolutionDetails<unknown> {
    return this.resolveSync(flagKey, kind, defaultValue, logger, () =>
      snapshotFeature(this.contextFor(context).feature(flagKey)),
    );
  }

  /**
   * Returns the single stored context. It is rebuilt when the supplied context
   * differs from the stored one — normally `onContextChange` has already done
   * this, but a context set before the provider was registered still self-heals
   * here without rebuilding on every resolution.
   */
  private contextFor(context: EvaluationContext): ClientContext {
    const signature = contextSignature(context);
    if (!this.context || signature !== this.currentSignature) {
      this.applyContext(context);
    }
    return this.context!;
  }

  private applyContext(context: EvaluationContext | undefined): void {
    this.context = this.config!.context(toContextRecord(context));
    this.currentSignature = contextSignature(context);
  }
}
