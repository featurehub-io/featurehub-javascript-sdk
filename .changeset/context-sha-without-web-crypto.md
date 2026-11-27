---
"featurehub-javascript-core-sdk": patch
"featurehub-javascript-client-sdk": patch
---

The browser SDK computes the contextSha in JavaScript when the Web Crypto API is missing, as it is in a page that is not a secure context (served over plain http, other than localhost). Before, a server-evaluated key could not change context there: streaming kept the old context's features, and polling failed. Streaming now hashes the context with `FeatureHubEventSourceClient.contextHash`, which the browser SDK sets to its own hash (core's default remains the Web Crypto API, which Node always has).
