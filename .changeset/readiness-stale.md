---
"featurehub-javascript-core-sdk": minor
"featurehub-javascript-node-sdk": patch
"featurehub-javascript-client-sdk": patch
"featurehub-react-sdk": patch
"featurehub-solid-sdk": patch
---

Readiness follows the FeatureHub protocol, with a new `Readyness.Stale` state: features are held and keep being resolved, but may not be current.

- A failure **after** features have been received makes readiness `Stale`, not `Failed`, and the last features keep being resolved. `Failed` now means only that the connection failed before any features arrived, and it is final.
- A server-evaluated key's context change goes from `Ready` to `Stale` until the new context's features arrive, instead of `NotReady` (the old features are still held).
- A stale environment (a 236 when polling, `edge.stale` when streaming) makes readiness `Stale` for good.
- The repository exposes `connectionFailed` and `environmentStale`, and `waitForReady` returns as soon as nothing more can arrive.
- A features notification that is not a list is ignored, and features without a version or a type are skipped.

The React `FeatureHub` component renders its children while readiness is `Ready` or `Stale`, so a context change no longer unmounts the app until the new context's features arrive.

If you check `readiness === Readyness.Failed` to detect a lost connection, also check for `Readyness.Stale` (with `connectionFailed`).
