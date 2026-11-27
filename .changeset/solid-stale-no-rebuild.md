---
"featurehub-solid-sdk": patch
---

The `FeatureHub` component no longer rebuilds the context when readiness becomes Stale (during a context change, or once the connection has stopped for good), which made the edge reconnect for nothing.
