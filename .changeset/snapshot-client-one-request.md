---
"featurehub-javascript-core-sdk": patch
"featurehub-javascript-client-sdk": patch
"featurehub-javascript-node-sdk": patch
---

The feature snapshot client makes one request at a time, and keeps one poll timer, when several context changes wait on a request in flight. Before, they could all start a request when it finished, leaving two polling timers running for good (one of them still polling after `close()`).
