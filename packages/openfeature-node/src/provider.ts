import type {
  EvaluationContext,
  JsonValue,
  Logger,
  Provider,
  ProviderMetadata,
  ResolutionDetails,
} from "@openfeature/server-sdk";
import { OpenFeatureEventEmitter } from "@openfeature/server-sdk";
import type { ClientContext, FeatureHubConfig } from "featurehub-javascript-node-sdk";
import { EdgeFeatureHubConfig, Readyness } from "featurehub-javascript-node-sdk";
import {
  type BaseProviderOptions,
  captureFeature,
  ContextConflictError,
  contextSignature,
  type FeatureEvaluation,
  FeatureHubProviderCore,
  type FeatureKind,
  type ProviderEventSink,
  toContextRecord,
  type Transport,
} from "featurehub-openfeature-common";

export interface FeatureHubProviderOptions extends BaseProviderOptions<FeatureHubProviderOptions> {
  /**
   * Base URL of FeatureHub Edge, e.g. `https://edge.featurehub.io` or `http://localhost:8553`. Defaults to
   * `FEATUREHUB_EDGE_URL`.
   */
  host?: string;
  /**
   * A FeatureHub SDK API key for the environment.
   *
   * - **client-evaluated keys** (containing `*`): the feature bundle (including
   *   rollout strategies) is streamed/polled to the provider and every
   *   evaluation is performed locally against the supplied context. This is
   *   the recommended mode for Node servers handling many different users.
   * - **server-evaluated keys** (`default/...`): Edge evaluates the features
   *   for one context, which the provider holds for every OpenFeature client
   *   in the process. When the context changes, the features are fetched again
   *   for the new one. A resolution for a different context while another
   *   context's is in progress fails with INVALID_CONTEXT, rather than give
   *   either the other's values: use the same context everywhere, or a
   *   client-evaluated key for many users at once.
   *
   * Defaults to `FEATUREHUB_CLIENT_API_KEY`, else `FEATUREHUB_SERVER_API_KEY`. With no host and no key
   * (in code or the environment), a `configFactory` can supply a config whose features come from stores.
   */
  apiKey?: string;
  /** How long `initialize` (and context changes) wait for readiness. Default 10s. */
  waitForReadyMs?: number;
  /**
   * Build the FeatureHub config yourself, to attach value interceptors, feature stores and usage plugins.
   * It is given the options with `host` and `apiKey` as resolved (from the environment if not in code).
   */
  configFactory?: (options: FeatureHubProviderOptions) => FeatureHubConfig;
}

// featurehub-protocol.yaml providers.environment_variables.set: present and not empty once trimmed
function environment(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
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
export class FeatureHubProvider
  extends FeatureHubProviderCore<FeatureHubProviderOptions>
  implements Provider
{
  public readonly metadata: ProviderMetadata = { name: "featurehub" };
  public readonly runsOn = "server" as const;

  public readonly events = new OpenFeatureEventEmitter();

  /**
   * Server-evaluated keys only: the single shared evaluation context, held for
   * the provider's lifetime. Holding exactly one keeps the SDK's internal
   * reference count at 1 and lets the SDK reuse its evaluated bundle.
   */
  private sharedContext?: ClientContext;
  /** the context the shared context's features were fetched for */
  private builtSignature: string | undefined;
  /** the context being resolved, while `inFlight` resolutions are in progress */
  private activeSignature: string | undefined;
  private inFlight = 0;
  /** the fetch for `activeSignature`, which every resolution for it waits on */
  private building: Promise<void> | undefined;

  /**
   * Settings not given in code come from the environment, setting by setting (featurehub-protocol.yaml
   * providers.environment_variables): FEATUREHUB_EDGE_URL, then FEATUREHUB_CLIENT_API_KEY or else
   * FEATUREHUB_SERVER_API_KEY, and, with no transport option, the node SDK's mode
   * (FEATUREHUB_CONNECT_TYPE and FEATUREHUB_CONNECT_INTERVAL; streaming when neither is set).
   */
  constructor(options: FeatureHubProviderOptions = {}) {
    super("FeatureHubProvider", options, {
      host: options.host ?? environment("FEATUREHUB_EDGE_URL"),
      apiKey:
        options.apiKey ??
        environment("FEATUREHUB_CLIENT_API_KEY") ??
        environment("FEATUREHUB_SERVER_API_KEY"),
    });
  }

  protected get eventSink(): ProviderEventSink {
    // the SDK emitter is typed with its own event enum; the string values are
    // identical across the server and web SDKs
    return this.events as unknown as ProviderEventSink;
  }

  /** none: the node SDK's own, from FEATUREHUB_CONNECT_TYPE / FEATUREHUB_CONNECT_INTERVAL, else streaming */
  protected get defaultTransport(): Transport | undefined {
    return undefined;
  }

  protected createConfig(): FeatureHubConfig {
    return new EdgeFeatureHubConfig(this.host, this.apiKey);
  }

  async initialize(context?: EvaluationContext): Promise<void> {
    const deadline = Date.now() + this.waitForReadyMs;
    // a context FeatureHub cannot represent fails before anything connects
    const record = this.clientEval ? undefined : toContextRecord(context);
    const cfg = this.startConfig();

    if (record !== undefined) {
      // server-evaluated keys: one shared context for the provider's lifetime;
      // fetch the initial evaluated bundle so readiness reflects a real fetch
      this.sharedContext = cfg.context(record);
      await this.within(deadline, this.sharedContext.build());
    }
    // client-evaluated keys evaluate locally per resolution; there is nothing
    // to pre-fetch and the context is created per call

    await this.awaitReady(cfg, Math.max(0, deadline - Date.now()));
    if (record !== undefined) {
      this.builtSignature = contextSignature(context);
    }
  }

  override async onClose(): Promise<void> {
    await super.onClose();
    this.sharedContext = undefined;
    this.builtSignature = undefined;
    this.activeSignature = undefined;
    this.building = undefined;
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

  private resolve(
    flagKey: string,
    context: EvaluationContext,
    kind: FeatureKind,
    defaultValue: unknown,
    logger: Logger,
  ): Promise<ResolutionDetails<unknown>> {
    return this.resolveAsync(flagKey, kind, defaultValue, logger, () =>
      this.evaluate(flagKey, context),
    );
  }

  /**
   * Captures a consistent evaluation of a flag.
   *
   * - client-evaluated keys: a fresh local context is created per resolution
   *   (no shared state) and the flag is evaluated in-memory.
   * - server-evaluated keys: the one shared context is fetched again from Edge
   *   when the OpenFeature context changes, and the flag read once its features
   *   have arrived. While any resolution is in progress only its context may be
   *   resolved: another is refused, as it would be given the first's values.
   */
  private async evaluate(flagKey: string, context: EvaluationContext): Promise<FeatureEvaluation> {
    if (this.clientEval) {
      const ctx = this.config!.context(toContextRecord(context));
      return captureFeature(ctx.feature(flagKey));
    }

    const signature = contextSignature(context);
    if (this.inFlight > 0 && signature !== this.activeSignature) {
      throw new ContextConflictError();
    }

    this.inFlight++;
    this.activeSignature = signature;
    try {
      if (signature !== this.builtSignature) {
        this.building ??= this.fetchContext(context, signature).finally(() => {
          this.building = undefined;
        });
        await this.building;
      }
      // read through the shared context itself (config.feature would create
      // another reference-counted context per resolution)
      return captureFeature(this.sharedContext!.feature(flagKey));
    } finally {
      this.inFlight--;
    }
  }

  /**
   * Fetches the features for a new context into the shared context. Until they arrive the repository holds
   * the previous context's, so a fetch that fails, or does not finish in time, fails the resolution, and the
   * next resolution for the context tries again.
   */
  private async fetchContext(context: EvaluationContext, signature: string): Promise<void> {
    const deadline = Date.now() + this.waitForReadyMs;
    const cfg = this.config!;
    const ctx = this.sharedContext ?? cfg.context({});
    this.sharedContext = ctx;
    // the SDK's attributes setter MERGES into the existing attribute map
    // and clear() does not reset the user key — reset both, then apply
    ctx.userKey(undefined);
    ctx.clear();
    ctx.attributes = toContextRecord(context);
    await this.within(deadline, ctx.build());

    const readiness = await cfg.waitForReady(Math.max(0, deadline - Date.now()));
    if (readiness !== Readyness.Ready) {
      throw new Error(
        `FeatureHub could not fetch the features for the new context within ${this.waitForReadyMs}ms (readiness: ${readiness}).`,
      );
    }
    this.builtSignature = signature;
  }

  /** waits for the work, or until the deadline, whichever is first; the readiness check that follows decides */
  private async within(deadline: number, work: Promise<unknown>): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        work,
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, Math.max(0, deadline - Date.now()));
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
}
