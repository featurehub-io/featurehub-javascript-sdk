---
"featurehub-javascript-core-sdk": minor
"featurehub-javascript-node-sdk": patch
"featurehub-javascript-client-sdk": patch
---

Context attributes can now be date-times: `context.attributeValue("signedUp", new Date(...))`, or a list of them. They are sent to FeatureHub Edge as UTC ISO-8601, evaluated locally by DATE and DATETIME strategies as dates (and by every other kind of strategy, and the percentage key, as their ISO-8601 string), and recorded in usage events as ISO-8601 strings. An invalid `Date` is left out rather than causing an error.
