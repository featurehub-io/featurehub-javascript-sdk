---
"featurehub-javascript-client-sdk": minor
---

`featureSnapshotConfig({ url })` gives a config whose features come from a feature snapshot server (your own server re-serving them) instead of FeatureHub Edge: it polls the server, actively or passively, sending the context as query parameters (or, with `sendContext: false`, evaluating locally) and the last `ETag` for that context.
