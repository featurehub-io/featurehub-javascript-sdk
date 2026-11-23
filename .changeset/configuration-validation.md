---
"featurehub-javascript-core-sdk": minor
"featurehub-javascript-node-sdk": minor
"featurehub-javascript-client-sdk": patch
---

Configuration follows the FeatureHub protocol:

- **Poll intervals** must be `0` (poll once) or at least 5 seconds; `restActive()` and `restPassive()` throw an `InvalidConfigurationError` otherwise. `restActive(0)` and `restPassive(0)` now poll once, where they were silently ignored.
- **Node environment variables:** `FEATUREHUB_CONNECT_TYPE` (`active`, `passive` or `streaming`) and `FEATUREHUB_CONNECT_INTERVAL` (such as `30s`) choose the default connection mode. The legacy `FEATUREHUB_POLLING_INTERVAL` and `FEATUREHUB_POLLING_PASSIVE` are read as before, only when neither new variable is set, and log a deprecation warning.
- **A host URL with a query string** keeps its parameters, ahead of the SDK's own; it used to produce a broken URL. `featureUrl()` now returns a working URL.
- **`modifyRequestFunction`** can no longer replace the SDK's `x-featurehub` header, and headers it sets on a replaced headers object are now sent.
