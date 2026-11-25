---
"featurehub-javascript-core-sdk": minor
"featurehub-javascript-node-sdk": patch
"featurehub-javascript-client-sdk": patch
---

`FeatureStateHolder.getValue()` now says whether the value came from a percentage rollout matched locally (`EvaluatedFeature.split`, and `Applied.split` from strategy evaluation), so an OpenFeature provider can report `SPLIT` rather than `TARGETING_MATCH`. For a feature with no strategies, its `strategyId` is now the strategy the server applied (`v`, for a server-evaluated key); before, it was always undefined. Usage events carry that strategy id too.
