---
"featurehub-javascript-core-sdk": minor
"featurehub-javascript-node-sdk": patch
"featurehub-javascript-client-sdk": patch
---

NUMBER strategy attributes are now strict: a value is a number only if it is a finite number, or a string that is exactly a decimal integer or float (`12`, `-5`, `2.5`). Strings such as `12abc`, `1e3`, `0x10`, ` 3`, `1,000` or `Infinity` were read with `parseInt` / `parseFloat` and could match; now a supplied value that is not a number never matches (`NOT_EQUALS` and `EXCLUDES` included), and strategy values that are not numbers are ignored. A strategy with neither a percentage nor attributes no longer stops the percentage strategies after it from matching. The SDK now runs the FeatureHub golden fixture of rollout strategy results in its tests.
