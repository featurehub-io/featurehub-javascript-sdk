## 3.0.0

### Minor Changes

- 78e9f71: Extra headers for FeatureHub Edge, for an API gateway, a proxy, extra authentication or tracing: `fhConfig.headers({...})`, or a function called for each request so a value such as a short-lived token stays current. They are sent with every poll and every streaming connection and reconnection. The SDK's own protocol headers (`x-featurehub`, `If-None-Match`, `Last-Event-ID`) always win over a header of the same name, in any case. A browser's `EventSource` cannot send headers, so in a browser they are only sent when polling, and a warning is logged if they are configured for streaming. The React and Solid `FeatureHub` components take a `headers` prop.

### Patch Changes

- 8188272: A `pollInterval` prop under 5 seconds (other than 0) is logged and the default of 60 seconds used, as the browser SDK's `featurehub-interval` meta tag is, instead of throwing while the component renders.
- 78e9f71: Readiness follows the FeatureHub protocol, with a new `Readyness.Stale` state: features are held and keep being resolved, but may not be current.
  - A failure **after** features have been received makes readiness `Stale`, not `Failed`, and the last features keep being resolved. `Failed` now means only that the connection failed before any features arrived, and it is final.
  - A server-evaluated key's context change goes from `Ready` to `Stale` until the new context's features arrive, instead of `NotReady` (the old features are still held).
  - A stale environment (a 236 when polling, `edge.stale` when streaming) makes readiness `Stale` for good.
  - The repository exposes `connectionFailed` and `environmentStale`, and `waitForReady` returns as soon as nothing more can arrive.
  - A features notification that is not a list is ignored, and features without a version or a type are skipped.

  The React `FeatureHub` component renders its children while readiness is `Ready` or `Stale`, so a context change no longer unmounts the app until the new context's features arrive.

  If you check `readiness === Readyness.Failed` to detect a lost connection, also check for `Readyness.Stale` (with `connectionFailed`).

- 8188272: The `FeatureHub` component no longer rebuilds the context when readiness becomes Stale (during a context change, or once the connection has stopped for good), which made the edge reconnect for nothing.
- Updated dependencies [78e9f71]
- Updated dependencies [78e9f71]
- Updated dependencies [78e9f71]
- Updated dependencies [8188272]
- Updated dependencies [78e9f71]
- Updated dependencies [78e9f71]
- Updated dependencies [78e9f71]
- Updated dependencies [78e9f71]
- Updated dependencies [78e9f71]
- Updated dependencies [78e9f71]
- Updated dependencies [78e9f71]
- Updated dependencies [8188272]
- Updated dependencies [78e9f71]
- Updated dependencies [78e9f71]
- Updated dependencies [78e9f71]
- Updated dependencies [8188272]
- Updated dependencies [78e9f71]
- Updated dependencies [78e9f71]
- Updated dependencies [78e9f71]
- Updated dependencies [8188272]
- Updated dependencies [78e9f71]
- Updated dependencies [78e9f71]
- Updated dependencies [78e9f71]
  - featurehub-javascript-client-sdk@2.1.0

## 2.1.0

### Minor Changes

- cd5a589: focus on making more robust react and solid sdks

### Patch Changes

- Updated dependencies [cd5a589]
- Updated dependencies [cd5a589]
  - featurehub-javascript-client-sdk@2.0.2

## 2.0.1

### Patch Changes

- be61eae: ensure ^ versions
- Updated dependencies [be61eae]
  - featurehub-javascript-client-sdk@2.0.1

## 2.0.0

### Major Changes

- 5c4cee5: Major SDK release for the 2.0 release

### Patch Changes

- Updated dependencies [5c4cee5]
  - featurehub-javascript-client-sdk@2.0.0

## 2.0.0-rc1.0

### Major Changes

- 5c4cee5: Major SDK release for the 2.0 release

### Patch Changes

- Updated dependencies [5c4cee5]
  - featurehub-javascript-client-sdk@2.0.0-rc1.0

### 1.2.0

- updates based on 1.3.0 SDK - statically typed

#### 1.0.1

- Refines implementation of the FeatureHub Solid SDK [GitHub PR](https://github.com/featurehub-io/featurehub-javascript-sdk/pull/131)
