---
"featurehub-javascript-core-sdk": patch
"featurehub-javascript-client-sdk": patch
---

The contextSha is computed in JavaScript when the Web Crypto API is missing, as it is in a browser page that is not a secure context (served over plain http, other than localhost). Before, a server-evaluated key could not change context there: streaming kept the old context's features, and polling failed.
