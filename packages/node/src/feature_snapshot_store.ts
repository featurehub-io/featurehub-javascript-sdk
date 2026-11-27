/**
 * The snapshot server's store (feature-snapshot-protocol.yaml server.snapshot_store): a feature store that
 * follows the repository's raw feature updates, keeps its own copy of the features with their sha and clock
 * boundaries, and turns them into a snapshot for each request's context. It is the only place in the SDK that
 * computes a snapshot's sha or assembles a snapshot; the core SDK (and so every client) has neither.
 */
import { createHash } from "node:crypto";

import {
  caToString,
  type ClientContext,
  type ContextAttribute,
  type ContextRecord,
  type FeatureHubConfig,
  type FeatureRolloutStrategy,
  type FeatureSnapshot,
  type FeatureState,
  FeatureStateBaseHolder,
  fhLog,
  type InternalFeatureRepository,
  parseUtcDateTime,
  type RawUpdateFeatureListener,
  RolloutStrategyAttributeConditional,
  RolloutStrategyFieldType,
  StrategyAttributeWellKnownNames,
  xFeatureHubHeader,
} from "featurehub-javascript-core-sdk";

/** a context the protocol does not allow (an object, or a list holding one); a server answers 400 */
export class InvalidContextError extends Error {
  constructor(message: string) {
    super(`invalid context: ${message}`);
    this.name = "InvalidContextError";
  }
}

/**
 * The store has no features to serve: it has had no full set yet, or it refused to attach to a
 * server-evaluated key. A server answers 503.
 */
export class FeatureSnapshotNotReadyError extends Error {
  constructor(message = "the feature snapshot store has no features yet") {
    super(message);
    this.name = "FeatureSnapshotNotReadyError";
  }
}

export interface FeatureSnapshotRequest {
  /** the context to evaluate for; null, undefined and empty all mean no context */
  context?: Record<string, unknown> | null;
  /**
   * With no context: true gives the features as delivered, rollout strategies included, for clients that
   * evaluate locally; false (the default) evaluates them as for an empty context. With a context the features
   * are always evaluated for it. Serving strategies exposes every strategy and its values, so it has to be
   * asked for, and only for trusted clients. A server that leaves it false cannot serve clients that evaluate
   * locally: they send no context, and would get every feature's default value.
   */
  includeStrategies?: boolean;
  /**
   * The time (milliseconds since the epoch) to evaluate at and to count the ETag's clock boundaries with.
   * Without it the store's clock is read once, before anything is evaluated.
   */
  now?: number;
}

/** a snapshot with its ETag, which the server MUST send (only the store knows its clock part) */
export interface FeatureSnapshotResponse {
  snapshot: FeatureSnapshot;
  etag: string;
}

export interface FeatureSnapshotStoreOptions {
  /** the clock, in milliseconds since the epoch; Date.now by default. Tests may fix it */
  clock?: () => number;
}

const SOURCE = "snapshot-store";
const WELL_KNOWN = Object.values(StrategyAttributeWellKnownNames) as Array<string>;
const FHUB_WHEN_ACTIVE = "fhubwhenactive";
const DAY_MS = 24 * 60 * 60 * 1000;

function isPrimitive(value: unknown): boolean {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value instanceof Date
  );
}

/**
 * featurehub-protocol.yaml encoding.evaluation_context: null values are skipped; targetingKey or userkey
 * (any case) is the user key; the well-known names are lowercased; fhubWhenActive is dropped; anything else
 * passes through. A value is a string, number, boolean, date-time or a list of those; anything else is an
 * InvalidContextError.
 */
export function mapEvaluationContext(
  context: Record<string, unknown> | null | undefined,
): ContextRecord {
  const mapped: ContextRecord = {};

  for (const [key, value] of Object.entries(context ?? {})) {
    if (value === null || value === undefined) continue;

    const lower = key.toLowerCase();
    if (lower === FHUB_WHEN_ACTIVE) continue;

    if (
      Array.isArray(value) ? !value.every((v) => v === null || isPrimitive(v)) : !isPrimitive(value)
    ) {
      throw new InvalidContextError(
        `${key} must be a string, number, boolean, date-time or a list of those`,
      );
    }

    const values = Array.isArray(value) ? value.filter((v) => v !== null) : value;

    if (lower === "targetingkey" || lower === "userkey") {
      mapped["userkey"] = caToString(values as ContextAttribute);
    } else if (WELL_KNOWN.includes(lower)) {
      mapped[lower] = values as ContextAttribute;
    } else {
      mapped[key] = values as ContextAttribute;
    }
  }

  return mapped;
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * The input of featurehub-protocol.yaml encoding.sha: "<id>:<version>" for each feature, sorted by id
 * (ordinal comparison), joined with "|"; empty for no features.
 */
export function featuresShaInput(features: Iterable<Pick<FeatureState, "id" | "version">>): string {
  return [...features]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((f) => `${f.id}:${Math.trunc(f.version ?? 0)}`)
    .join("|");
}

/**
 * feature-snapshot-protocol.yaml encoding.snapshot_sha: the SHA-256 of the features' SHA input, the form
 * ("sendContext=true" evaluated, "sendContext=false" as delivered) and, for an evaluated snapshot with a
 * context, the context's canonical x-featurehub header.
 */
export function snapshotSha(featuresInput: string, evaluated: boolean, header?: string): string {
  const form = evaluated ? "sendContext=true" : "sendContext=false";
  const withHeader = evaluated && header ? `|${header}` : "";
  return sha256Hex(`${featuresInput}|${form}${withHeader}`);
}

// the conditionals fhubWhenActive compares the clock with; with any other it never matches
const CLOCK_CONDITIONALS: Array<string> = [
  RolloutStrategyAttributeConditional.Equals,
  RolloutStrategyAttributeConditional.NotEquals,
  RolloutStrategyAttributeConditional.Greater,
  RolloutStrategyAttributeConditional.GreaterEquals,
  RolloutStrategyAttributeConditional.Less,
  RolloutStrategyAttributeConditional.LessEquals,
];

const toSecond = (ms: number) => Math.floor(ms / 1000) * 1000;
const YYYY_MM_DD = /^(\d{4})-(\d{2})-(\d{2})/;

/**
 * feature-snapshot-protocol.yaml encoding.clock_boundaries: the moments (milliseconds since the epoch,
 * sorted, each once) at which an evaluated feature's value can change because the clock moved. An
 * fhubWhenActive time, and a DATETIME value, give its second and the next; a DATE value gives midnight UTC
 * at its start and at the start of the next day.
 */
export function clockBoundaries(features: Iterable<FeatureState>): Array<number> {
  const boundaries = new Set<number>();
  const second = (ms: number) => {
    boundaries.add(toSecond(ms));
    boundaries.add(toSecond(ms) + 1000);
  };

  for (const feature of features) {
    for (const strategy of (feature.strategies ?? []) as Array<FeatureRolloutStrategy>) {
      for (const attr of strategy?.attributes ?? []) {
        const values = (attr?.values ?? []).filter((v) => v !== null && v !== undefined);

        if (attr.fieldName?.toLowerCase() === FHUB_WHEN_ACTIVE) {
          if (!attr.conditional || !CLOCK_CONDITIONALS.includes(attr.conditional)) continue;
          for (const v of values) {
            // a date-time, its time part required, as the matcher reads it (no offset means UTC)
            if (typeof v !== "string" || !v.toUpperCase().includes("T")) continue;
            const parsed = parseUtcDateTime(v);
            if (parsed !== undefined) second(parsed.getTime());
          }
        } else if (attr.type === RolloutStrategyFieldType.Datetime) {
          for (const v of values) {
            const parsed = parseUtcDateTime(v);
            if (parsed !== undefined) second(parsed.getTime());
          }
        } else if (attr.type === RolloutStrategyFieldType.Date) {
          for (const v of values) {
            const match = typeof v === "string" ? YYYY_MM_DD.exec(v.trim()) : null;
            if (match === null) continue;
            const midnight = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
            if (Number.isNaN(midnight)) continue;
            boundaries.add(midnight);
            boundaries.add(midnight + DAY_MS);
          }
        }
      }
    }
  }

  return [...boundaries].sort((a, b) => a - b);
}

// the number of sorted boundaries at or before now
function countAtOrBefore(boundaries: ReadonlyArray<number>, now: number): number {
  let low = 0;
  let high = boundaries.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (boundaries[mid]! <= now) low = mid + 1;
    else high = mid;
  }
  return low;
}

/**
 * feature-snapshot-protocol.yaml encoding.etag: the sha in double quotes, with "_t<count>" before the
 * closing quote for an evaluated snapshot whose features have clock boundaries.
 */
export function snapshotEtag(
  sha: string,
  evaluated: boolean,
  boundaries: ReadonlyArray<number>,
  now: number,
): string {
  return evaluated && boundaries.length > 0
    ? `"${sha}_t${countAtOrBefore(boundaries, now)}"`
    : `"${sha}"`;
}

// the context the strategy matcher reads, as a client context would give it
function evaluationContext(record: ContextRecord): ClientContext {
  return {
    getAttr: (key: string, defaultValue?: ContextAttribute) => record[key] ?? defaultValue,
    defaultPercentageKey: () => caToString(record["session"]) ?? caToString(record["userkey"]),
  } as unknown as ClientContext;
}

/** featurehub-protocol.yaml repository.update_rule: is the incoming feature to replace the held one? */
function replaces(held: FeatureState | undefined, incoming: FeatureState): boolean {
  if (held === undefined) return true;

  const heldVersion = held.version ?? -1;
  const incomingVersion = incoming.version ?? -1;
  if (heldVersion > incomingVersion) return false;

  return !(
    heldVersion === incomingVersion &&
    held.id === incoming.id &&
    held.type === incoming.type &&
    (held.v ?? null) === (incoming.v ?? null) &&
    JSON.stringify(held.value) === JSON.stringify(incoming.value)
  );
}

/**
 * A feature store that serves snapshots of the repository's features (feature-snapshot-protocol.yaml
 * server.snapshot_store). Create it before the config connects, so it sees FeatureHub's first full set:
 *
 * ```ts
 * const config = new EdgeFeatureHubConfig(url, clientEvaluatedKey);
 * const snapshots = new FeatureSnapshotStore(config);
 * config.init();
 * app.get("/features", featureSnapshotHandler(snapshots));
 * ```
 *
 * The config must use a client-evaluated API key (one containing `*`): with a server-evaluated key the
 * store refuses to attach, and every request gets a not-ready error (503), rather than every client getting
 * the server's own context's values.
 */
export class FeatureSnapshotStore implements RawUpdateFeatureListener {
  private readonly _config: FeatureHubConfig;
  private readonly _clock: () => number;
  // the features by id, as delivered (strategies included)
  private _copy = new Map<string, FeatureState>();
  private _shaInput = "";
  private _boundaries: Array<number> = [];
  private _ready = false;
  private _attached = false;
  private _handle: number | undefined;
  // the repository it follows, kept: the config refuses to give it out once closed, and closing the
  // repository is what closes the store
  private readonly _repository: InternalFeatureRepository;

  constructor(config: FeatureHubConfig, options: FeatureSnapshotStoreOptions = {}) {
    this._config = config;
    this._clock = options.clock ?? Date.now;
    this._repository = config.repository() as InternalFeatureRepository;
    this.attach();
  }

  private attach() {
    if (this._config.getApiKeys().length > 0 && !this._config.clientEvaluated()) {
      fhLog.error(
        "[featurehubsdk] FeatureSnapshotStore: refusing to attach - a snapshot server must connect to " +
          "FeatureHub with a client-evaluated API key (one containing *): with a server-evaluated key every " +
          "client would get the server's own context's values",
      );
      return;
    }

    // features a store attached before this one (Redis, say) may already have loaded
    const held = this._repository.featureKeys
      .map((key) => this._repository.hasFeature(key))
      .map((holder) =>
        holder instanceof FeatureStateBaseHolder ? holder.getFeatureState() : undefined,
      )
      .filter((fs): fs is FeatureState => fs !== undefined);
    if (held.length > 0) {
      this.replaceAll(held);
    }

    this._handle = this._repository.registerRawUpdateFeatureListener(this);
    this._attached = true;
  }

  /** reads the store's clock: a handler reads it once per request, and passes it as the request's now */
  now(): number {
    return this._clock();
  }

  /** the store has had a full set of features (or was seeded with some), so it can serve snapshots */
  get ready(): boolean {
    return this._ready;
  }

  get connected(): boolean {
    return this._attached;
  }

  private changed() {
    const features = [...this._copy.values()];
    this._shaInput = featuresShaInput(features);
    this._boundaries = clockBoundaries(features);
  }

  private replaceAll(features: Array<FeatureState>) {
    this._copy = new Map(features.map((f) => [f.id, structuredClone(f)]));
    this._ready = true;
    this.changed();
  }

  processUpdates(features: Array<FeatureState>, source: string): void {
    if (source === SOURCE || !this._attached) return;
    this.replaceAll(features);
  }

  processUpdate(feature: FeatureState, source: string): void {
    if (source === SOURCE || !this._attached) return;
    if (!replaces(this._copy.get(feature.id), feature)) return;

    this._copy.set(feature.id, structuredClone(feature));
    this.changed();
  }

  deleteFeature(feature: FeatureState, source: string): void {
    if (source === SOURCE || !this._attached) return;

    const id =
      feature.id ?? [...this._copy.values()].find((f) => f.key === feature.key)?.id ?? undefined;
    if (id !== undefined && this._copy.delete(id)) {
      this.changed();
    }
  }

  configChanged(): void {
    // nothing depends on the config once attached
  }

  close(): void {
    if (this._handle !== undefined) {
      this._repository.removeRawUpdateFeatureListener(this._handle);
      this._handle = undefined;
    }
    this._attached = false;
    this._ready = false;
    this._copy = new Map();
    this._shaInput = "";
    this._boundaries = [];
  }

  // what a request asks for: the mapped context, whether it is evaluated, its sha and its ETag at now
  private prepare(request: FeatureSnapshotRequest, now: number) {
    const context = mapEvaluationContext(request.context);
    if (!this._ready) {
      throw new FeatureSnapshotNotReadyError();
    }

    const header = xFeatureHubHeader(context);
    const evaluated = header.length > 0 || request.includeStrategies !== true;
    const sha = snapshotSha(this._shaInput, evaluated, header);

    return { context, evaluated, sha, etag: snapshotEtag(sha, evaluated, this._boundaries, now) };
  }

  /**
   * The ETag the request's snapshot would have (feature-snapshot-protocol.yaml
   * server.endpoint.conditional_requests), without evaluating anything: for the If-None-Match check. Pass
   * the `now` the snapshot itself will be taken at, so a 200's body and ETag agree.
   */
  etag(request: FeatureSnapshotRequest = {}): string {
    return this.prepare(request, request.now ?? this._clock()).etag;
  }

  /**
   * The request's snapshot and its ETag (feature-snapshot-protocol.yaml server.snapshot_api): evaluated for
   * the context or, with no context, as for an empty context unless includeStrategies asks for the features
   * as delivered. Value interceptors are not applied. The clock is read once, before evaluating, and that
   * time is used for the evaluation and the ETag alike.
   *
   * Throws InvalidContextError for a context the protocol does not allow (answer 400), and
   * FeatureSnapshotNotReadyError before the store has features (answer 503).
   */
  featureSnapshot(request: FeatureSnapshotRequest = {}): FeatureSnapshotResponse {
    const now = request.now ?? this._clock();
    const { context, evaluated, sha, etag } = this.prepare(request, now);
    const copy = [...this._copy.values()];

    if (!evaluated) {
      return { snapshot: { sha, features: copy.map((f) => structuredClone(f)) }, etag };
    }

    const repository = this._repository;
    const ctx = evaluationContext(context);
    const features: Array<FeatureState> = [];

    for (const held of copy) {
      // the repository's own answer for the feature, which it may have deleted meanwhile
      const holder = repository.hasFeature(held.key);
      const fs = holder instanceof FeatureStateBaseHolder ? holder.getFeatureState() : undefined;
      if (fs === undefined) continue;

      const strategies = fs.strategies ?? [];
      const applied =
        strategies.length > 0 ? repository.apply(strategies, fs.key, fs.id, ctx, now) : undefined;

      const evaluatedFeature: FeatureState = {
        id: fs.id,
        key: fs.key,
        version: fs.version,
        type: fs.type,
        value:
          applied === undefined
            ? fs.value
            : applied.matched
              ? (applied.value as unknown)
              : fs.value,
        v: applied === undefined ? (fs.v ?? null) : applied.matched ? applied.strategyId : null,
      } as FeatureState;
      if (fs.l !== undefined) evaluatedFeature.l = fs.l;
      if (fs.fp !== undefined && fs.fp !== null) evaluatedFeature.fp = { ...fs.fp };
      if (fs.environmentId !== undefined) evaluatedFeature.environmentId = fs.environmentId;

      features.push(evaluatedFeature);
    }

    return { snapshot: { sha, features }, etag };
  }
}
