/**
 * The snapshot server (feature-snapshot-protocol.yaml server): your own Node server, connected to FeatureHub
 * with a client-evaluated API key, re-serving the features to its own clients, evaluated for each request's
 * context. A snapshot client (featurehub-javascript-client-sdk's snapshot config) reads them.
 */
import {
  caToString,
  type ClientContext,
  type ContextAttribute,
  type ContextRecord,
  type FeatureHubConfig,
  type FeatureSnapshot,
  featureSnapshotEtag,
  type FeatureState,
  fhLog,
  type InternalFeatureRepository,
  Readyness,
  StrategyAttributeWellKnownNames,
} from "featurehub-javascript-core-sdk";
import type { IncomingMessage, ServerResponse } from "http";

/** a context the protocol does not allow (an object, or a list holding one); a server answers 400 */
export class InvalidContextError extends Error {
  constructor(message: string) {
    super(`invalid context: ${message}`);
    this.name = "InvalidContextError";
  }
}

/** the server cannot serve features: it has none yet, or it is connected with a server-evaluated key */
export class FeatureSnapshotUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FeatureSnapshotUnavailableError";
  }
}

export interface FeatureSnapshotOptions {
  /** the context to evaluate for; null, undefined and empty all mean no context */
  context?: Record<string, unknown> | null;
  /**
   * With no context: true gives the features as delivered, rollout strategies included, for clients that
   * evaluate locally; false (the default) evaluates them as for an empty context. With a context the features
   * are always evaluated for it. Serving strategies exposes every strategy and its values, so it has to be
   * asked for, and only for trusted clients.
   */
  includeStrategies?: boolean;
}

const WELL_KNOWN = Object.values(StrategyAttributeWellKnownNames) as Array<string>;

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
    if (lower === "fhubwhenactive") continue;

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

/** the context the strategy matcher reads, as a client context would give it */
function evaluationContext(record: ContextRecord): ClientContext {
  return {
    getAttr: (key: string, defaultValue?: ContextAttribute) => record[key] ?? defaultValue,
    defaultPercentageKey: () => caToString(record["session"]) ?? caToString(record["userkey"]),
  } as unknown as ClientContext;
}

/** a snapshot server must use a client-evaluated key, or it would serve its own one context's values */
function assertClientEvaluated(config: FeatureHubConfig) {
  const serverEvaluated = config.getApiKeys().filter((k) => !k.includes("*"));

  if (serverEvaluated.length > 0) {
    throw new FeatureSnapshotUnavailableError(
      "a snapshot server must connect to FeatureHub with a client-evaluated API key (one containing *): with a " +
        "server-evaluated key every client would get the server's own context's values",
    );
  }
}

function evaluate(
  repository: InternalFeatureRepository,
  fs: FeatureState,
  context: ClientContext,
): FeatureState {
   
  const { strategies, ...rest } = fs;

  if (!strategies || strategies.length === 0) {
    return rest as FeatureState; // as is, keeping its v
  }

  const applied = repository.apply(strategies, fs.key, fs.id, context);

  return {
    ...rest,
    value: applied.matched ? applied.value : fs.value,
    v: applied.matched ? applied.strategyId : null,
  } as FeatureState;
}

/**
 * The features the config's repository holds, as a snapshot (feature-snapshot-protocol.yaml
 * server.snapshot_api): evaluated for the context, or, with no context, evaluated as for an empty context
 * unless includeStrategies asks for them as delivered. Value interceptors are not applied, and the sha is
 * the repository's, whichever form is given.
 *
 * A server that leaves includeStrategies false cannot serve clients that evaluate locally: they send no
 * context, and would get every feature's default value.
 *
 * Throws InvalidContextError for a context the protocol does not allow, and FeatureSnapshotUnavailableError
 * if the config uses a server-evaluated key.
 */
export function featureSnapshot(
  config: FeatureHubConfig,
  options: FeatureSnapshotOptions = {},
): FeatureSnapshot {
  assertClientEvaluated(config);

  const repository = config.repository() as InternalFeatureRepository;
  const context = mapEvaluationContext(options.context);
  const sha = repository.featuresSha;
  const features = repository.featureStates();

  if (Object.keys(context).length === 0 && options.includeStrategies === true) {
    return { sha, features };
  }

  const ctx = evaluationContext(context);
  return { sha, features: features.map((fs) => evaluate(repository, fs, ctx)) };
}

export interface FeatureSnapshotHandlerOptions {
  /**
   * A request with no query parameters gets the features with their rollout strategies (for clients that
   * evaluate locally) when true, or evaluated as for an empty context when false (the default). A request
   * with query parameters is always evaluated for them.
   */
  serveStrategiesWithoutContext?: boolean;
  /** answer CORS preflights and allow this origin ("*" for any), for browser clients on another origin */
  allowOrigin?: string;
}

/** If-None-Match matches if any of its tags (W/ stripped) is "*" or the ETag itself */
export function ifNoneMatchMatches(header: string | string[] | undefined, etag: string): boolean {
  const value = Array.isArray(header) ? header.join(",") : header;
  if (!value) return false;

  return value
    .split(",")
    .map((tag) => tag.trim().replace(/^W\//, ""))
    .some((tag) => tag === "*" || tag === etag);
}

function queryContext(url: string | undefined): Record<string, string | string[]> {
  // URLSearchParams decodes both "+" and "%20" as a space
  const params = new URL(url ?? "/", "http://localhost").searchParams;
  const context: Record<string, string | string[]> = {};

  for (const name of new Set(params.keys())) {
    const values = params.getAll(name);
    context[name] = values.length === 1 ? values[0]! : values;
  }

  return context;
}

/**
 * A ready-made handler for a snapshot server's features endpoint (feature-snapshot-protocol.yaml
 * server.endpoint), for Node's http server or Express (`app.get("/features", handler)`). The query
 * parameters are the context. Answers 200 with the snapshot, 304 for a matching If-None-Match, 400 for an
 * invalid context, and 503 before the server has any features or if it uses a server-evaluated key.
 */
export function featureSnapshotHandler(
  config: FeatureHubConfig,
  options: FeatureSnapshotHandlerOptions = {},
): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    if (options.allowOrigin) {
      res.setHeader("Access-Control-Allow-Origin", options.allowOrigin);
      res.setHeader("Access-Control-Allow-Headers", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
      res.setHeader("Access-Control-Expose-Headers", "ETag");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }
    }

    const text = (status: number, message: string) => {
      res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(message);
    };

    try {
      const repository = config.repository() as InternalFeatureRepository;
      const readiness = repository.readyness;
      if (readiness === Readyness.NotReady || readiness === Readyness.Failed) {
        text(503, "FeatureHub features are not available yet");
        return;
      }

      assertClientEvaluated(config);

      const etag = featureSnapshotEtag(repository.featuresSha);
      if (ifNoneMatchMatches(req.headers["if-none-match"], etag)) {
        res.writeHead(304, { ETag: etag, "Cache-Control": "no-cache" });
        res.end();
        return;
      }

      const snapshot = featureSnapshot(config, {
        context: queryContext(req.url),
        includeStrategies: options.serveStrategiesWithoutContext === true,
      });

      res.writeHead(200, {
        "Content-Type": "application/json",
        ETag: featureSnapshotEtag(snapshot.sha),
        "Cache-Control": "no-cache",
      });
      res.end(JSON.stringify(snapshot));
    } catch (e) {
      if (e instanceof InvalidContextError) {
        text(400, e.message);
      } else if (e instanceof FeatureSnapshotUnavailableError) {
        fhLog.error(`[featurehubsdk] ${e.message}`);
        text(503, e.message);
      } else {
        fhLog.error("[featurehubsdk] failed to serve a feature snapshot", e);
        text(500, "failed to serve features");
      }
    }
  };
}
