---
"featurehub-openfeature-node-sdk": minor
"featurehub-openfeature-web-sdk": minor
"featurehub-openfeature-common": minor
---

Adds the official OpenFeature providers for FeatureHub: a Node.js provider (client-evaluated and server-evaluated keys; streaming, polling or passive transports) and a Web provider (client-evaluated keys, SSE streaming). Every OpenFeature resolution is evaluated locally against the SDK's feature repository — there are no per-flag network calls.

The shared context mapping and OpenFeature resolution semantics live in `featurehub-openfeature-common`, which both providers depend on; the providers contain only their transport and context-lifecycle differences.
