---
"featurehub-javascript-core-sdk": minor
"featurehub-javascript-node-sdk": patch
"featurehub-javascript-client-sdk": patch
---

Strategies can now use `fhubWhenActive`, an attribute FeatureHub sets to a UTC date-time: the strategy applies when the clock of the machine the SDK runs on compares with it as the attribute's conditional says, so a feature can switch on at a given moment (`GREATER_EQUALS`) or off at one (`LESS`). `EQUALS`, `NOT_EQUALS`, `GREATER`, `GREATER_EQUALS`, `LESS` and `LESS_EQUALS` are supported; any other conditional never matches, and the attribute's type is ignored. The comparison is to the whole second: the clock and the time are both truncated, so `EQUALS` matches for the whole of that second. It combines with the strategy's other attributes and percentages, is worked out on every evaluation, and is never taken from the context: a context attribute named `fhubWhenActive` is not sent to Edge. It is compared with the machine's clock in whole seconds since the epoch.
