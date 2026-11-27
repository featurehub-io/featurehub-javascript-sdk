---
"featurehub-javascript-core-sdk": patch
"featurehub-javascript-node-sdk": patch
"featurehub-javascript-client-sdk": patch
---

- A rollout strategy whose `percentage` is `null` now matches on its attributes; it never matched. A strategy whose `attributes` are `null` is now a plain percentage strategy; evaluating it threw an error. `null` now means the same as an absent field, as the protocol requires.
- A context change on a polling connection that has been closed now makes one request, so the new context's features arrive, without starting polling again. It makes none once the connection has failed or the environment is stale.
