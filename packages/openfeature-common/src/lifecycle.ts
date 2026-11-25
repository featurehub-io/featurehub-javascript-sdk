import { type Logger, ProviderFatalError, type ResolutionDetails } from "@openfeature/core";
import type { FeatureHubConfig, FeatureState } from "featurehub-javascript-core-sdk";
import { Readyness } from "featurehub-javascript-core-sdk";

import { InvalidContextError, isClientEvaluatedKey } from "./context-mapper";
import {
  type FeatureKind,
  type FeatureSnapshot,
  generalErrorResolution,
  invalidContextResolution,
  notReadyResolution,
  resolveFromEvaluation,
} from "./resolution";

// both platforms have it, but this package's tsconfig has neither the DOM nor the node types
declare const setTimeout: (callback: () => void, ms: number) => unknown;

/** How the provider keeps its local repository up to date. */
export type Transport = "streaming" | "polling" | "passive";

/** The transport-related slice of the provider options. */
export interface TransportSelection {
  /** Poll Edge every N milliseconds (REST active). Implies `transport: "polling"`. */
  pollIntervalMs?: number;
  /** Only contact Edge when a resolution happens after this many milliseconds (REST passive). Implies `transport: "passive"`. */
  cacheTimeToLiveMs?: number;
  /** Explicit transport; overrides the platform default but not the two options above. */
  transport?: Transport;
}

export interface BaseProviderOptions<TOptions> extends TransportSelection {
  /** Base URL of FeatureHub Edge, e.g. `https://edge.featurehub.io`. */
  host: string;
  /** A FeatureHub SDK API key (see the provider docs for eval-mode guidance). */
  apiKey: string;
  /** How long `initialize` waits for readiness. Default 10s. */
  waitForReadyMs?: number;
  /** Build the platform FeatureHubConfig (overridable for tests). */
  configFactory?: (options: TOptions) => FeatureHubConfig;
}

/**
 * The minimal shape of an OpenFeature event emitter. Each SDK types its
 * emitter with its own event enum, whose string values are identical across
 * the server and web SDKs, so the shared base stays SDK-agnostic.
 */
export interface ProviderEventSink {
  emit(event: string, details?: { message?: string; flagsChanged?: string[] }): void;
}

const PROVIDER_READY = "PROVIDER_READY";
const PROVIDER_ERROR = "PROVIDER_ERROR";
const PROVIDER_CONFIGURATION_CHANGED = "PROVIDER_CONFIGURATION_CHANGED";
const PROVIDER_STALE = "PROVIDER_STALE";

/**
 * Applies the transport selected by the provider options. Explicit
 * `pollIntervalMs` / `cacheTimeToLiveMs` win over `transport`, which in turn
 * wins over the platform default.
 */
export function applyTransport(
  cfg: FeatureHubConfig,
  options: TransportSelection,
  defaultTransport: Transport,
): void {
  if (options.cacheTimeToLiveMs !== undefined) {
    cfg.restPassive(options.cacheTimeToLiveMs);
    return;
  }
  if (options.pollIntervalMs !== undefined) {
    cfg.restActive(options.pollIntervalMs);
    return;
  }

  switch (options.transport ?? defaultTransport) {
    case "passive":
      cfg.restPassive();
      break;
    case "polling":
      cfg.restActive();
      break;
    default:
      cfg.streaming();
  }
}

/**
 * Shared provider lifecycle: config creation, event wiring (with change
 * detection), transport selection, readiness and teardown, plus the resolution
 * error mapping. Subclasses contribute only what is genuinely platform
 * specific: the event emitter, the config constructor, the default transport,
 * and their resolve methods.
 */
export abstract class FeatureHubProviderCore<TOptions extends BaseProviderOptions<TOptions>> {
  protected readonly options: TOptions;
  protected readonly clientEval: boolean;
  protected readonly waitForReadyMs: number;

  protected config?: FeatureHubConfig;
  /**
   * Features are held and resolve: readiness is Ready, or Stale (a context change in progress, or a
   * connection that stopped for good after delivering features; featurehub-protocol.yaml repository.readiness).
   */
  protected ready = false;

  private started = false;
  /** the connection has stopped for good (connection failed, or environment stale) */
  private stopped = false;
  private staleEmitted = false;
  private lastReadiness: Readyness = Readyness.NotReady;
  /** key → last seen feature version, so polls that change nothing stay silent. */
  private readonly featureVersions = new Map<string, number | undefined>();
  private seenPayload = false;

  protected constructor(providerName: string, options: TOptions) {
    if (!options?.host || !options?.apiKey) {
      throw new Error(`${providerName} requires \`host\` and \`apiKey\`.`);
    }
    this.options = options;
    this.clientEval = isClientEvaluatedKey(options.apiKey);
    this.waitForReadyMs = options.waitForReadyMs ?? 10_000;
  }

  /** This platform's OpenFeature event emitter. */
  protected abstract get eventSink(): ProviderEventSink;

  /** Create the config from this platform's FeatureHub SDK. */
  protected abstract createConfig(): FeatureHubConfig;

  /** Transport used when the options do not select one explicitly. */
  protected abstract get defaultTransport(): Transport;

  /** Creates the config, wires its listeners, applies the transport and calls `init()`. */
  protected startConfig(): FeatureHubConfig {
    const cfg = this.options.configFactory
      ? this.options.configFactory(this.options)
      : this.createConfig();
    this.config = cfg;

    cfg.addReadinessListener((readiness) => this.onReadiness(readiness));
    // a connection that stops for good is told by its own event, as readiness may already be Stale (during
    // a context change) when it happens; optional, for configs from SDK versions without it
    cfg.addConnectionEventListener?.(() => this.onConnectionStopped());

    cfg.registerRawUpdateFeatureListener({
      get connected(): boolean {
        return cfg.initialized;
      },
      processUpdate: (feature) => this.emitChanged(this.noteVersions([feature], false)),
      processUpdates: (features) => this.emitChanged(this.noteVersions(features, true)),
      deleteFeature: (feature) => {
        if (!feature?.key) {
          return;
        }
        this.featureVersions.delete(feature.key);
        this.emitChanged([feature.key]);
      },
      close: () => {
        /* lifecycle handled in onClose */
      },
      configChanged: () => {
        /* individual features emit above */
      },
    });

    applyTransport(cfg, this.options, this.defaultTransport);
    cfg.init();
    return cfg;
  }

  /**
   * Waits for the repository to become ready, then allows lifecycle events through
   * (featurehub-protocol.yaml providers.events):
   * - Failed (the connection was rejected before any features): initialisation fails, PROVIDER_FATAL
   * - Stale with features, because the connection stopped for good with the first response: initialisation
   *   succeeds and STALE follows READY
   * - anything else not Ready in time: initialisation fails
   */
  protected async awaitReady(cfg: FeatureHubConfig): Promise<void> {
    const readiness = await cfg.waitForReady(this.waitForReadyMs);
    const stopped = this.stopped || cfg.connectionFailed === true || cfg.environmentStale === true;

    if (readiness === Readyness.Failed) {
      throw new ProviderFatalError(
        "FeatureHub rejected the connection before sending any features (readiness: Failed).",
      );
    }
    if (readiness !== Readyness.Ready && !(readiness === Readyness.Stale && stopped)) {
      throw new Error(
        `FeatureHub did not become ready within ${this.waitForReadyMs}ms (readiness: ${readiness}).`,
      );
    }
    this.ready = true;
    // the OpenFeature SDK emits PROVIDER_READY itself when initialize resolves,
    // so the listener only emits (re)transitions from here on
    this.started = true;

    if (stopped) {
      this.stopped = true;
      // after the SDK's own READY, which it emits once initialize has resolved
      setTimeout(() => this.emitStale(), 0);
    }
  }

  async onClose(): Promise<void> {
    this.ready = false;
    const cfg = this.config;
    this.config = undefined;
    try {
      // forceClose tears down the edge, repository and usage adapter regardless
      // of any reference counting on a shared server-eval context
      cfg?.forceClose();
    } catch {
      // already closed
    }
  }

  /** Synchronous resolution helper (web providers). */
  protected resolveSync(
    flagKey: string,
    kind: FeatureKind,
    defaultValue: unknown,
    logger: Logger | undefined,
    take: () => FeatureSnapshot,
  ): ResolutionDetails<unknown> {
    if (!this.ready || !this.config) {
      return notReadyResolution(defaultValue);
    }
    try {
      return resolveFromEvaluation(flagKey, kind, defaultValue, take());
    } catch (err) {
      return this.failedResolution(flagKey, defaultValue, err, logger);
    }
  }

  /** Asynchronous resolution helper (node providers). */
  protected async resolveAsync(
    flagKey: string,
    kind: FeatureKind,
    defaultValue: unknown,
    logger: Logger | undefined,
    take: () => FeatureSnapshot | Promise<FeatureSnapshot>,
  ): Promise<ResolutionDetails<unknown>> {
    if (!this.ready || !this.config) {
      return notReadyResolution(defaultValue);
    }
    try {
      return resolveFromEvaluation(flagKey, kind, defaultValue, await take());
    } catch (err) {
      return this.failedResolution(flagKey, defaultValue, err, logger);
    }
  }

  private failedResolution(
    flagKey: string,
    defaultValue: unknown,
    err: unknown,
    logger: Logger | undefined,
  ): ResolutionDetails<unknown> {
    if (err instanceof InvalidContextError) {
      return invalidContextResolution(defaultValue, err);
    }
    logger?.error(`FeatureHub evaluation of '${flagKey}' failed`, err);
    return generalErrorResolution(defaultValue, err);
  }

  private onReadiness(readiness: Readyness): void {
    if (readiness === this.lastReadiness) {
      return;
    }
    const wasReady = this.ready;
    this.lastReadiness = readiness;

    switch (readiness) {
      case Readyness.Ready:
        this.ready = true;
        // a recovery from no features; not the end of a context change (Stale -> Ready), which kept resolving
        if (this.started && !wasReady) {
          this.eventSink.emit(PROVIDER_READY, { message: "FeatureHub repository is ready" });
        }
        break;
      case Readyness.Stale:
        // the features are still held and resolved: a context change in progress (no event), or a connection
        // that stopped for good (STALE, from its own event)
        this.ready = wasReady || this.started;
        break;
      case Readyness.Failed:
        this.ready = false;
        if (this.started) {
          this.eventSink.emit(PROVIDER_ERROR, { message: "FeatureHub repository failed" });
        }
        break;
      default:
        // NotReady: the features were cleared
        this.ready = false;
    }
  }

  private onConnectionStopped(): void {
    this.stopped = true;
    if (this.started) {
      this.emitStale();
    }
  }

  /** STALE once, after READY, while features are held; resolutions continue from the last features. */
  private emitStale(): void {
    if (this.staleEmitted || !this.ready || !this.config) {
      return;
    }
    this.staleEmitted = true;
    this.eventSink.emit(PROVIDER_STALE, {
      message: "FeatureHub will send no more updates: resolving from the last features",
    });
  }

  /**
   * Records the versions carried by a payload and returns the keys that
   * actually changed. The first payload after construction is a baseline: the
   * repository replays the full feature set on every poll (and on every SSE
   * reconnect), so without this comparison ConfigurationChanged would fire on
   * every poll even when nothing changed. A full set also removes every feature
   * it does not hold, which is a change too.
   */
  private noteVersions(features: Array<FeatureState | undefined>, fullSet: boolean): string[] {
    const baseline = !this.seenPayload;
    const changed: string[] = [];

    if (fullSet) {
      const delivered = new Set(features.map((f) => f?.key).filter((k): k is string => !!k));
      for (const key of [...this.featureVersions.keys()]) {
        if (!delivered.has(key)) {
          this.featureVersions.delete(key);
          if (!baseline) {
            changed.push(key);
          }
        }
      }
    }

    for (const feature of features) {
      const key = feature?.key;
      if (!key) {
        continue;
      }
      const had = this.featureVersions.has(key);
      if (had ? this.featureVersions.get(key) !== feature.version : !baseline) {
        changed.push(key);
      }
      this.featureVersions.set(key, feature.version);
    }

    this.seenPayload = true;
    return changed;
  }

  private emitChanged(keys: string[]): void {
    if (!this.started || keys.length === 0) {
      return;
    }
    this.eventSink.emit(PROVIDER_CONFIGURATION_CHANGED, { flagsChanged: keys });
  }
}
