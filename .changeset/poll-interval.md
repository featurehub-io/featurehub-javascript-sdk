---
"featurehub-javascript-core-sdk": minor
"featurehub-javascript-node-sdk": patch
"featurehub-javascript-client-sdk": patch
---

Polling now takes its interval override from the `pollInterval` FeatureHub sends with each environment, in whole seconds, rather than from the `Cache-Control` header, which FeatureHub never meant as a polling signal and which is no longer read. The smallest `pollInterval` of at least 5 seconds replaces the configured interval, shorter or longer; values below 5 are ignored; a response without one returns to the configured interval; and an interval of `0` (poll once) never starts polling. `PollingBase.parseCacheControl` is removed, replaced by `applyPollInterval`.
