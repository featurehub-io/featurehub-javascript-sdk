---
"featurehub-javascript-core-sdk": patch
"featurehub-javascript-node-sdk": patch
"featurehub-javascript-client-sdk": patch
---

A feature whose lock (`l`) is absent or null is now unlocked: `locked` and `isLocked()` return `false` rather than `null`. A full set no longer calls the listeners of a feature that never existed, while a feature appearing or being deleted still calls them.
