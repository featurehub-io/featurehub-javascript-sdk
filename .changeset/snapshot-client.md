---
"featurehub-javascript-core-sdk": minor
"featurehub-javascript-client-sdk": minor
"featurehub-javascript-node-sdk": minor
---

The feature snapshot client (feature snapshot protocol 2.0.0): `featureSnapshotConfig({ url })` gives a config whose features come from your own server, a snapshot server, instead of FeatureHub Edge. It polls actively or passively, sends the context as query parameters (or, with `sendContext: false`, evaluates locally), and sends back the server's ETag for that context. A `4xx` other than `429` stops it for good. `decodeFeatureSnapshot` reads a snapshot. The client computes no SHA.

Also:

- `EdgeService.contextChange` is given the context's attributes as well as its header
- a repository's `apply` takes an optional time to evaluate at, used for `fhubWhenActive` and for the current time a `DATE` or `DATETIME` attribute uses when the context does not supply it
- `parseUtcDateTime` is exported
