---
"featurehub-javascript-core-sdk": patch
"featurehub-javascript-client-sdk": patch
"featurehub-javascript-node-sdk": patch
---

A host whose query string has a parameter name that is not valid percent-encoding (`?token%=abc`) no longer makes the config's constructor throw a `URIError`: the parameter is kept as written.
