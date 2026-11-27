---
"featurehub-javascript-node-sdk": patch
---

`FEATUREHUB_POLLING_INTERVAL` with a unit is now read as that duration: `5s` is 5 seconds. It was read with `parseInt`, so `5s` became 5 milliseconds. A bare number is still milliseconds, as before, and a value that is neither is an error naming the variable.
