---
"featurehub-javascript-node-sdk": minor
---

A Node server can re-serve its features to its own clients with the feature snapshot protocol: `featureSnapshotHandler(fhConfig, options)` is a ready-made handler for Node's http server or Express (the query parameters are the context; `ETag`, `304`, `400` and `503` as the protocol says, and optional CORS), and `featureSnapshot(fhConfig, { context, includeStrategies })` gives the snapshot itself. Features are evaluated for each request's context; serving them with their strategies, for clients that evaluate locally, has to be asked for. A server-evaluated API key is refused.
