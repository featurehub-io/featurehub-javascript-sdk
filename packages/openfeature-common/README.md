# FeatureHub OpenFeature — common

Shared implementation for the official FeatureHub OpenFeature providers:

- [`featurehub-openfeature-node-sdk`](../openfeature-node)
- [`featurehub-openfeature-web-sdk`](../openfeature-web)

This package is an **implementation detail**. It is published because the providers depend on it, but it is not intended to be used directly.

## What lives here

- **Context mapping** — `mapEvaluationContext`, `toContextRecord` (`targetingKey` → `userkey`, well-known keys, arrays, nested-object rejection), `contextSignature` (change detection) and `isClientEvaluatedKey`.
- **Resolution semantics** — `snapshotFeature` (one `FeatureStateHolder.getValue()` call returning value + matched strategy id) and `resolveFromEvaluation` (not-found, type mismatch, value-less `DEFAULT`, JSON parsing, `TARGETING_MATCH`/`STATIC` + `variant`), plus the standard error resolutions.
- **Provider lifecycle** — `FeatureHubProviderCore`, the base class both providers extend: config creation, event wiring with per-feature change detection, transport selection (`applyTransport`), readiness handling and teardown.

## License

MIT
