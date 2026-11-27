---
"featurehub-javascript-core-sdk": minor
"featurehub-javascript-node-sdk": minor
"featurehub-javascript-client-sdk": patch
---

The SDK now speaks generation 2 of the FeatureHub protocol: every poll and streaming connection sends `sdk_version=2`, which tells Edge it can skip resending features the SDK already has.

- **Last-Event-ID:** streaming keeps the id of the last event it received and sends it when it reconnects, so Edge can hold a quiet connection open without resending features. A browser's `EventSource` does this itself; in Node the SDK now makes every reconnection itself, sending it. A context change never sends the old context's id.
- **Quiet connections and clean byes:** a connection that lasts and ends with Edge's `bye` is a clean end, not a failure, however many come in a row.
- **Short connections:** a connection that ends within 10 seconds of its request (a CDN or cache replaying a closed stream) counts as a failure even if it ended with a `bye`, and a warning is logged after three in a row.
- **Backoff:** Node backs off between failed connections (`FeatureHubEventSourceClient.reconnectPolicy`), and `reconnectPolicy.maxAttempts` optionally stops streaming for good after that many reconnection attempts.
