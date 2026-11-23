---
"featurehub-javascript-core-sdk": minor
"featurehub-javascript-node-sdk": patch
"featurehub-javascript-client-sdk": patch
---

Strategies can now use `fhubWhenActive`, an attribute FeatureHub sets to a UTC date-time: the strategy applies when the clock of the machine the SDK runs on compares with it as the attribute's conditional says, so a feature can switch on at a given moment (`GREATER_EQUALS`) or off at one (`LESS`). `EQUALS`, `NOT_EQUALS`, `GREATER`, `GREATER_EQUALS`, `LESS` and `LESS_EQUALS` are supported; any other conditional never matches, and the attribute's type is ignored. It combines with the strategy's other attributes and percentages, is worked out on every evaluation, and is never taken from the context: a context attribute named `fhubWhenActive` is not sent to Edge. `ApplyFeature.clock` can be replaced in tests.
