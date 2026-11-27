---
"featurehub-javascript-core-sdk": patch
"featurehub-javascript-client-sdk": patch
"featurehub-javascript-node-sdk": patch
---

A context change made while a poll is in flight no longer waits for ever when the request for the new context fails with a network error or a 5xx: its `build()` is told of the failure, and polling carries on.
