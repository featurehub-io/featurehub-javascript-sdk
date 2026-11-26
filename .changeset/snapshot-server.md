---
"featurehub-javascript-node-sdk": minor
---

The feature snapshot server (feature snapshot protocol 2.0.0): `FeatureSnapshotStore` follows a config's repository and serves its features, evaluated for each request's context, and `featureSnapshotHandler(store)` serves them over HTTP with ETags and `304`s. An ETag covers the features, the form (evaluated, or with strategies) and the context. It also changes as the clock passes a feature's `fhubWhenActive` or date times. A request with no context is evaluated as for an empty context unless the server chooses to serve strategies (`serveStrategiesWithoutContext`, or `includeStrategies`). The store refuses a server-evaluated API key.
