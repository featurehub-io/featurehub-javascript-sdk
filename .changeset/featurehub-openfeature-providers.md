---
"featurehub-openfeature-node-sdk": minor
"featurehub-openfeature-web-sdk": minor
"featurehub-openfeature-common": minor
---

Adds the official OpenFeature providers for FeatureHub: a Node.js provider (client-evaluated and server-evaluated keys; streaming, polling or passive transports) and a Web provider (client-evaluated keys; REST passive by default, with streaming and polling available). Every OpenFeature resolution is evaluated locally against the SDK's feature repository — there are no per-flag network calls.

The providers share their context mapping, resolution semantics and lifecycle (`featurehub-openfeature-common`); each keeps only its platform-specific behaviour. `PROVIDER_CONFIGURATION_CHANGED` is emitted only for features whose versions actually changed, rather than on every poll.
