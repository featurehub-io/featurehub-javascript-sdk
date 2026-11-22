---
"featurehub-javascript-core-sdk": minor
"featurehub-javascript-node-sdk": patch
"featurehub-javascript-client-sdk": patch
---

Add `FeatureStateHolder.getValue()`, which returns the evaluated feature (value plus the id of the rollout strategy that matched, if any) in one call. It is the public equivalent of the internal evaluation the typed getters already perform, so adapters such as the OpenFeature providers can report `variant`/`TARGETING_MATCH` without reaching into internals.

`forceClose()` is now part of the `FeatureHubConfig` interface, allowing the owner of a config (for example an OpenFeature provider's `onClose`) to tear down the edge connection, repository and usage plugin immediately rather than relying on the reference-counted `close()`.

The node and client SDK patches republish them after this core release so their published `featurehub-javascript-core-sdk` dependency is rewritten to `^2.1.0` (pnpm replaces `workspace:^` at publish time). This guarantees consumers of the OpenFeature providers get a core version that actually exposes `getValue()` and `forceClose()`, even with an existing lockfile.
