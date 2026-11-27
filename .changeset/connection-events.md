---
"featurehub-javascript-core-sdk": minor
"featurehub-javascript-node-sdk": patch
"featurehub-javascript-client-sdk": patch
---

The config and repository now say when the connection stops for good. `connectionFailed` and `environmentStale` are available on `FeatureHubConfig` and `FeatureHubRepository`, and `addConnectionEventListener` tells a `ConnectionEvent` (`ConnectionFailed` or `EnvironmentStale`) once, as an event of its own. Readiness alone cannot always say it: during a server-evaluated context change readiness is already `Stale`, so a failure then changes nothing a readiness listener sees. A listener added after the event is told at once.
