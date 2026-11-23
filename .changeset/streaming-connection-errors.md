---
"featurehub-javascript-core-sdk": patch
"featurehub-javascript-node-sdk": patch
"featurehub-javascript-client-sdk": patch
---

Streaming fixes, following the FeatureHub protocol:

- Node: the `x-featurehub` header (the context of a server-evaluated key) is now sent when streaming. The `eventsource` library ignores a `headers` option since v3, so Edge evaluated without the context and returned the wrong values with no error.
- Connection errors are classified as the protocol says: any 4xx, a `failure` event, or a browser `EventSource` closing (which hides the status) stops streaming for good and tells the repository the connection failed. A 5xx, or a response that is not an event stream, is temporary: Node reconnects with a growing, configurable backoff (`FeatureHubEventSourceClient.reconnectPolicy`). A dropped connection the event source re-establishes itself is a bye. Previously any error before the first features was a permanent failure, any 5xx above 504 was too, and in Node the HTTP status was never read.
