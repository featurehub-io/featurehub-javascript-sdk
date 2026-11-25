# FeatureHub OpenFeature — common

Shared implementation for the official FeatureHub OpenFeature providers:

- [`featurehub-openfeature-node-sdk`](../openfeature-node)
- [`featurehub-openfeature-web-sdk`](../openfeature-web)

This package is an **implementation detail**. It is published because the providers depend on it, but it is not intended to be used directly.

## What lives here

- **Context mapping** — `mapEvaluationContext` and `toContextRecord`, following the FeatureHub SDK specification's evaluation context: `targetingKey` → `userkey`; the well-known keys (`device`, `country`, `platform`, `session`, `version`) case-insensitively; `fhubWhenActive` dropped; strings, numbers, booleans and dates, or lists of them; nested objects rejected. Plus `contextSignature` (change detection) and `isClientEvaluatedKey`.
- **Resolution semantics** — `snapshotFeature` (one `FeatureStateHolder.getValue()` call returning the value, the strategy id and whether it was a percentage rollout, plus the feature's properties) and `resolveFromEvaluation`, which follows the FeatureHub SDK specification's OpenFeature resolution: not found, type mismatch, value-less `DISABLED`, conversion of string values, `STATIC` / `SPLIT` / `TARGETING_MATCH` with the strategy id as `variant`, and flag metadata. Plus the standard error resolutions.
- **Provider lifecycle** — `FeatureHubProviderCore`, the base class both providers extend: config creation, event wiring with per-feature change detection, transport selection (`applyTransport`), readiness handling and teardown.

## License

MIT
