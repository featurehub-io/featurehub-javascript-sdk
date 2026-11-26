/**
 * A ready-made HTTP handler for a snapshot server's features endpoint (feature-snapshot-protocol.yaml
 * server.endpoint), built on a FeatureSnapshotStore.
 */
import { fhLog } from "featurehub-javascript-core-sdk";
import type { IncomingMessage, ServerResponse } from "http";

import {
  FeatureSnapshotNotReadyError,
  type FeatureSnapshotStore,
  InvalidContextError,
} from "./feature_snapshot_store";

export interface FeatureSnapshotHandlerOptions {
  /**
   * A request with no query parameters gets the features with their rollout strategies (for clients that
   * evaluate locally, such as a snapshot client with sendContext false) when true, or evaluated as for an
   * empty context when false (the default). A request with query parameters is always evaluated for them.
   * Serving strategies exposes every strategy and its values: only do it for trusted clients. Leaving it
   * false means clients that evaluate locally get every feature's default value.
   */
  serveStrategiesWithoutContext?: boolean;
  /** answer CORS preflights and allow this origin ("*" for any), for browser clients on another origin */
  allowOrigin?: string;
}

/**
 * If-None-Match matches if any of its tags, trimmed and with a leading W/ removed, is "*" or exactly the
 * ETag (feature-snapshot-protocol.yaml server.endpoint.conditional_requests.if_none_match_matching).
 */
export function ifNoneMatchMatches(header: string | string[] | undefined, etag: string): boolean {
  const value = Array.isArray(header) ? header.join(",") : header;
  if (!value) return false;

  return value
    .split(",")
    .map((tag) => tag.trim().replace(/^W\//, ""))
    .some((tag) => tag === "*" || tag === etag);
}

/**
 * The request's query parameters as a context: a name given once is a string, a name repeated is a list.
 * URLSearchParams decodes both "+" and "%20" as a space. Undefined when there are none.
 */
export function queryContext(
  url: string | undefined,
): Record<string, string | string[]> | undefined {
  const params = new URL(url ?? "/", "http://localhost").searchParams;
  const context: Record<string, string | string[]> = {};

  for (const name of new Set(params.keys())) {
    const values = params.getAll(name);
    context[name] = values.length === 1 ? values[0]! : values;
  }

  return Object.keys(context).length === 0 ? undefined : context;
}

/**
 * Serves a snapshot store's features (feature-snapshot-protocol.yaml server.endpoint), for Node's http
 * server or Express (`app.get("/features", featureSnapshotHandler(store))`). The query parameters are the
 * context. Answers 200 with the snapshot and its ETag, 304 for a matching If-None-Match, 400 for an invalid
 * context, and 503 before the store has any features (or when it refused a server-evaluated key).
 */
export function featureSnapshotHandler(
  store: FeatureSnapshotStore,
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
      const request = {
        context: queryContext(req.url) ?? null,
        includeStrategies: options.serveStrategiesWithoutContext === true,
        // one reading of the clock for the ETag and the body alike
        now: store.now(),
      };

      const etag = store.etag(request);
      if (ifNoneMatchMatches(req.headers["if-none-match"], etag)) {
        res.writeHead(304, { ETag: etag, "Cache-Control": "no-cache" });
        res.end();
        return;
      }

      const { snapshot } = store.featureSnapshot(request);
      res.writeHead(200, {
        "Content-Type": "application/json",
        ETag: etag,
        "Cache-Control": "no-cache",
      });
      res.end(JSON.stringify(snapshot));
    } catch (e) {
      if (e instanceof InvalidContextError) {
        text(400, e.message);
      } else if (e instanceof FeatureSnapshotNotReadyError) {
        text(503, e.message);
      } else {
        fhLog.error("[featurehubsdk] failed to serve a feature snapshot", e);
        text(500, "failed to serve features");
      }
    }
  };
}
