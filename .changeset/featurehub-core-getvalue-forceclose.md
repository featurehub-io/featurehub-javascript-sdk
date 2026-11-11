---
"featurehub-javascript-core-sdk": minor
---

Add `FeatureStateHolder.getValue()`, which returns the evaluated feature (value plus the id of the rollout strategy that matched, if any) in one call. It is the public equivalent of the internal evaluation the typed getters already perform, so adapters such as the OpenFeature providers can report `variant`/`TARGETING_MATCH` without reaching into internals.

`forceClose()` is now part of the `FeatureHubConfig` interface, allowing the owner of a config (for example an OpenFeature provider's `onClose`) to tear down the edge connection, repository and usage plugin immediately rather than relying on the reference-counted `close()`.
