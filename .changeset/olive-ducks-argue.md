---
"featurehub-javascript-core-sdk": patch
"featurehub-javascript-client-sdk": patch
"featurehub-javascript-node-sdk": patch
---

Create the usage adapter once per repository rather than on every `repository()` call. Because `newContext()` calls `repository()`, every context previously registered a usage stream that was never removed, so feature evaluation fanned out over an ever-growing list of listeners and got progressively slower for the life of the process.
