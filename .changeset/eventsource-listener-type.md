---
"featurehub-javascript-core-sdk": patch
---

The streaming client's `EventSource` type spells out its listener type instead of naming the DOM's `EventListener`, so TypeScript projects without the DOM lib (Node services, say) can type check the SDK. The type is unchanged.
