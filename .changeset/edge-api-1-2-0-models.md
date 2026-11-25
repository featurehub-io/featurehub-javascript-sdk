---
"featurehub-javascript-core-sdk": minor
"featurehub-javascript-node-sdk": patch
"featurehub-javascript-client-sdk": patch
---

The models are regenerated from the FeatureHub Edge API 1.2.0. `FeatureState.version` and `type` are now required, and `l` may be `null`; `FeatureEnvironmentCollection` has `pollInterval`; `StrategyAttributeWellKnownNames` gains `FhubWhenActive`; and a strategy attribute's `conditional`, `fieldName` and `type` are required. The `BaseRolloutStrategyAllOf`, `BaseRolloutStrategyAttribute` and `FeatureRolloutStrategyAllOf` types are removed: use `BaseRolloutStrategy`, `RolloutStrategyAttribute` and `FeatureRolloutStrategy`.
